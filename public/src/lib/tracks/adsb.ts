import type { Aircraft } from "./types";

/**
 * Keyless community ADS-B feeds (adsb.lol / adsb.fi) — no account needed, unlike
 * OpenSky. Query is point+radius (nm, capped ~250), not bbox, so we derive a
 * centre + radius from the viewport. Response is the readsb `ac[]` shape (alt in
 * feet, speed in knots). Swap providers with ADSB_API_BASE.
 */
const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;
const MAX_RADIUS_NM = 250;

const PROVIDER_BASES: Record<string, string> = {
  adsblol: "https://api.adsb.lol/v2",
  adsbfi: "https://opendata.adsb.fi/api/v2",
};

interface AdsbAc {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
}

export function parseAdsb(json: unknown): Aircraft[] {
  const list = (json as { ac?: unknown[] } | null)?.ac;
  if (!Array.isArray(list)) return [];

  const out: Aircraft[] = [];
  for (const a of list as AdsbAc[]) {
    if (typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    const onGround = a.alt_baro === "ground";
    const altFt =
      typeof a.alt_geom === "number"
        ? a.alt_geom
        : typeof a.alt_baro === "number"
          ? a.alt_baro
          : undefined;
    out.push({
      icao24: String(a.hex ?? "").trim(),
      callsign: (a.flight ?? "").trim() || undefined,
      lng: a.lon,
      lat: a.lat,
      altM: altFt != null ? altFt * FT_TO_M : onGround ? 0 : undefined,
      velocityMS: typeof a.gs === "number" ? a.gs * KT_TO_MS : undefined,
      headingDeg: typeof a.track === "number" ? a.track : undefined,
      onGround,
    });
  }
  return out;
}

/** Centre + radius (nm) covering a bbox [w,s,e,n], clamped to the feed's max. */
export function bboxToPointRadius(bbox: [number, number, number, number]): {
  lat: number;
  lon: number;
  distNm: number;
} {
  const [w, s, e, n] = bbox;
  const lat = (s + n) / 2;
  const lon = (w + e) / 2;
  const dLat = (n - s) / 2;
  const dLon = ((e - w) / 2) * Math.cos((lat * Math.PI) / 180);
  const nm = Math.hypot(dLat, dLon) * 60; // ~60 nm per degree
  return { lat, lon, distNm: Math.min(MAX_RADIUS_NM, Math.max(25, Math.round(nm))) };
}

export async function fetchAdsb(
  bbox?: [number, number, number, number],
): Promise<Aircraft[]> {
  const provider = process.env.AIRCRAFT_PROVIDER || "adsblol";
  const base = process.env.ADSB_API_BASE || PROVIDER_BASES[provider] || PROVIDER_BASES.adsblol;

  const { lat, lon, distNm } = bbox
    ? bboxToPointRadius(bbox)
    : { lat: 51.5, lon: -0.1, distNm: MAX_RADIUS_NM };

  const url = `${base}/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${distNm}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LiveWeatherGlobe/0.1 (personal weather globe)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`adsb fetch failed: ${res.status} ${res.statusText}`);
  return parseAdsb(await res.json());
}
