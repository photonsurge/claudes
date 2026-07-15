import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";
import { windGeometry } from "@photonsurge/shared/alerts/rings";
import type { AreaGeomInput } from "@photonsurge/shared/db/alert-area-geom-repo";

/**
 * MeteoGate EDR client — the geometry MeteoAlarm's CAP feed leaves out.
 *
 * The CAP feed (see `meteoalarm.ts`) carries the rich warning text but ships an
 * area as a name + `EMMA_ID` geocode with no polygon, so those alerts can't be
 * drawn. EUMETNET's MeteoGate gateway exposes the same warnings over OGC-API EDR
 * WITH geometry, so we use it purely as a boundary source and keep CAP for content.
 *
 * Shape of the feed (verified live), and why each hop exists:
 *   locations/{cc}  → a feature per (alert × area × language). Carries a cheap
 *                     inline BBOX and links, but NOT the EMMA_ID.
 *   links rel=json  → the full CAP alert; the only place the EMMA_ID + areaDesc live.
 *   links rel=geometry → the TRUE area polygon (properties are just a uuid).
 *
 * So resolving one area costs two small fetches. That's affordable only because
 * an EMMA area's boundary is stable: we resolve each code once, cache it forever,
 * and the ledger stops us re-walking alerts we've already resolved.
 */

const BASE = () => process.env.METEOGATE_BASE || "https://api.meteogate.eu/warnings";
const apiKey = () => process.env.METROGATE_API_KEY || "";

/** EDR rejects a window of 24h or more, so stay just under it. */
const WINDOW_HOURS = Number(process.env.METEOGATE_WINDOW_HOURS || 23);

/** Countries to sweep. Mirrors the CAP adapter's members, as EDR location ids. */
const DEFAULT_COUNTRIES = [
  "AD", "AT", "BA", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IL", "IS", "IT", "LT", "LU", "LV", "MD", "ME",
  "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "UA", "UK",
];

export const meteogateCountries = (): string[] =>
  (process.env.METEOGATE_COUNTRIES || DEFAULT_COUNTRIES.join(","))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

export const meteogateEnabled = (): boolean =>
  process.env.ALERTS_METEOGATE_ENABLED !== "false" && !!apiKey();

/** One EDR feature, reduced to the bits that matter. */
export interface EdrFeature {
  alertId: string;
  countryCode?: string;
  /** Inline bbox polygon — free, and the fallback when the true shape won't load. */
  bbox: AlertGeometry | null;
  /** Link to the true area polygon. */
  geometryHref?: string;
  /** Link to the full CAP alert (where the EMMA_ID lives). */
  jsonHref?: string;
  /** Which info/area block of that CAP alert this feature describes. */
  indexInfo: number;
  indexArea: number;
}

export interface EdrPage {
  features: EdrFeature[];
  page: number;
  totalPages: number;
}

const hrefFor = (links: unknown, rel: string): string | undefined => {
  if (!Array.isArray(links)) return undefined;
  const hit = (links as { rel?: string; href?: string }[]).find((l) => l?.rel === rel);
  return typeof hit?.href === "string" ? hit.href : undefined;
};

/** Parse one `locations/{cc}` page. Pure — the tests drive it off a live fixture. */
export function parseLocationsPage(body: string): EdrPage {
  let doc: any;
  try {
    doc = JSON.parse(body);
  } catch {
    return { features: [], page: 1, totalPages: 1 };
  }
  const feats = Array.isArray(doc?.features) ? doc.features : [];
  const meta = doc?.metadata ?? {};
  const features: EdrFeature[] = [];
  for (const f of feats) {
    const p = f?.properties ?? {};
    if (!p.alertId) continue;
    features.push({
      alertId: String(p.alertId),
      countryCode: p.countryCode ? String(p.countryCode) : undefined,
      bbox: windGeometry(f?.geometry ?? null),
      geometryHref: hrefFor(f?.links, "geometry"),
      jsonHref: hrefFor(f?.links, "json"),
      indexInfo: Number(p.indexInfo ?? 0),
      indexArea: Number(p.indexArea ?? 0),
    });
  }
  return {
    features,
    page: Number(meta.page ?? 1),
    totalPages: Number(meta.total_pages ?? 1),
  };
}

/**
 * Pull the EMMA_ID + area name out of a linked CAP alert for a given feature.
 * The feature's indexInfo/indexArea point at the exact block it describes; we
 * fall back to the first area carrying an EMMA_ID because some members emit one
 * area per alert and index it inconsistently.
 */
export function emmaFromCapJson(
  body: string,
  indexInfo = 0,
  indexArea = 0,
): { emmaId?: string; areaDesc?: string; identifier?: string } {
  let doc: any;
  try {
    doc = JSON.parse(body);
  } catch {
    return {};
  }
  const alert = doc?.alert ?? doc;
  const infos: any[] = Array.isArray(alert?.info) ? alert.info : [];
  const identifier = alert?.identifier ? String(alert.identifier) : undefined;

  const emmaOf = (area: any): string | undefined => {
    const codes = Array.isArray(area?.geocode) ? area.geocode : [];
    const hit = codes.find((g: any) => String(g?.valueName).toUpperCase() === "EMMA_ID");
    return hit?.value != null ? String(hit.value) : undefined;
  };

  const targeted = infos[indexInfo]?.area?.[indexArea];
  const direct = emmaOf(targeted);
  if (direct) return { emmaId: direct, areaDesc: targeted?.areaDesc, identifier };

  for (const info of infos) {
    for (const area of Array.isArray(info?.area) ? info.area : []) {
      const e = emmaOf(area);
      if (e) return { emmaId: e, areaDesc: area?.areaDesc, identifier };
    }
  }
  return { identifier };
}

/** The true area polygon from a rel=geometry document. */
export function geometryFromFeatureDoc(body: string): AlertGeometry | null {
  let doc: any;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  return windGeometry((doc?.geometry ?? doc) as AlertGeometry | null);
}

const withKey = (url: string): string =>
  url.includes("apikey=") ? url : `${url}${url.includes("?") ? "&" : "?"}apikey=${apiKey()}`;

async function getText(url: string, signed = false): Promise<string> {
  // The rel=* links are pre-signed object-store URLs — appending our gateway key
  // would break their signature, so only the gateway itself gets one.
  const res = await fetch(signed ? url : withKey(url), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** ISO instant, seconds precision — EDR rejects millis. */
const iso = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;

/** Fetch one page of a country's active warnings. */
export async function fetchCountryPage(cc: string, page: number, now = new Date()): Promise<EdrPage> {
  const to = iso(now);
  const from = iso(new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000));
  const url =
    `${BASE()}/collections/warnings/locations/${encodeURIComponent(cc)}` +
    `?datetime=${encodeURIComponent(`${from}/${to}`)}&page=${page}`;
  return parseLocationsPage(await getText(url));
}

/** Every feature for a country, following pagination. */
export async function fetchCountryFeatures(cc: string, now = new Date()): Promise<EdrFeature[]> {
  const first = await fetchCountryPage(cc, 1, now);
  const out = [...first.features];
  const maxPages = Number(process.env.METEOGATE_MAX_PAGES || 50);
  for (let p = 2; p <= Math.min(first.totalPages, maxPages); p++) {
    const next = await fetchCountryPage(cc, p, now);
    out.push(...next.features);
  }
  return out;
}

/**
 * Resolve one feature to a cacheable area boundary: read its EMMA_ID from the
 * linked CAP alert, then its true polygon. Falls back to the feature's inline
 * bbox if the shape won't load — a rectangle beats no footprint, and a later
 * run upgrades it. Returns null only when there's no EMMA_ID to key on.
 */
export async function resolveFeature(
  f: EdrFeature,
): Promise<{ area: AreaGeomInput | null; emmaId?: string }> {
  if (!f.jsonHref) return { area: null };
  const { emmaId, areaDesc } = emmaFromCapJson(await getText(f.jsonHref, true), f.indexInfo, f.indexArea);
  if (!emmaId) return { area: null };

  let geometry: AlertGeometry | null = null;
  if (f.geometryHref) {
    try {
      geometry = geometryFromFeatureDoc(await getText(f.geometryHref, true));
    } catch {
      geometry = null; // fall through to the bbox
    }
  }
  const precision: "exact" | "bbox" = geometry ? "exact" : "bbox";
  geometry = geometry ?? f.bbox;
  if (!geometry) return { area: null, emmaId };

  return {
    emmaId,
    area: { emmaId, countryCode: f.countryCode, areaDesc, geometry, precision, source: "meteogate" },
  };
}
