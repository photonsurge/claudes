import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { adminKey, type AdminAreaCandidate } from "@photonsurge/shared/db/admin-area-geom-repo";
import { gadmNameKey } from "./gadmNameKey";
import { resolveAreaNames } from "./nameResolve";

export interface GeomEnrichResult {
  /** Areas that arrived with no geometry and could be drawn after all. */
  filled: number;
  /** Of those, how many got the true boundary rather than the bbox fallback. */
  exact: number;
  /** Of those, how many came from the static admin (NUTS) cache rather than EMMA. */
  admin: number;
  /** Of those, how many were name-matched (China/GADM) rather than code-matched. */
  named: number;
  /** Of the named fills, how many were a shared name disambiguated by a sibling. */
  namedAmbiguous: number;
  /** Areas still geometry-less (code not resolved yet, or no recognised code). */
  unresolved: number;
}

const EMMA = "EMMA_ID";

/** Geocode schemes we can resolve from the static admin (GISCO) cache. */
const ADMIN_SCHEMES = new Set((process.env.ADMIN_SCHEMES || "NUTS2,NUTS3").split(",").map((s) => s.trim().toUpperCase()));

/**
 * Alert senders whose areas carry a NAME but no code and no polygon, mapped to the
 * name-keyed boundary scheme that resolves them. China's CMA is the only such feed
 * today ("cn-cma-xx" → GADM3 counties). Kept a strict allow-list on purpose: a
 * name-join is fuzzy, so it runs ONLY for feeds we've measured, never as a blanket
 * fallback. Format `sender:scheme,sender:scheme`.
 */
const NAME_SCHEMES: Map<string, string> = new Map(
  (process.env.ALERT_NAME_SCHEMES || "cn-cma-xx:GADM3")
    .split(",")
    .map((p) => p.trim().split(":"))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1])
    .map(([sender, scheme]) => [sender.toLowerCase(), scheme.toUpperCase()]),
);

const nameSchemeFor = (alert: { sender?: string }): string | undefined =>
  NAME_SCHEMES.get((alert.sender || "").toLowerCase());

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
  const res: GeomEnrichResult = { filled: 0, exact: 0, admin: 0, named: 0, namedAmbiguous: 0, unresolved: 0 };

  // Two resolvers, one pass: EMMA (dynamic MeteoGate cache) and the static admin
  // codes (GISCO/NUTS). An area carries at most one of each; collect both wants.
  const emmaWanted: string[] = [];
  const adminWanted: { scheme: string; code: string }[] = [];
  // Name-matched wants (China/GADM), grouped by the scheme each sender resolves to.
  const nameWanted = new Map<string, Set<string>>();
  for (const a of alerts) {
    const nameScheme = nameSchemeFor(a);
    for (const info of a.info ?? []) {
      for (const area of info.area ?? []) {
        if (hasGeometry(area)) continue;
        const emma = emmaOf(area);
        if (emma) emmaWanted.push(emma);
        else {
          const admin = adminCodeOf(area);
          if (admin) adminWanted.push(admin);
          else if (nameScheme) {
            const key = gadmNameKey(area.areaDesc as string | undefined);
            if (key) (nameWanted.get(nameScheme) ?? nameWanted.set(nameScheme, new Set()).get(nameScheme)!).add(key);
          }
        }
      }
    }
  }
  // No early-out even when nothing is wanted: an area that came WITH a polygon
  // makes the doc indexable and a null sibling would then reject the write, so we
  // must still walk everything below to drop nulls.
  const emmaCache = emmaWanted.length ? await db.alertAreaGeom.byEmmaIds(emmaWanted) : new Map();
  const adminCache = adminWanted.length ? await db.adminAreaGeom.byCodes(adminWanted) : new Map();
  // One batched name query per scheme (only GADM3 today).
  const nameCaches = new Map<string, Map<string, AdminAreaCandidate[]>>();
  for (const [scheme, keys] of nameWanted) {
    nameCaches.set(scheme, await db.adminAreaGeom.byNameKeys(scheme, [...keys]));
  }

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

  // Name-match pass (China/GADM), AFTER the code pass so that EMMA/admin fills and
  // the feed's own polygons are already present as anchors. Per-alert, because
  // disambiguating a shared county name needs the alert's OTHER areas — see
  // resolveAreaNames. Additive only; it never sets null, so the drop-null invariant
  // above is untouched.
  if (nameCaches.size) {
    for (const a of alerts) {
      const scheme = nameSchemeFor(a);
      const cache = scheme ? nameCaches.get(scheme) : undefined;
      if (!cache || !cache.size) continue;
      const areas = (a.info ?? []).flatMap((info) => info.area ?? []);
      for (const d of resolveAreaNames(areas, cache)) {
        areas[d.index].geometry = d.geometry;
        res.filled++;
        res.exact++; // a real administrative county boundary, not a bbox
        res.named++;
        if (d.disambiguated) res.namedAmbiguous++;
      }
    }
  }
  return res;
}
