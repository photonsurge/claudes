import type { getAppDb } from "@photonsurge/shared/db/index";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";

type Db = Awaited<ReturnType<typeof getAppDb>>;

/**
 * Process-wide cache of the country catalog *including its heavy boundary
 * geometry*, loaded ONCE and shared across all requests.
 *
 * WHY: point-in-country (resolveCountryAt in the focus bundle, /api/countries/at)
 * has no server-side geo query — the country boundaries are complex coastlines
 * MongoDB won't accept a 2dsphere index for — so the polygons MUST be loaded into
 * JS to ray-cast. Doing `db.countries.list()` per cut re-parsed every country's
 * full border (millions of [lng,lat] vertices) into a fresh heap allocation on
 * EVERY land cut; with several cuts/OBS sources composing at once, those copies
 * were a dominant slice of the working set (a contributor to public's OOM).
 *
 * The countries collection is static reference data (reseeded only by an admin
 * job), so one shared copy with a coarse TTL is safe: a reseed just shows the old
 * masks until the TTL lapses (or the process restarts). Bounded by design — it's
 * the whole catalog once, never per-request. Set COUNTRY_CACHE_TTL_MS to tune.
 */
const TTL_MS = Number(process.env.COUNTRY_CACHE_TTL_MS || 60 * 60 * 1000);

let cache: iCountryModel[] | null = null;
let loadedAt = 0;
let inflight: Promise<iCountryModel[]> | null = null;

/** The country catalog (with geometry), from the shared cache — loaded once per TTL.
 *  Single-flight: concurrent callers on a cold cache share ONE db read. */
export async function getCachedCountries(db: Db): Promise<iCountryModel[]> {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  if (!inflight) {
    inflight = db.countries
      .list()
      .then((rows) => {
        cache = rows;
        loadedAt = Date.now();
        inflight = null;
        return rows;
      })
      .catch((err) => {
        inflight = null; // let the next caller retry
        throw err;
      });
  }
  return inflight;
}

/** Test/ops hook: drop the cache so the next read reloads (e.g. after a reseed). */
export function clearCountriesCache(): void {
  cache = null;
  loadedAt = 0;
  inflight = null;
}
