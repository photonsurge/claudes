// alerts/snapshot-dedup.ts
// One-shot reclaim: collapse byte-identical alert stills down to one copy.
//
// The hourly compare job re-rendered and re-stored the SAME side-by-side every
// hour for every alert, because its two inputs barely moved. Phase 0 stops that
// happening again; this cleans up what it already wrote. On a local box that had
// only run the job a handful of hours, 18% of alert-snapshot blobs were
// byte-identical to another one (docs/blob-retention-plan.md §10).
//
// Cheap by construction: two identical files have identical SIZE, so candidates
// are grouped by (alert, kind, layer, byte size) first and only groups with more
// than one member are ever read and hashed. A snapshot with a unique size is
// never opened at all.
//
// Lossless: only exact byte-for-byte duplicates of the same alert's same kind
// are dropped, and the NEWEST copy of each is kept. Anything the eye could tell
// apart survives.

import { createHash } from "node:crypto";
import { log } from "@photonsurge/shared/utill/logger";

const NS = "alert-snapshot";

export interface DedupSnapMeta {
  id: string;
  source: string;
  identifier: string;
  kind: string;
  layer?: string;
  capturedAt: string | Date;
}

/** Group key: only stills of the same alert, kind and layer can be duplicates. */
const groupKeyOf = (s: DedupSnapMeta, bytes: number) =>
  `${s.source}:${s.identifier}:${s.kind}:${s.layer ?? ""}:${bytes}`;

/**
 * Which same-size groups are worth reading. PURE - takes metadata plus each
 * blob's size and returns the candidate groups, newest-first within a group.
 */
export function planDedupCandidates(
  snaps: DedupSnapMeta[],
  sizeById: Map<string, number>,
): DedupSnapMeta[][] {
  const groups = new Map<string, DedupSnapMeta[]>();
  for (const s of snaps) {
    const bytes = sizeById.get(s.id);
    if (bytes === undefined) continue; // no blob on disk: nothing to dedup
    const key = groupKeyOf(s, bytes);
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt)));
}

export interface DedupDb {
  blobFs: {
    listKeys(ns: string): Promise<{ key: string; bytes: number; mtimeMs: number }[]>;
  } | null;
  alertSnapshots: {
    listAllMeta(): Promise<DedupSnapMeta[]>;
    getPng(id: string): Promise<{ data: Buffer } | null>;
    deleteMany(ids: string[]): Promise<{ removed: number }>;
  };
}

export interface DedupResult {
  dryRun: boolean;
  scanned: number;
  candidateGroups: number;
  hashed: number;
  duplicates: number;
  reclaimedBytes: number;
  removed: number;
}

const CHUNK = 500;

/**
 * Find and drop byte-identical duplicate stills. Reports with `dryRun`.
 *
 * Reads one blob at a time and keeps only its 20-byte digest, so peak memory is
 * a single image regardless of how much is on disk.
 */
export async function runSnapshotDedup(
  db: DedupDb,
  opts: { dryRun?: boolean } = {},
): Promise<DedupResult> {
  const dryRun = opts.dryRun === true;
  if (!db.blobFs) {
    log("alerts:dedup", "BLOB_DIR not set - dedup needs on-disk sizes to be cheap; skipping");
    return { dryRun, scanned: 0, candidateGroups: 0, hashed: 0, duplicates: 0, reclaimedBytes: 0, removed: 0 };
  }

  const snaps = await db.alertSnapshots.listAllMeta();
  const entries = await db.blobFs.listKeys(NS);
  const sizeById = new Map(entries.map((e) => [e.key, e.bytes]));
  const groups = planDedupCandidates(snaps, sizeById);

  let hashed = 0;
  const doomed: string[] = [];
  let reclaimedBytes = 0;

  for (const group of groups) {
    // newest-first, so the first id seen for a digest is the keeper.
    const keeperByDigest = new Map<string, string>();
    for (const s of group) {
      const got = await db.alertSnapshots.getPng(s.id);
      if (!got?.data?.length) continue;
      hashed++;
      const digest = createHash("sha1").update(got.data).digest("hex");
      if (keeperByDigest.has(digest)) {
        doomed.push(s.id);
        reclaimedBytes += sizeById.get(s.id) ?? got.data.length;
      } else {
        keeperByDigest.set(digest, s.id);
      }
    }
  }

  let removed = 0;
  if (!dryRun) {
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const res = await db.alertSnapshots.deleteMany(doomed.slice(i, i + CHUNK));
      removed += res.removed;
    }
  }

  const result: DedupResult = {
    dryRun,
    scanned: snaps.length,
    candidateGroups: groups.length,
    hashed,
    duplicates: doomed.length,
    reclaimedBytes,
    removed,
  };
  log("alerts:dedup", dryRun ? "alert snapshot dedup DRY RUN" : "alert snapshot dedup applied", {
    ...result,
    reclaimedMB: Math.round(reclaimedBytes / 1048576),
  });
  return result;
}
