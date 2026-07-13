/**
 * The WORLDWIDE Smithsonian GVP volcano catalog (~1,470 volcanoes) via the USGS
 * VSC API — every GVP volcano with its number + coordinates, independent of the
 * weekly-bulletin cache. Used to crosswalk an external source's volcano (a GeoNet
 * slug) onto our canonical `gvp:<vnum>` id by coordinate, even when that volcano
 * ISN'T in the current weekly bulletin (most quiet foreign volcanoes aren't). The
 * matched entry also seeds a stub volcano doc so the source's status has a home.
 *
 * Undocumented VSC application-support API (like the other USGS endpoints):
 * tolerant parsing, treat as best-effort, never couple UI to its shape.
 */
export const USGS_GVP_CATALOG_URL =
  process.env.USGS_GVP_CATALOG_URL || "https://volcanoes.usgs.gov/vsc/api/volcanoApi/volcanoesGVP";

export interface GvpCatalogEntry {
  /** Our canonical `gvp:<vnum>` id. */
  volcanoId: string;
  name: string;
  country?: string;
  lat: number;
  lng: number;
  elevationM?: number;
  sourceUrl?: string;
}

/** Pure parse of the catalog list (no HTTP). */
export function parseGvpCatalog(json: unknown): GvpCatalogEntry[] {
  const list: any[] = Array.isArray(json) ? json : [];
  const out: GvpCatalogEntry[] = [];
  for (const r of list) {
    const vnum = String(r?.vnum ?? "").trim();
    const lat = Number(r?.latitude);
    const lng = Number(r?.longitude);
    if (!vnum || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      volcanoId: `gvp:${vnum}`,
      name: String(r?.vName ?? "").trim() || vnum,
      country: typeof r?.country === "string" && r.country.trim() ? r.country.trim() : undefined,
      lat,
      lng,
      elevationM: Number.isFinite(Number(r?.elevation_m)) ? Number(r.elevation_m) : undefined,
      sourceUrl: typeof r?.webpage === "string" ? r.webpage : `https://volcano.si.edu/volcano.cfm?vn=${vnum}`,
    });
  }
  return out;
}

/** Great-circle distance (km) between two lng/lat points. */
function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Nearest catalog entry to a point within `maxKm`, with its distance — or null. */
export function nearestGvp(
  entries: GvpCatalogEntry[],
  lng: number,
  lat: number,
  maxKm: number,
): { entry: GvpCatalogEntry; distanceKm: number } | null {
  let best: { entry: GvpCatalogEntry; distanceKm: number } | null = null;
  for (const e of entries) {
    const d = haversineKm(lng, lat, e.lng, e.lat);
    if (d <= maxKm && (!best || d < best.distanceKm)) best = { entry: e, distanceKm: d };
  }
  return best;
}

export async function fetchGvpCatalog(fetchImpl: typeof fetch = fetch): Promise<GvpCatalogEntry[]> {
  const res = await fetchImpl(USGS_GVP_CATALOG_URL);
  if (!res.ok) throw new Error(`gvp catalog ${res.status}`);
  return parseGvpCatalog(await res.json());
}
