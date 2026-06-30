import type { AppDb } from "@photonsurge/shared/db/index";
import type { AlertSource } from "@photonsurge/shared/alerts/types";
import { referencedIdentifiers } from "@photonsurge/shared/alerts/normalise";
import { log, logWarn } from "@photonsurge/shared/utill/logger";

const TAG = "alerts:ingest";

/**
 * Collapse a 2dsphere rejection message to a stable bucket so we can count
 * *why* geometry drops (self-intersection vs out-of-range vs loop-too-big …)
 * instead of logging 484 near-identical lines.
 */
function geoFailReason(err: unknown): string {
  const m = String((err as { message?: unknown })?.message ?? err);
  if (/edges?\b.*\b(cross|intersect)/i.test(m)) return "self-intersecting";
  if (/duplicate vertices|consecutive|degenerate/i.test(m)) return "degenerate-ring";
  if (/(longitude|latitude).*(range|bound)|out of bounds|-?\d+ is (greater|less)/i.test(m))
    return "coord-out-of-range";
  if (/loop is not valid|bigger than|hemisphere|cover more than/i.test(m)) return "loop-too-big";
  if (/ring is not closed|at least \d+ vertices|too few/i.test(m)) return "bad-ring";
  if (/duplicate key/i.test(m)) return "duplicate-key";
  return "other";
}

export interface IngestResult {
  source: string;
  count: number;
  inserted: number;
  superseded: number;
  expired: number;
  /** Alerts stored without their geometry because the polygon was invalid. */
  geoDropped?: number;
  /** Count of geometry rejections bucketed by reason (self-intersecting, …). */
  geoReasons?: Record<string, number>;
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
  const geoReasons: Record<string, number> = {};
  for (const a of alerts) {
    try {
      const { inserted: isNew } = await db.alerts.upsert(a);
      if (isNew) inserted++;
    } catch (err) {
      // Almost always an invalid polygon rejected by the 2dsphere index. Keep
      // the alert — re-upsert it with geometry stripped so it's never lost, but
      // surface *why* the geometry was rejected so dirty feeds are diagnosable.
      const reason = geoFailReason(err);
      geoReasons[reason] = (geoReasons[reason] ?? 0) + 1;
      logWarn(TAG, `geometry rejected`, {
        source: source.id,
        id: a.identifier,
        reason,
        err: String((err as { message?: unknown })?.message ?? err),
      });
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
  if (geoDropped) log(TAG, `dropped invalid geometry`, { source: source.id, geoDropped, geoReasons });
  const expired = await db.alerts.expire(source.id, now.toISOString());

  const result: IngestResult = {
    source: source.id,
    count: alerts.length,
    inserted,
    superseded,
    expired,
    geoDropped,
    ...(geoDropped ? { geoReasons } : {}),
  };
  log(TAG, `ingested`, result);
  return result;
}
