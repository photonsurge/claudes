import type { AppDb } from "@photonsurge/shared/db/index";
import type { AlertSource } from "@photonsurge/shared/alerts/types";
import type { iAlertModel } from "@photonsurge/shared/db/alert-model";
import { referencedIdentifiers } from "@photonsurge/shared/alerts/normalise";
import { diffAlert } from "@photonsurge/shared/alerts/diff";
import { log } from "@photonsurge/shared/utill/logger";
import { harvestGdacsExtras } from "./gdacs-extras";

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

/**
 * Did this update push the alert INTO "interesting" territory (severe+)? Used to
 * flag alerts that just escalated so the P1 satellite-snapshot job can grab a
 * frame at the moment they start mattering, not only on its hourly sweep.
 */
function crossesInteresting(
  prev: { maxSeverityRank: number },
  next: { maxSeverityRank: number },
): boolean {
  return next.maxSeverityRank >= 3 && prev.maxSeverityRank < 3;
}

export interface IngestResult {
  source: string;
  count: number;
  inserted: number;
  superseded: number;
  expired: number;
  /** Revision rows appended this tick (a meaningful change was detected). */
  revisions: number;
  /** Alert ids that just escalated to severe+ (feeds the P1 onset snapshot). */
  newlyInteresting: string[];
  /** GDACS metric samples appended this tick (promote-from-raw). */
  seriesSamples?: number;
  /** GDACS resource links harvested this tick. */
  resources?: number;
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
  let revisions = 0;
  const newlyInteresting: string[] = [];
  const geoReasons: Record<string, number> = {};
  for (const a of alerts) {
    let prev: iAlertModel | null = null;
    let persisted = false;
    try {
      const r = await db.alerts.upsert(a);
      if (r.inserted) inserted++;
      prev = r.prev;
      persisted = true;
    } catch (err) {
      // Almost always an invalid polygon rejected by the 2dsphere index. Keep
      // the alert — re-upsert it with geometry stripped so it's never lost.
      // Bucket the rejection reason (counted in the summary line below) instead
      // of logging per-alert: the error message embeds the whole document and
      // would flood the console at hundreds of drops a tick.
      const reason = geoFailReason(err);
      geoReasons[reason] = (geoReasons[reason] ?? 0) + 1;
      const stripped = {
        ...a,
        info: a.info.map((i) => ({ ...i, area: i.area.map((ar) => ({ ...ar, geometry: null })) })),
      };
      try {
        const r = await db.alerts.upsert(stripped);
        if (r.inserted) inserted++;
        prev = r.prev;
        persisted = true;
        geoDropped++;
      } catch (err2) {
        log(TAG, `upsert failed`, { source: source.id, id: a.identifier, err: String(err2) });
      }
    }

    // Revision capture — ONCE, after the doc is persisted, diffed against the
    // ORIGINAL `a` (geometry intact) not the geometry-stripped retry payload, so
    // a stripped retry can't fake an AREA_CHANGED. Only a real in-place update
    // arrives here with a non-null `prev` (a fresh insert and the unchanged
    // fast path both return prev:null), so steady-state re-polls write nothing.
    if (persisted && prev) {
      try {
        const { events, areaKm2, severity } = diffAlert(prev, a);
        if (events.length) {
          await db.alertRevisions.append({
            source: a.source,
            identifier: a.identifier,
            alertId: prev.id,
            at: now.toISOString(),
            msgType: a.msgType,
            status: a.status,
            changes: events,
            severityRank: severity,
            areaKm2,
            expiresAt: a.expiresAt,
            onset: a.info?.[0]?.onset,
          });
          revisions++;
          if (crossesInteresting(prev, a)) newlyInteresting.push(prev.id);
        }
      } catch (err) {
        log(TAG, `revision capture failed`, { source: source.id, id: a.identifier, err: String(err) });
      }
    }

    if (a.references?.length) {
      superseded += await db.alerts.supersede(source.id, referencedIdentifiers(a.references));
    }
  }
  if (geoDropped) log(TAG, `dropped invalid geometry`, { source: source.id, geoDropped, geoReasons });
  let expired = await db.alerts.expire(source.id, now.toISOString());

  // Reconcile (full-snapshot sources only): anything active we DIDN'T see this
  // tick has been withdrawn from the feed → deactivate it so it disappears from
  // the map even though its expiry is still in the future.
  if (source.reconcile) {
    expired += await db.alerts.deactivateMissing(
      source.id,
      alerts.map((a) => a.identifier),
    );
  }

  // GDACS extras — promote numeric metrics (alert score / severity / population)
  // into alert_series and harvest report/icon links into alert_resources, off the
  // feed's `raw` (no extra HTTP). A separate pass so the hot per-alert loop above
  // stays untouched for every other source.
  let seriesSamples = 0;
  let resources = 0;
  if (source.id === "gdacs") {
    for (const a of alerts) {
      try {
        const h = await harvestGdacsExtras(a, db, now);
        seriesSamples += h.samples;
        resources += h.resources;
      } catch (err) {
        log(TAG, `gdacs harvest failed`, { id: a.identifier, err: String(err) });
      }
    }
  }

  const result: IngestResult = {
    source: source.id,
    count: alerts.length,
    inserted,
    superseded,
    expired,
    revisions,
    newlyInteresting,
    geoDropped,
    ...(source.id === "gdacs" ? { seriesSamples, resources } : {}),
    ...(geoDropped ? { geoReasons } : {}),
  };
  log(TAG, `ingested`, result);
  return result;
}
