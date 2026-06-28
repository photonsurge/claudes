/**
 * Celestrak GP (General Perturbations) TLE feeds — free, no key. We poll a named
 * group, not the whole catalog. Server-side fetch is cached so we stay polite
 * (Celestrak asks for ≥1–2h between pulls per group).
 */
export interface SatelliteGroup {
  id: string;
  label: string;
}

export const SATELLITE_GROUPS: SatelliteGroup[] = [
  { id: "visual", label: "Brightest (visual)" },
  { id: "stations", label: "Space stations" },
  { id: "starlink", label: "Starlink" },
  { id: "gps-ops", label: "GPS" },
  { id: "galileo", label: "Galileo" },
  { id: "weather", label: "Weather" },
  { id: "science", label: "Science" },
];

export const DEFAULT_SATELLITE_GROUP = "visual";

export const isValidGroup = (group: string): boolean =>
  SATELLITE_GROUPS.some((g) => g.id === group);

/** Fetch raw TLE text for a group. Cached 1h via Next's fetch revalidation. */
export async function fetchGroupTle(group: string): Promise<string> {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(
    group,
  )}&FORMAT=tle`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LiveWeatherGlobe/0.1 (satellite overlay; personal use)" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`celestrak fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}
