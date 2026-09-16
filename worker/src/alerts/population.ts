import { createHash } from "crypto";
import type { Model } from "mongoose";
import type { iCityModel } from "@photonsurge/shared/db/city-model";
import { ALERT_CITY_CAP, type AlertGeometry, type iAlertCity } from "@photonsurge/shared/db/alert-model";
import { log } from "@photonsurge/shared/utill/logger";
import { citiesIn } from "./blob-cities";

const TAG = "alerts:population";

/**
 * "How many people is this warning over?" — the summed population of every
 * catalogued city inside an alert's footprint.
 *
 * A cities-based ESTIMATE, chosen because the work is already paid for: the
 * cities carry a 2dsphere `loc`, so the count is one indexed `$geoWithin`
 * (reusing {@link citiesIn}, the exact lookup the blob cache uses) rather than a
 * census we don't have. It undercounts rural population and counts a whole city
 * when the polygon only clips its edge — order-of-magnitude, not exact.
 *
 * Computed in the worker's reconcile sweep, not at ingest, because an alert's
 * geometry is often BACKFILLED after it lands (MeteoAlarm ships EMMA codes;
 * the polygon arrives from the boundary cache a few ticks later). A count taken
 * at ingest would read zero for exactly the European alerts that matter, and
 * never recover. The sweep recomputes whenever the footprint changes — see
 * {@link populationSig}.
 *
 * The same `$geoWithin` also yields WHICH cities are inside, and the biggest of
 * them are kept on the alert (`iAlert.cities`) as the on-air CITY GUIDE for a
 * storm cut — so the broadcast surface pages through the towns actually under
 * the warning without ever running a point-in-polygon of its own.
 */

/** An alert as the sweep scans it — footprint metadata only, no coordinates. */
export interface PopulationCandidate {
  id: string;
  sent?: string;
  population?: number;
  cityCount?: number;
  populationSig?: string;
  /** The stored CITY GUIDE, ids only — absent on an alert counted before the
   *  guide existed, which is the one signature-matching case that still needs
   *  a pass. */
  cities?: { id: string }[];
  info: { area: { areaDesc?: string; geometry?: { type?: string } | null }[] }[];
}

export interface PopulationDeps {
  alerts: {
    populationCandidates(): Promise<PopulationCandidate[]>;
    areaGeometries(id: string): Promise<AlertGeometry[]>;
    setPopulation(
      id: string,
      v: { population: number | null; cityCount: number; cities: iAlertCity[]; populationSig: string },
    ): Promise<void>;
  };
  cities: { model: Model<iCityModel> };
}

export interface PopulationSyncResult {
  /** Active alerts scanned. */
  scanned: number;
  /** Alerts whose footprint changed and got a fresh city count. */
  recomputed: number;
  /** Alerts with no drawable shape — their `population` was cleared. */
  cleared: number;
  /** Alerts whose signature still matched — no geo work done. */
  unchanged: number;
}

/** Whether at least one of the alert's areas carries a drawable polygon. */
export function hasDrawableGeometry(a: PopulationCandidate): boolean {
  return (a.info ?? []).some((i) => (i.area ?? []).some((ar) => !!ar.geometry?.type));
}

/**
 * A fingerprint of the alert's DRAWABLE footprint — its `sent` version plus, per
 * area, whether that area has a geometry yet. It changes on the only two things
 * that move the count: a new CAP version (new `sent`, possibly new shape) or an
 * area's polygon being backfilled (`geometry` null → present). It deliberately
 * does NOT hash coordinates, so the sweep can compute it from the cheap
 * geometry-free scan and skip re-clipping unchanged alerts.
 */
export function populationSig(a: PopulationCandidate): string {
  const parts: string[] = [a.sent ?? ""];
  for (const info of a.info ?? []) {
    for (const area of info.area ?? []) {
      parts.push(`${area.areaDesc ?? ""}:${area.geometry?.type ? 1 : 0}`);
    }
  }
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** All the alert's polygons fused into one MultiPolygon, so a `$geoWithin`
 *  against it counts a city sitting in two of the areas exactly once. */
export function combineGeometries(geometries: AlertGeometry[]): AlertGeometry | null {
  const coordinates: unknown[] = [];
  for (const g of geometries) {
    if (!g) continue;
    if (g.type === "Polygon") coordinates.push(g.coordinates);
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates as unknown[]) coordinates.push(poly);
  }
  return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
}

const byPopulation = (a: iAlertCity, b: iAlertCity) => (b.population ?? 0) - (a.population ?? 0);

/**
 * People inside an alert's footprint: cities inside the union of its polygons,
 * their populations summed, deduped by city id — plus the biggest
 * {@link ALERT_CITY_CAP} of those cities, the alert's CITY GUIDE.
 *
 * The union query is the fast path (one indexed lookup, dedup for free). If
 * Mongo rejects the fused shape — self-intersecting rings on real borders, the
 * same S2 "Loop is not valid" that bites the blob unions — fall back to asking
 * each area on its own and merging by id, so one bad ring costs precision, not
 * the whole count.
 */
export async function populationOfGeometries(
  cityModel: Model<iCityModel>,
  geometries: AlertGeometry[],
): Promise<{ population: number; cityCount: number; cities: iAlertCity[] }> {
  const found = new Map<string, iAlertCity>();
  const combined = combineGeometries(geometries);
  if (!combined) return { population: 0, cityCount: 0, cities: [] };

  try {
    for (const c of await citiesIn(cityModel, combined)) found.set(c.id, c);
  } catch {
    for (const g of geometries) {
      try {
        for (const c of await citiesIn(cityModel, g)) found.set(c.id, c);
      } catch {
        // One unusable area must not lose the alert its other areas' cities.
      }
    }
  }

  let population = 0;
  for (const c of found.values()) population += c.population ?? 0;
  const cities = [...found.values()].sort(byPopulation).slice(0, ALERT_CITY_CAP);
  return { population, cityCount: found.size, cities };
}

/**
 * Refresh the people-estimate on every active alert whose footprint has changed
 * since it was last counted. The reconcile sweep's population step.
 *
 * Steady state does no geo work: it scans a geometry-free projection, finds
 * every signature already current, and returns all-`unchanged`. The cost only
 * lands on new alerts and on ones whose polygons were just backfilled — which is
 * exactly when the count is wrong and worth paying for.
 *
 * `force` recomputes EVERY alert regardless of signature — the admin "recount"
 * button. The signature tracks an alert's own footprint, not the cities dataset
 * underneath it, so a city reseed / a late `loc` backfill leaves every count
 * stale with no signature change to notice. Force is the only way to pick that
 * up (mirrors the alert-blobs full-rebuild button).
 */
export async function resyncAlertPopulations(
  deps: PopulationDeps,
  opts: { force?: boolean } = {},
): Promise<PopulationSyncResult> {
  const candidates = await deps.alerts.populationCandidates();
  const result: PopulationSyncResult = {
    scanned: candidates.length,
    recomputed: 0,
    cleared: 0,
    unchanged: 0,
  };

  for (const a of candidates) {
    const sig = populationSig(a);
    // A matching signature still needs a pass when the alert was counted before
    // the CITY GUIDE existed: somebody is inside (`cityCount`) but no list was
    // kept. Self-heals lazily, one alert at a time, instead of a thundering
    // recount of every active alert on the first sweep after deploy.
    const guideMissing = !Array.isArray(a.cities) && (a.cityCount ?? 0) > 0;
    if (!opts.force && a.populationSig === sig && !guideMissing) {
      result.unchanged++;
      continue;
    }
    if (!hasDrawableGeometry(a)) {
      await deps.alerts.setPopulation(a.id, { population: null, cityCount: 0, cities: [], populationSig: sig });
      result.cleared++;
      continue;
    }
    const geometries = await deps.alerts.areaGeometries(a.id);
    const { population, cityCount, cities } = await populationOfGeometries(deps.cities.model, geometries);
    await deps.alerts.setPopulation(a.id, { population, cityCount, cities, populationSig: sig });
    result.recomputed++;
  }

  if (result.recomputed || result.cleared) log(TAG, `resynced alert populations`, result);
  return result;
}
