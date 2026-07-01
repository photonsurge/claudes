import type { AppDb } from "@photonsurge/shared/db/index";
import type { CamSource } from "@photonsurge/shared/cams/types";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "cams:ingest";

export interface CamIngestResult {
  source: string;
  /** Cams returned by the source this tick. */
  count: number;
  /** New cams inserted (upsert created a doc). */
  upserted: number;
  /** Existing cams refreshed (upsert matched an existing doc). */
  matched: number;
}

/**
 * One ingest tick for a single camera source: fetch the catalogue → upsert on
 * `camId` (spec §7 `catalogue:refresh`). Pure-ish: takes the db facade so it's
 * unit-testable with a fake source + fake repo. A re-poll refreshes media/status
 * in place rather than duplicating, because the repo dedups on `camId`.
 */
export async function ingestCamSource(source: CamSource, db: AppDb): Promise<CamIngestResult> {
  const cams = await source.fetchCatalogue();
  const { upserted, matched } = await db.cams.upsertMany(cams);
  const result: CamIngestResult = { source: source.id, count: cams.length, upserted, matched };
  log(TAG, `ingested`, result);
  return result;
}
