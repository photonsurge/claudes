import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { adminKey } from "@photonsurge/shared/db/admin-area-geom-repo";

export interface GeomEnrichResult {
  /** Areas that arrived with no geometry and could be drawn after all. */
  filled: number;
  /** Of those, how many got the true boundary rather than the bbox fallback. */
  exact: number;
  /** Of those, how many came from the static admin (NUTS) cache rather than EMMA. */
  admin: number;
  /** Areas still geometry-less (code not resolved yet, or no recognised code). */
  unresolved: number;
}

const EMMA = "EMMA_ID";

/** Geocode schemes we can resolve from the static admin (GISCO) cache. */
const ADMIN_SCHEMES = new Set((process.env.ADMIN_SCHEMES || "NUTS2,NUTS3").split(",").map((s) => s.trim().toUpperCase()));

const emmaOf = (area: { geocodes?: { valueName: string; value: string }[] }): string | undefined =>
  area.geocodes?.find((g) => g.valueName?.toUpperCase() === EMMA)?.value || undefined;

/** First (scheme, code) pair on an area that a static admin cache can resolve. */
const adminCodeOf = (area: {
  geocodes?: { valueName: string; value: string }[];
}): { scheme: string; code: string } | undefined => {
  for (const g of area.geocodes ?? []) {
    const scheme = g.valueName?.toUpperCase();
    if (scheme && g.value && ADMIN_SCHEMES.has(scheme)) return { scheme, code: g.value };
  }
  return undefined;
};

const hasGeometry = (area: { geometry?: unknown }): boolean =>
  !!(area.geometry as { coordinates?: unknown } | null)?.coordinates;

/**
 * Give geocode-only alert areas a footprint, in place, before they're persisted.
 *
 * MeteoAlarm identifies an area by `EMMA_ID` and ships no polygon, so those
 * alerts render nowhere — no globe, no director framing. The EMMA boundary cache
 * (filled asynchronously by the MeteoGate sync) resolves that code to a real
 * shape, and since EMMA areas are stable administrative regions the join is a
 * single batched read per tick rather than a fetch per alert.
 *
 * Only ever ADDS geometry: an area that came with its own polygon (GDACS, WMO)
 * is left exactly as the source sent it.
 */
export async function enrichAreaGeometry(alerts: iAlert[], db: AppDb): Promise<GeomEnrichResult> {
  const res: GeomEnrichResult = { filled: 0, exact: 0, admin: 0, unresolved: 0 };

  // Two resolvers, one pass: EMMA (dynamic MeteoGate cache) and the static admin
  // codes (GISCO/NUTS). An area carries at most one of each; collect both wants.
  const emmaWanted: string[] = [];
  const adminWanted: { scheme: string; code: string }[] = [];
  for (const a of alerts) {
    for (const info of a.info ?? []) {
      for (const area of info.area ?? []) {
        if (hasGeometry(area)) continue;
        const emma = emmaOf(area);
        if (emma) emmaWanted.push(emma);
        else {
          const admin = adminCodeOf(area);
          if (admin) adminWanted.push(admin);
        }
      }
    }
  }
  // No early-out even when nothing is wanted: an area that came WITH a polygon
  // makes the doc indexable and a null sibling would then reject the write, so we
  // must still walk everything below to drop nulls.
  const emmaCache = emmaWanted.length ? await db.alertAreaGeom.byEmmaIds(emmaWanted) : new Map();
  const adminCache = adminWanted.length ? await db.adminAreaGeom.byCodes(adminWanted) : new Map();

  for (const a of alerts) {
    for (const info of a.info ?? []) {
      for (const area of info.area ?? []) {
        if (hasGeometry(area)) continue;

        // EMMA first (it's the true warning-area boundary); fall back to a static
        // admin code (NUTS) only when there's no EMMA_ID on the area.
        const emma = emmaOf(area);
        const emmaHit = emma ? emmaCache.get(emma) : undefined;
        if (emmaHit) {
          area.geometry = emmaHit.geometry;
          res.filled++;
          if (emmaHit.precision === "exact") res.exact++;
          continue;
        }

        const admin = !emma ? adminCodeOf(area) : undefined;
        const adminGeom = admin ? adminCache.get(adminKey(admin.scheme, admin.code)) : undefined;
        if (adminGeom) {
          area.geometry = adminGeom;
          res.filled++;
          res.exact++; // GISCO boundaries are the real administrative shape
          res.admin++;
          continue;
        }

        if (emma || admin) res.unresolved++;
        // Drop the null rather than leave it: Mongo's 2dsphere is sparse per DOC,
        // so once a SIBLING area gets a geometry the whole doc is indexed and an
        // explicit null here rejects the write — which would send ingest down the
        // strip-everything fallback and lose the geometry we DID resolve. A missing
        // field indexes fine. Partly-resolved alerts are the norm.
        delete area.geometry;
      }
    }
  }
  return res;
}
