import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";

export interface CapIdEnrichResult {
  /** Alerts stamped with a canonical CAP id this tick. */
  filled: number;
  /** WMO alerts whose capurl isn't resolved yet (the sync job will get to them). */
  unresolved: number;
}

/**
 * Sources that publish the national CAP identifier as their own `identifier`.
 * For these, `capId` is free — no lookup, no fetch.
 */
const DIRECT_SOURCES = new Set(["meteoalarm", "nws"]);

/**
 * Stamp every alert with the canonical national CAP identifier it reports, in
 * place, before it's persisted.
 *
 * `identifier` is per-source and can never merge (it's half the dedup key), but
 * WMO and MeteoAlarm are republishing the SAME national CAP message. `capId` is
 * the id that message carries, so it's the exact key that links them — see
 * docs/alert-dedup-merge-plan.md.
 *
 * - MeteoAlarm / NWS publish it directly as `identifier`.
 * - WMO keys by `capurl` and leaves identifier empty, so its capId comes from the
 *   cache the sync job fills. A miss is normal and simply leaves `capId` unset.
 * - GDACS has no national CAP behind it; it never gets a capId.
 *
 * Additive only: this stamps an id, it does not merge anything yet.
 */
export async function enrichCapIds(alerts: iAlert[], db: AppDb): Promise<CapIdEnrichResult> {
  const res: CapIdEnrichResult = { filled: 0, unresolved: 0 };

  const direct = alerts.filter((a) => DIRECT_SOURCES.has(a.source));
  for (const a of direct) {
    if (a.identifier) {
      a.capId = a.identifier;
      res.filled++;
    }
  }

  // WMO's `identifier` IS the capurl (see wmo.ts) — that's what we look up.
  const wmo = alerts.filter((a) => a.source === "wmo" && a.identifier);
  if (!wmo.length) return res;

  const cache = await db.capIds.byCapurls(wmo.map((a) => a.identifier));
  for (const a of wmo) {
    const hit = cache.get(a.identifier);
    if (hit) {
      a.capId = hit;
      res.filled++;
    } else {
      res.unresolved++;
    }
  }
  return res;
}
