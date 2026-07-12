// weather/download.ts
// Download a GRIB subset to a temp file. Network is isolated here so ingest can
// be reasoned about / mocked separately.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { log } from "@photonsurge/shared/utill/logger";
import { parseGfsIdx, selectIdxRanges, type IdxEntry } from "../sources/gfs";
import { dbg } from "./debug";

const TAG = "job:weather";

/** Download `url` to a temp file and return its path. Caller must clean up. */
export async function downloadToTemp(url: string, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gfs-"));
  const path = join(dir, name);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  return path;
}

export interface IdxSubsetArgs {
  /** Full GRIB2 file URL (Range-requested). */
  gribUrl: string;
  /** Its `.idx` sidecar URL. */
  idxUrl: string;
  /** GFS var names to keep, e.g. ["UGRD","VGRD"]. */
  vars: string[];
  /** NOMADS level tokens to keep, e.g. ["10_m_above_ground"]. */
  levels: string[];
}

// Parsed `.idx` files are immutable per URL and shared by EVERY variable at the
// same forecast hour — so an ingest that bakes ~15 vars would otherwise re-fetch
// the same ~200 KB index 15× per hour (~765 redundant downloads/run). Cache the
// parsed entries; a full run then fetches each idx once. Bounded LRU (immutable
// content, so eviction only ever costs a re-fetch).
const IDX_CACHE = new Map<string, IdxEntry[]>();
const IDX_CACHE_MAX = 96;

// Negative cache of `.idx` URLs that returned 404 — i.e. a forecast hour NOAA
// has not posted yet (the far-out daily-outlook tail, f144…f384, of a fresh
// cycle). A 404 is deterministic, but the SAME idx is requested once per GFS
// variable (~14×) at that hour, so without this every variable re-hits S3 for
// the same not-there file — hundreds of pointless round-trips that make the bake
// crawl and look stuck. Remembering the miss lets every later variable fail-fast
// instantly. URLs are cycle-specific (date/cycle/fhr baked in), so a later
// cycle's tail never collides with a stale entry. Bounded like the positive
// cache. Only 404 is cached — 5xx/network errors are transient and retriable.
const IDX_MISSING = new Set<string>();
const IDX_MISSING_MAX = 512;

function rememberMissingIdx(idxUrl: string): void {
  IDX_MISSING.add(idxUrl);
  if (IDX_MISSING.size > IDX_MISSING_MAX) {
    const oldest = IDX_MISSING.values().next().value as string;
    IDX_MISSING.delete(oldest);
  }
}

// In-flight fetches, so that when many variables bake the SAME forecast hour
// concurrently (the parallel bake), they share ONE network fetch of that hour's
// `.idx` instead of each racing its own (the cache is still empty until the first
// resolves). This is what makes "download the idx once" hold under parallelism.
const IDX_INFLIGHT = new Map<string, Promise<IdxEntry[]>>();

/** Fetch + parse an `.idx`, memoised by URL (positive), 404-negative-cached, and in-flight-deduped. */
async function loadIdx(idxUrl: string): Promise<IdxEntry[]> {
  const cached = IDX_CACHE.get(idxUrl);
  if (cached) {
    IDX_CACHE.delete(idxUrl);
    IDX_CACHE.set(idxUrl, cached); // LRU bump
    dbg(TAG, `idx cache hit ${idxUrl}`, { entries: cached.length });
    return cached;
  }
  // Fail-fast on an already-known-missing tail hour: no network round-trip.
  if (IDX_MISSING.has(idxUrl)) {
    dbg(TAG, `idx not posted (cached 404) ${idxUrl}`, {});
    throw new Error(`idx not posted (404) for ${idxUrl}`);
  }
  // Coalesce concurrent fetches of the same idx into one.
  const inflight = IDX_INFLIGHT.get(idxUrl);
  if (inflight) {
    dbg(TAG, `idx fetch coalesced ${idxUrl}`, {});
    return inflight;
  }

  const p = (async (): Promise<IdxEntry[]> => {
    const res = await fetch(idxUrl);
    if (res.status === 404) {
      rememberMissingIdx(idxUrl);
      dbg(TAG, `idx not posted (404) ${idxUrl}`, { cachedMisses: IDX_MISSING.size });
      throw new Error(`idx not posted (404) for ${idxUrl}`);
    }
    if (!res.ok) throw new Error(`idx fetch failed ${res.status} for ${idxUrl}`);
    const entries = parseGfsIdx(await res.text());
    IDX_CACHE.set(idxUrl, entries);
    if (IDX_CACHE.size > IDX_CACHE_MAX) {
      const oldest = IDX_CACHE.keys().next().value as string;
      IDX_CACHE.delete(oldest);
    }
    dbg(TAG, `idx fetched ${idxUrl}`, { entries: entries.length, cached: IDX_CACHE.size });
    return entries;
  })();
  IDX_INFLIGHT.set(idxUrl, p);
  try {
    return await p;
  } finally {
    IDX_INFLIGHT.delete(idxUrl);
  }
}

/** Empty both `.idx` memos (tests; not needed in production — content is immutable). */
export function clearIdxCache(): void {
  IDX_CACHE.clear();
  IDX_MISSING.clear();
  IDX_INFLIGHT.clear();
}

/**
 * Download only the GRIB messages matching `vars` × `levels` from an S3-hosted
 * GFS file, via its `.idx` sidecar + HTTP Range requests. No server-side filter,
 * so no NOMADS rate limits. Writes the concatenated messages to a temp `.grib2`
 * (a valid multi-message GRIB that wgrib2 reads exactly like a NOMADS subset) and
 * returns its path. Throws on a missing `.idx`, no matching message, or a failed
 * range fetch — the caller skips just that forecast hour.
 */
export async function downloadIdxSubset(a: IdxSubsetArgs, name: string): Promise<string> {
  const ranges = selectIdxRanges(await loadIdx(a.idxUrl), a.vars, a.levels);
  if (ranges.length === 0) {
    throw new Error(
      `no idx match for vars=${a.vars.join(",")} levels=${a.levels.join(",")} in ${a.idxUrl}`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "gfs-"));
  const path = join(dir, name);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for (const r of ranges) {
    const range = r.end === undefined ? `bytes=${r.start}-` : `bytes=${r.start}-${r.end}`;
    const res = await fetch(a.gribUrl, { headers: { Range: range } });
    // S3 answers a range with 206; a range covering the whole object may come
    // back as a plain 200 — both carry the bytes we asked for.
    if (res.status !== 206 && res.status !== 200) {
      throw new Error(`range download failed ${res.status} (${range}) for ${a.gribUrl}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    bytes += buf.byteLength;
    chunks.push(buf);
  }
  await writeFile(path, Buffer.concat(chunks));
  dbg(TAG, `subset ${name}`, { ranges: ranges.length, bytes });
  return path;
}

/** Best-effort recursive cleanup of a downloaded temp file's directory. */
export async function cleanupTemp(path: string): Promise<void> {
  try {
    const dir = join(path, "..");
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Default availability probe used by latestAvailableRun in production. */
export async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}
