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
  /** Alerts stored without their geometry because the polygon was invalid. */
  geoDropped?: number;
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
  let geoDropped = 0;
  for (const a of alerts) {
    try {
      const { inserted: isNew } = await db.alerts.upsert(a);
      if (isNew) inserted++;
    } catch (err) {
      // Almost always an invalid polygon rejected by the 2dsphere index. Keep
      // the alert — re-upsert it with geometry stripped so it's never lost.
      const stripped = {
        ...a,
        info: a.info.map((i) => ({ ...i, area: i.area.map((ar) => ({ ...ar, geometry: null })) })),
      };
      try {
        const { inserted: isNew } = await db.alerts.upsert(stripped);
        if (isNew) inserted++;
        geoDropped++;
      } catch (err2) {
        log(TAG, `upsert failed`, { source: source.id, id: a.identifier, err: String(err2) });
      }
    }
    if (a.references?.length) {
      superseded += await db.alerts.supersede(source.id, referencedIdentifiers(a.references));
    }
  }
  if (geoDropped) log(TAG, `dropped invalid geometry`, { source: source.id, geoDropped });
  const expired = await db.alerts.expire(source.id, now.toISOString());

  const result: IngestResult = { source: source.id, count: alerts.length, inserted, superseded, expired, geoDropped };
  log(TAG, `ingested`, result);
  return result;
}
