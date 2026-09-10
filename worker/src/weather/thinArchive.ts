// weather/thinArchive.ts
// Retention for the long-term WeatherFrame archive.
//
// The archive was written keep-everything-forever (`archiveKeepDays()` defaults
// to 0) while `archiveRun` fires on EVERY source publish - and MRMS publishes
// every two minutes with a fresh `validTime`, so it alone minted 720 frames a
// day. That is what took the blob store to 240 GB (docs/blob-retention-plan.md).
//
// Nothing on air reads this archive further back than 72h
// (`HISTORY_WINDOW_HOURS`; the PAST YEAR panel reads ERA5 `climateYears`, not
// this), so the long tail can be SAMPLED rather than kept whole:
//
//   1. full-res window - keep every frame (covers every on-air consumer)
//   2. daily keeper    - past that, one frame per (model, variable) per UTC
//                        day, nearest midday, kept forever
//   3. nests           - zoom-gated regional overlays (`minZoom`, incl. the
//                        MRMS radar firehose) are dropped whole past their own
//                        shorter window; they are only useful live
//
// Selection is pure and metadata-only - bytes are never read to decide.

import { isNestSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Frames stay at full cadence for this long. Default covers the 72h panel window. */
export const fullResHours = (): number => Number(process.env.WEATHER_ARCHIVE_FULLRES_HOURS || 96);
/** Zoom-gated nests keep this many days, then go entirely. */
export const nestKeepDays = (): number => Number(process.env.WEATHER_ARCHIVE_NEST_KEEP_DAYS || 7);
/** UTC hour the surviving daily keeper should sit nearest to. */
export const keeperHourUtc = (): number => Number(process.env.WEATHER_ARCHIVE_KEEPER_HOUR || 12);
/** Thinning is on unless explicitly disabled (pause it while backfilling). */
export const thinEnabled = (): boolean => process.env.WEATHER_ARCHIVE_THIN !== "off";

/** The metadata thinning reads. A `WeatherFrameMeta` satisfies this. */
export interface ThinFrameMeta {
  id: string;
  model: string;
  variable: string;
  validTime: string | Date;
}

export interface ThinOpts {
  /** Frames at/after this instant are untouchable. */
  fullResUntilMs: number;
  /** Nest frames before this instant are dropped entirely. */
  nestCutoffMs: number;
  /** Which models are zoom-gated nests. Injected so the planner stays pure. */
  isNest?: (model: string) => boolean;
  /** UTC hour the daily keeper aims for (default 12). */
  keeperHour?: number;
}

/** UTC calendar day, "YYYY-MM-DD". */
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Which frame ids to delete. PURE - no Mongo, no disk, no clock.
 *
 * A frame survives when it is inside the full-res window, when it is a nest
 * frame inside the nest window, or when it is its (model, variable, UTC day)
 * group's closest frame to `keeperHour`. Ties break toward the earlier frame so
 * repeat runs are stable.
 */
export function planFrameThinning(frames: ThinFrameMeta[], opts: ThinOpts): string[] {
  const isNest = opts.isNest ?? isNestSource;
  const keeperHour = opts.keeperHour ?? 12;
  const doomed: string[] = [];
  // (model, variable, day) -> candidates for that day's single keeper.
  const groups = new Map<string, { id: string; ms: number }[]>();

  for (const f of frames) {
    const ms = +new Date(f.validTime);
    if (!Number.isFinite(ms)) continue; // undated row: leave it alone, never guess
    if (ms >= opts.fullResUntilMs) continue; // inside the working set

    if (isNest(f.model)) {
      // Nests are live-only overlays: full cadence inside their window, then gone.
      if (ms < opts.nestCutoffMs) doomed.push(f.id);
      continue;
    }

    const key = `${f.model} ${f.variable} ${utcDay(ms)}`;
    const arr = groups.get(key);
    if (arr) arr.push({ id: f.id, ms });
    else groups.set(key, [{ id: f.id, ms }]);
  }

  for (const grp of groups.values()) {
    if (grp.length <= 1) continue;
    const targetMs = Math.floor(grp[0].ms / DAY) * DAY + keeperHour * HOUR;
    let keep = grp[0];
    let best = Math.abs(grp[0].ms - targetMs);
    for (const c of grp.slice(1)) {
      const d = Math.abs(c.ms - targetMs);
      // Strictly-better only, so an exact tie keeps the earlier frame.
      if (d < best || (d === best && c.ms < keep.ms)) {
        keep = c;
        best = d;
      }
    }
    for (const c of grp) if (c.id !== keep.id) doomed.push(c.id);
  }

  return doomed;
}

/** The db surface the sweep touches (a subset of getAppDb()). */
export interface ThinDb {
  weatherFrames: {
    variables(): Promise<string[]>;
    listMeta(q: { variable: string; to?: Date }): Promise<ThinFrameMeta[]>;
    deleteMany(ids: string[]): Promise<{ removed: number }>;
  };
}

export interface ThinResult {
  dryRun: boolean;
  variables: number;
  scanned: number;
  doomed: number;
  removed: number;
  fullResHours: number;
  nestKeepDays: number;
}

/** Delete in chunks so one variable's backlog never builds a giant $in. */
const CHUNK = 500;

/**
 * Sweep the archive one variable at a time. Only frames OLDER than the full-res
 * window are ever loaded, and only their metadata, so peak memory is one
 * variable's meta list.
 */
export async function runThinArchive(
  db: ThinDb,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<ThinResult> {
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? Date.now();
  const fullResUntilMs = now - fullResHours() * HOUR;
  const nestCutoffMs = now - nestKeepDays() * DAY;
  const keeperHour = keeperHourUtc();
  const cutoffDate = new Date(fullResUntilMs);

  const variables = await db.weatherFrames.variables();
  let scanned = 0;
  let doomedTotal = 0;
  let removed = 0;

  for (const variable of variables) {
    const metas = await db.weatherFrames.listMeta({ variable, to: cutoffDate });
    scanned += metas.length;
    const doomed = planFrameThinning(metas, { fullResUntilMs, nestCutoffMs, keeperHour });
    doomedTotal += doomed.length;
    if (dryRun || !doomed.length) continue;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const res = await db.weatherFrames.deleteMany(doomed.slice(i, i + CHUNK));
      removed += res.removed;
    }
  }

  const result: ThinResult = {
    dryRun,
    variables: variables.length,
    scanned,
    doomed: doomedTotal,
    removed,
    fullResHours: fullResHours(),
    nestKeepDays: nestKeepDays(),
  };
  log("weather:thin", dryRun ? "archive thin DRY RUN" : "archive thinned", result);
  return result;
}
