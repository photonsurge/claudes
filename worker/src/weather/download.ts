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

/** Fetch + parse an `.idx`, memoised by URL. */
async function loadIdx(idxUrl: string): Promise<IdxEntry[]> {
  const cached = IDX_CACHE.get(idxUrl);
  if (cached) {
    IDX_CACHE.delete(idxUrl);
    IDX_CACHE.set(idxUrl, cached); // LRU bump
    dbg(TAG, `idx cache hit ${idxUrl}`, { entries: cached.length });
    return cached;
  }
  const res = await fetch(idxUrl);
  if (!res.ok) throw new Error(`idx fetch failed ${res.status} for ${idxUrl}`);
  const entries = parseGfsIdx(await res.text());
  IDX_CACHE.set(idxUrl, entries);
  if (IDX_CACHE.size > IDX_CACHE_MAX) {
    const oldest = IDX_CACHE.keys().next().value as string;
    IDX_CACHE.delete(oldest);
  }
  dbg(TAG, `idx fetched ${idxUrl}`, { entries: entries.length, cached: IDX_CACHE.size });
  return entries;
}

/** Empty the `.idx` memo (tests; not needed in production — content is immutable). */
export function clearIdxCache(): void {
  IDX_CACHE.clear();
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
