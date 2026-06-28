import type { AppDb } from "@photonsurge/shared/db/index";
import type { AlertSource } from "@photonsurge/shared/alerts/types";
import { referencedIdentifiers } from "@photonsurge/shared/alerts/normalise";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "alerts:ingest";

export interface IngestResult {
  source: string;
  count: number;
  inserted: number;
  superseded: number;
  expired: number;
}

/**
 * One ingest tick for a single source: fetch → parse → normalise → upsert, then
 * supersede referenced chains and sweep expiries (spec §5/§6). Pure-ish: takes
 * the db facade so it is unit-testable with a fake repo.
 */
export async function ingestSource(
  source: AlertSource,
  db: AppDb,
  now: Date = new Date(),
): Promise<IngestResult> {
  const raw = await source.fetch();
  const msgs = source.parse(raw);
  const alerts = source.normalise(msgs, now);

  let inserted = 0;
  let superseded = 0;
  for (const a of alerts) {
    const { inserted: isNew } = await db.alerts.upsert(a);
    if (isNew) inserted++;
    if (a.references?.length) {
      superseded += await db.alerts.supersede(source.id, referencedIdentifiers(a.references));
    }
  }
  const expired = await db.alerts.expire(source.id, now.toISOString());

  const result: IngestResult = { source: source.id, count: alerts.length, inserted, superseded, expired };
  log(TAG, `ingested`, result);
  return result;
}
