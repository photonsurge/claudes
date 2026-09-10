// alerts/snapshot-retention.ts
// Retention for captured alert imagery.
//
// `alertSnapshots.pruneOlderThan` has existed (and been correct) since the
// alert-timeline work, but nothing ever called it: no job, no repeatable, no
// admin button. Combined with the compare job re-storing a byte-identical
// side-by-side every hour, that is how `${BLOB_DIR}/alert-snapshot` reached
// 74 GB. See docs/blob-retention-plan.md.
//
// Three tiers, matching the frame archive:
//
//   1. full-res window - keep every still (ALERT_SNAPSHOT_FULLRES_HOURS)
//   2. daily keeper    - past that, the NEWEST still per (alert, kind, layer)
//                        per UTC day; an alert's imagery is a record of how it
//                        developed, so the latest state of each day is the one
//                        worth keeping
//   3. hard cap        - past ALERT_SNAPSHOT_KEEP_DAYS everything goes, EXCEPT
//                        the newest satellite still of an alert that actually
//                        aired. The as-run log knows which those are, and an
//                        alert that made it to air deserves a picture in the
//                        permanent record the Alert doc already provides.
//
// Selection is pure and metadata-only.

import { log } from "@photonsurge/shared/utill/logger";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Stills stay at full cadence for this long. */
export const fullResHours = (): number => Number(process.env.ALERT_SNAPSHOT_FULLRES_HOURS || 72);
/** Past this age everything goes except an aired alert's keepsake. */
export const keepDays = (): number => Number(process.env.ALERT_SNAPSHOT_KEEP_DAYS || 30);
/** Keep one still forever for alerts that aired. Set "false" to drop those too. */
export const keepsakeEnabled = (): boolean => process.env.ALERT_SNAPSHOT_KEEPSAKE !== "false";
/** Retention is on unless explicitly disabled. */
export const retentionEnabled = (): boolean => process.env.ALERT_SNAPSHOT_RETENTION !== "off";

/** The snapshot metadata retention reads. An `AlertSnapshotMeta` satisfies this. */
export interface RetainSnapMeta {
  id: string;
  source: string;
  identifier: string;
  kind: string;
  layer?: string;
  capturedAt: string | Date;
}

export interface RetainOpts {
  /** Stills at/after this instant are untouchable. */
  fullResUntilMs: number;
  /** Stills before this instant go, keepsakes aside. */
  hardCutoffMs: number;
  /** `${source}:${identifier}` of alerts that have aired. */
  aired?: Set<string>;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The alert key shared by a snapshot and an aired `storm:` segment id. */
export const alertKeyOf = (s: { source: string; identifier: string }) => `${s.source}:${s.identifier}`;

/**
 * Which snapshot ids to delete. PURE - no Mongo, no disk, no clock.
 *
 * Input may be in any order; the planner sorts what it needs. A still survives
 * when it is inside the full-res window, when it is the newest of its
 * (alert, kind, layer) group for its UTC day and inside the hard cap, or when it
 * is the single newest satellite still of an alert that aired.
 */
export function planSnapshotThinning(snaps: RetainSnapMeta[], opts: RetainOpts): string[] {
  const aired = opts.aired ?? new Set<string>();
  const doomed = new Set<string>();
  // Newest satellite still per aired alert, whatever its age - the keepsake.
  const keepsake = new Map<string, { id: string; ms: number }>();
  // (alert, kind, layer, day) -> newest member, which is the one that survives.
  const dayBest = new Map<string, { id: string; ms: number }>();

  for (const s of snaps) {
    const ms = +new Date(s.capturedAt);
    if (!Number.isFinite(ms)) continue; // undated row: leave it alone, never guess

    const key = alertKeyOf(s);
    if (s.kind === "satellite" && aired.has(key)) {
      const cur = keepsake.get(key);
      if (!cur || ms > cur.ms) keepsake.set(key, { id: s.id, ms });
    }

    if (ms >= opts.fullResUntilMs) continue; // inside the working set

    if (ms < opts.hardCutoffMs) {
      doomed.add(s.id); // past the cap; the keepsake pass below may reprieve it
      continue;
    }

    const groupKey = `${key} ${s.kind} ${s.layer ?? ""} ${utcDay(ms)}`;
    const best = dayBest.get(groupKey);
    if (!best) {
      dayBest.set(groupKey, { id: s.id, ms });
    } else if (ms > best.ms) {
      doomed.add(best.id); // the older one loses the day
      dayBest.set(groupKey, { id: s.id, ms });
    } else {
      doomed.add(s.id);
    }
  }

  // A keepsake is never deleted, whichever tier condemned it.
  for (const k of keepsake.values()) doomed.delete(k.id);

  return [...doomed];
}

/** The db surface the sweep touches (a subset of getAppDb()). */
export interface RetainDb {
  alertSnapshots: {
    listAllMeta(): Promise<RetainSnapMeta[]>;
    deleteMany(ids: string[]): Promise<{ removed: number }>;
  };
  airLog: { airedSegmentIds(kind: string): Promise<string[]> };
}

export interface RetainResult {
  dryRun: boolean;
  scanned: number;
  aired: number;
  doomed: number;
  removed: number;
  fullResHours: number;
  keepDays: number;
}

const CHUNK = 500;

/**
 * Sweep alert imagery. Reads metadata only (`listAllMeta` projects the bytes
 * away), so peak memory is the snapshot meta list, not any pixels.
 */
export async function runAlertSnapshotRetention(
  db: RetainDb,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<RetainResult> {
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? Date.now();
  const fullResUntilMs = now - fullResHours() * HOUR;
  const hardCutoffMs = now - keepDays() * DAY;

  // "storm:<source>:<identifier>" -> "<source>:<identifier>".
  const aired = keepsakeEnabled()
    ? new Set(
        (await db.airLog.airedSegmentIds("storm"))
          .filter((id) => id.startsWith("storm:"))
          .map((id) => id.slice("storm:".length)),
      )
    : new Set<string>();

  const snaps = await db.alertSnapshots.listAllMeta();
  const doomed = planSnapshotThinning(snaps, { fullResUntilMs, hardCutoffMs, aired });

  let removed = 0;
  if (!dryRun) {
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const res = await db.alertSnapshots.deleteMany(doomed.slice(i, i + CHUNK));
      removed += res.removed;
    }
  }

  const result: RetainResult = {
    dryRun,
    scanned: snaps.length,
    aired: aired.size,
    doomed: doomed.length,
    removed,
    fullResHours: fullResHours(),
    keepDays: keepDays(),
  };
  log("alerts:retention", dryRun ? "alert snapshot DRY RUN" : "alert snapshots pruned", result);
  return result;
}
