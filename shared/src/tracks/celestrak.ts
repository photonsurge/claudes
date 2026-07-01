/**
 * Celestrak GP (General Perturbations) TLE feeds — free, no key. We poll a named
 * group, not the whole catalog. Used by the worker (ingest into Mongo) and the
 * public route (live fallback). Caching is left to the caller.
 */
import type { SatelliteMeta } from "./types";

export interface SatelliteGroup {
  id: string;
  label: string;
}

export const SATELLITE_GROUPS: SatelliteGroup[] = [
  { id: "visual", label: "Brightest (visual)" },
  { id: "stations", label: "Space stations" },
  // Notable named individual satellites — the interesting, one-of-a-kind craft.
  // Weather/environment birds are especially on-brand for the globe.
  { id: "weather", label: "Weather" },
  { id: "noaa", label: "NOAA (polar)" },
  { id: "goes", label: "GOES (geostationary)" },
  { id: "resource", label: "Earth observation" },
  { id: "science", label: "Science (Hubble, etc.)" },
  { id: "geo", label: "Geostationary" },
  { id: "tdrss", label: "TDRSS (NASA relay)" },
  { id: "sarsat", label: "Search & rescue" },
  { id: "dmc", label: "Disaster monitoring" },
  { id: "engineering", label: "Engineering / tech-demo" },
  { id: "gps-ops", label: "GPS (navigation)" },
  { id: "galileo", label: "Galileo (navigation)" },
  // Available but intentionally NOT ingested by default — the broadband
  // megaconstellations swamp everything else (thousands of near-identical craft).
  // Kept selectable for anyone who wants them. Celestrak GROUP ids verified live.
  { id: "starlink", label: "Starlink (SpaceX)" },
  { id: "oneweb", label: "OneWeb" },
  { id: "kuiper", label: "Amazon Kuiper" },
  { id: "qianfan", label: "Qianfan · 千帆 (China)" },
  { id: "active", label: "All active (~11k)" },
];

export const DEFAULT_SATELLITE_GROUP = "visual";

export const isValidGroup = (group: string): boolean =>
  SATELLITE_GROUPS.some((g) => g.id === group);

/** Fetch raw TLE text for a group. */
export async function fetchGroupTle(group: string): Promise<string> {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(
    group,
  )}&FORMAT=tle`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LiveWeatherGlobe/0.1 (satellite overlay; personal use)" },
  });
  if (!res.ok) throw new Error(`celestrak fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * One row of Celestrak's satellite catalog (SATCAT) — the descriptive metadata
 * (owner, launch, orbit) that the bare TLE feeds lack. Numeric fields come as
 * numbers; empty strings mean "unknown". We only read the subset we surface.
 */
export interface SatcatRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  NORAD_CAT_ID: number;
  OBJECT_TYPE?: string;
  OPS_STATUS_CODE?: string;
  OWNER?: string;
  LAUNCH_DATE?: string;
  LAUNCH_SITE?: string;
  DECAY_DATE?: string;
  PERIOD?: number;
  INCLINATION?: number;
  APOGEE?: number;
  PERIGEE?: number;
}

/**
 * SATCAT owner codes → readable names. Celestrak's codes aren't ISO country
 * codes (agencies + multinationals appear too), so we map the common ones and
 * fall back to the raw code for the long tail. Reference: celestrak.org/satcat.
 */
export const SATCAT_OWNERS: Record<string, string> = {
  US: "United States",
  PRC: "China",
  CIS: "Russia / CIS",
  ESA: "European Space Agency",
  EUME: "EUMETSAT",
  EUTE: "Eutelsat",
  FR: "France",
  JPN: "Japan",
  IND: "India",
  ESRO: "Europe (ESRO)",
  UK: "United Kingdom",
  ITSO: "Intelsat",
  SES: "SES",
  GER: "Germany",
  CA: "Canada",
  ROC: "Taiwan",
  SKOR: "South Korea",
  ISRA: "Israel",
  BRAZ: "Brazil",
  ITA: "Italy",
  SPN: "Spain",
  AUS: "Australia",
  UAE: "United Arab Emirates",
  TURK: "Turkey",
  NOR: "Norway",
  LUXE: "Luxembourg",
  NATO: "NATO",
  GLOB: "Globalstar",
  ORB: "ORBCOMM",
  O3B: "SES O3b",
  IRID: "Iridium",
  PALA: "Palau",
  ARGN: "Argentina",
};

/** Resolve a SATCAT owner code to a readable name (falls back to the code). */
export const ownerName = (code?: string): string | undefined =>
  code ? SATCAT_OWNERS[code] ?? code : undefined;

/** Fetch a group's SATCAT records as JSON. Same GROUP ids as the TLE feed. */
export async function fetchGroupSatcat(group: string): Promise<SatcatRecord[]> {
  const url = `https://celestrak.org/satcat/records.php?GROUP=${encodeURIComponent(
    group,
  )}&FORMAT=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LiveWeatherGlobe/0.1 (satellite overlay; personal use)" },
  });
  if (!res.ok) throw new Error(`satcat fetch failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return Array.isArray(body) ? (body as SatcatRecord[]) : [];
}

/** Keep a positive finite number, else undefined (SATCAT uses "" / 0 for unknown). */
const num = (v: number | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : undefined;

/** Keep a non-empty trimmed string, else undefined. */
const str = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** Map one SATCAT row to `{ noradId, meta }` for joining onto the stored TLEs. */
export function satcatToMeta(r: SatcatRecord): { noradId: string; meta: SatelliteMeta } {
  return {
    noradId: String(r.NORAD_CAT_ID),
    meta: {
      objectId: str(r.OBJECT_ID),
      owner: str(r.OWNER),
      ownerName: ownerName(str(r.OWNER)),
      objectType: str(r.OBJECT_TYPE),
      launchDate: str(r.LAUNCH_DATE),
      launchSite: str(r.LAUNCH_SITE),
      periodMin: num(r.PERIOD),
      inclinationDeg: num(r.INCLINATION),
      apogeeKm: num(r.APOGEE),
      perigeeKm: num(r.PERIGEE),
    },
  };
}
