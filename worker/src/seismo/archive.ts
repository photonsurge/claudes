// seismo/archive.ts
// Copy significant earthquakes out of the rolling working set into the
// permanent record, before Mongo's TTL deletes them.
//
// `Quake` carries a TTL on `time` (default 31 days), which is correct for the
// live overlay and meant there was NO long-term seismic record at all: ask what
// happened last year and every document had already been reaped, with nothing
// keeping a copy (docs/blob-retention-plan.md).
//
// The floor defaults to the magnitude of the feed we actually ingest
// (DEFAULT_USGS_FEED is "2.5_day"), so the record keeps everything we see rather
// than a tenth of it - roughly 17,000 events a year at a few hundred bytes each,
// which is tens of MB. The gate exists so that widening USGS_FEED to an
// everything-feed cannot silently turn this into an unbounded collection.
//
// Idempotent by construction: the archive upserts on the USGS id, so an overlap
// with yesterday's run rewrites the same rows and picks up any magnitude
// revision. Running daily against a 31-day TTL means a month of missed runs
// still loses nothing.

import { log } from "@photonsurge/shared/utill/logger";

/** Magnitude floor for the permanent record. Matches the ingested USGS feed. */
export const archiveMinMag = (): number => {
  const raw = process.env.QUAKE_ARCHIVE_MIN_MAG;
  // `|| 2.5` would turn a deliberate "0" (archive everything) into 2.5.
  return raw === undefined || raw === "" ? 2.5 : Number(raw);
};
/**
 * How much of the working set to sweep each run. Generous on purpose - the whole
 * point is that a few missed runs cannot lose an event, and re-archiving is free.
 */
export const archiveLookbackDays = (): number => Number(process.env.QUAKE_ARCHIVE_LOOKBACK_DAYS || 30);
/** Archiving is on unless explicitly disabled. */
export const archiveEnabled = (): boolean => process.env.QUAKE_ARCHIVE !== "off";

const DAY = 86_400_000;

/** The db surface the archive job touches (a subset of getAppDb()). */
export interface QuakeArchiveDb {
  quakes: {
    list(opts: { minMag?: number; sinceMs?: number; limit?: number }): Promise<
      {
        quakeId: string;
        mag: number;
        place?: string;
        time: Date | string;
        lng: number;
        lat: number;
        depthKm: number;
        url?: string;
        tsunami?: boolean;
      }[]
    >;
  };
  quakeArchive: {
    archiveMany(
      quakes: {
        quakeId: string;
        mag: number;
        place?: string;
        time: Date | string;
        lng: number;
        lat: number;
        depthKm: number;
        url?: string;
        tsunami?: boolean;
      }[],
    ): Promise<{ archived: number; updated: number }>;
    count(): Promise<number>;
  };
}

export interface QuakeArchiveResult {
  dryRun: boolean;
  candidates: number;
  archived: number;
  updated: number;
  total: number;
  minMag: number;
  lookbackDays: number;
}

export async function runQuakeArchive(
  db: QuakeArchiveDb,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<QuakeArchiveResult> {
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? Date.now();
  const minMag = archiveMinMag();
  const lookbackDays = archiveLookbackDays();

  const candidates = await db.quakes.list({
    minMag,
    sinceMs: now - lookbackDays * DAY,
    // The repo's default cap is 2000; a month of M4.5+ is well under that, but
    // an explicit ceiling means a widened magnitude floor cannot silently clip.
    limit: 50_000,
  });

  const { archived, updated } = dryRun
    ? { archived: 0, updated: 0 }
    : await db.quakeArchive.archiveMany(candidates);

  const result: QuakeArchiveResult = {
    dryRun,
    candidates: candidates.length,
    archived,
    updated,
    total: await db.quakeArchive.count(),
    minMag,
    lookbackDays,
  };
  log("seismo:archive", dryRun ? "quake archive DRY RUN" : "quakes archived", result);
  return result;
}
