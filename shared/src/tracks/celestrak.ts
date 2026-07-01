/**
 * Celestrak GP (General Perturbations) TLE feeds — free, no key. We poll a named
 * group, not the whole catalog. Used by the worker (ingest into Mongo) and the
 * public route (live fallback). Caching is left to the caller.
 */
export interface SatelliteGroup {
  id: string;
  label: string;
}

export const SATELLITE_GROUPS: SatelliteGroup[] = [
  { id: "active", label: "All active (~11k)" },
  { id: "visual", label: "Brightest (visual)" },
  { id: "stations", label: "Space stations" },
  // Broadband megaconstellations, by operator/network. Celestrak GROUP ids
  // verified live (all return data): starlink, oneweb, kuiper, qianfan. China's
  // other network, Guowang (GW), has no Celestrak group yet — add when published.
  { id: "starlink", label: "Starlink (SpaceX)" },
  { id: "oneweb", label: "OneWeb" },
  { id: "kuiper", label: "Amazon Kuiper" },
  { id: "qianfan", label: "Qianfan · 千帆 (China)" },
  { id: "gps-ops", label: "GPS" },
  { id: "galileo", label: "Galileo" },
  { id: "weather", label: "Weather" },
  { id: "science", label: "Science" },
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
