/**
 * The CITY GUIDE of a targeted cut (storm / quake / volcano / track) — which
 * cities the deck pages through after the lede.
 *
 * It used to be the eight most-populous cities inside the CAMERA box, which at
 * a storm's zoom is ~20° wide with no country or footprint test: a heat warning
 * over the Sea of Galilee aired Mosul, Baghdad and Cairo as "CITY 5 OF 8". The
 * rule now follows the event:
 *
 *  • a storm with a drawable shape → the cities INSIDE its footprint, biggest
 *    first. The worker's reconcile sweep keeps them on the alert (`iAlert.cities`,
 *    the same `$geoWithin` that counts the people under the warning), so this is
 *    one indexed read plus a City load by id — never a point-in-polygon on the
 *    broadcast surface;
 *  • a storm with no shape (geocode-only), one nobody catalogued is inside, or
 *    one the sweep hasn't reached yet → the nearest towns of ≥10k people IN THE
 *    ALERT'S COUNTRY (decoded from its CAP identifier), closest first;
 *  • a quake / volcano / track → the nearest towns of ≥10k people, closest first,
 *    within NEAREST_CITY_MAX_M so a mid-ocean quake lists nobody rather than a
 *    continent's far coast (the deck self-hides on an empty guide).
 *
 * Deps are structural (`AppDb` satisfies them) so this is testable without a
 * database — the same pattern as `blobs.ts`.
 */
import type { SegmentKind } from "@photonsurge/shared/director";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import type { AlertFootprintCities } from "@photonsurge/shared/db/alerts-repo";
import type { City } from "../cities";
import type { TopCitiesBasis } from "./types";

/** How many footprint cities a storm guide airs (the deck's TOP_CITY_LIMIT). */
export const TARGET_CITY_LIMIT = 8;
/** How many nearest towns a point event (or a shapeless storm) airs. */
export const NEAREST_CITY_COUNT = 5;
/** A "town" for the nearest rule — below this the guide would page through hamlets. */
export const NEAREST_CITY_MIN_POP = 10_000;
/** Search radius for the nearest rule, metres. ~800 km covers a sparse interior
 *  (the outback, Siberia, the Sahara) without letting a mid-Pacific quake borrow
 *  a continent's coast — the same reach the local-time lookup uses. */
export const NEAREST_CITY_MAX_M = 800_000;

export interface TargetCityDeps {
  alerts: { footprintCities(subject: string): Promise<AlertFootprintCities | null> };
  cities: {
    getAll(
      query: Record<string, unknown>,
      opts: { sort?: Record<string, 1 | -1> | null; limit?: number },
    ): Promise<{ data?: unknown[] } | null | undefined>;
    model: {
      find(
        filter: Record<string, unknown>,
        projection?: Record<string, 0 | 1>,
      ): { limit(n: number): { lean(): { exec(): Promise<unknown[]> } } };
    };
  };
}

export interface TargetCityRequest {
  kind: SegmentKind;
  /** The focus subject — for a storm, "<source>:<identifier>". */
  subject: string | null;
  /** The event's location ([lng, lat] split), the nearest rule's origin. */
  lng: number;
  lat: number;
}

export interface TargetCities {
  cities: City[];
  basis: TopCitiesBasis;
}

export async function targetCitiesFor(db: TargetCityDeps, req: TargetCityRequest): Promise<TargetCities> {
  if (req.kind === "storm" && req.subject) {
    const alert = await db.alerts.footprintCities(req.subject);
    const inside = alert?.cities ?? [];
    if (inside.length) {
      // The alert's list is already biggest-first and capped a little above the
      // airable count; load the City docs (photo, blurb, capital flag) by id and
      // keep the alert's order — a city with no doc behind it simply drops out.
      const ids = inside.slice(0, TARGET_CITY_LIMIT).map((c) => c.id);
      const res = await db.cities.getAll({ id: { $in: ids } }, { sort: null, limit: 0 });
      const byId = new Map(((res?.data ?? []) as City[]).map((c) => [c.id, c]));
      const cities = ids.map((id) => byId.get(id)).filter((c): c is City => !!c);
      if (cities.length) return { cities, basis: "footprint" };
    }
    // No shape, nobody inside, or not counted yet: stay in the alert's country.
    const cc = alert ? alertCountryCode(alert) : undefined;
    return { cities: await nearestCities(db, req.lng, req.lat, cc), basis: "nearest" };
  }
  return { cities: await nearestCities(db, req.lng, req.lat), basis: "nearest" };
}

/** The closest NEAREST_CITY_COUNT towns of ≥ NEAREST_CITY_MIN_POP people to a
 *  point, closest first, optionally within one country — `$near` on the cities'
 *  2dsphere `loc`, so the distance ordering comes from the index. */
async function nearestCities(db: TargetCityDeps, lng: number, lat: number, cc?: string): Promise<City[]> {
  const filter: Record<string, unknown> = {
    population: { $gte: NEAREST_CITY_MIN_POP },
    loc: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: NEAREST_CITY_MAX_M,
      },
    },
  };
  // Both catalog casings of the code, like every other city-by-country read.
  if (cc) filter.cc = { $in: [cc.toLowerCase(), cc.toUpperCase()] };
  const docs = await db.cities.model.find(filter, { _id: 0, __v: 0 }).limit(NEAREST_CITY_COUNT).lean().exec();
  return docs as City[];
}
