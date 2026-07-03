/**
 * NOAA SWPC "OVATION Prime" aurora forecast — the operational model of where the
 * auroral oval is right now, published every few minutes as a global 1° grid of
 * aurora probabilities. This is the live "magnetic activity map": the oval swells
 * and brightens as geomagnetic activity (the Kp index) rises.
 *
 * Source JSON shape (only the fields we read):
 *   {
 *     "Observation Time": "2026-07-03T01:32:00Z",
 *     "Forecast Time":    "2026-07-03T02:41:00Z",
 *     "Data Format":      "[Longitude, Latitude, Aurora]",
 *     "coordinates": [ [lng, lat, prob], … ]   // lng 0..359, lat -90..90, prob 0..100
 *   }
 *
 * The worker fetches this into Mongo (as a baked PNG); the public app reads only
 * the cache. Longitude is 0..360 here, so a bake step rolls it to -180..180.
 * Override OVATION_AURORA_URL if the source path ever moves.
 */

export const OVATION_AURORA_URL =
  process.env.OVATION_AURORA_URL ||
  "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

export const AURORA_ATTRIBUTION = "Aurora: NOAA SWPC OVATION Prime";

/** The OVATION grid is a fixed 1°×1° lattice: lng 0..359, lat -90..90. */
export const AURORA_GRID_W = 360;
export const AURORA_GRID_H = 181; // -90..90 inclusive

/**
 * A parsed OVATION frame. `values` is row-major, length `width*height`, with
 * row 0 = NORTH (lat +90) and column 0 = 0°E (the source's native origin — a
 * later bake step rolls it to -180). Each value is an aurora probability (0–100).
 */
export interface OvationGrid {
  observationTime: string;
  forecastTime: string;
  width: number;
  height: number;
  values: Float32Array;
  /** Peak probability across the grid (%, 0–100). */
  maxProb: number;
}

interface OvationJson {
  ["Observation Time"]?: string;
  ["Forecast Time"]?: string;
  coordinates?: unknown;
}

/** True for a finite [lng, lat, prob] triple. */
function isTriple(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 3 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    typeof v[2] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

/**
 * Parse the OVATION JSON into a dense row-major probability grid. Points outside
 * the fixed 1° lattice are skipped rather than throwing, so an unexpected source
 * resolution degrades gracefully instead of crashing the bake. Missing cells stay
 * 0 (no aurora), which is the correct default for a sparse feed.
 */
export function parseOvation(json: unknown): OvationGrid {
  const src = (json ?? {}) as OvationJson;
  const coords = Array.isArray(src.coordinates) ? src.coordinates : [];
  const width = AURORA_GRID_W;
  const height = AURORA_GRID_H;
  const values = new Float32Array(width * height);
  let maxProb = 0;

  for (const c of coords) {
    if (!isTriple(c)) continue;
    const [lng, lat, prob] = c;
    // Source lng is 0..359, lat -90..90. Clamp to the lattice; skip anything off it.
    const col = Math.round(lng);
    const row = Math.round(90 - lat); // row 0 = north (lat +90)
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    const p = prob < 0 ? 0 : prob;
    values[row * width + col] = p;
    if (p > maxProb) maxProb = p;
  }

  return {
    observationTime: String(src["Observation Time"] ?? new Date(0).toISOString()),
    forecastTime: String(src["Forecast Time"] ?? new Date(0).toISOString()),
    width,
    height,
    values,
    maxProb,
  };
}

/** Fetch + parse the OVATION feed. Throws on network/HTTP error so the job can log it. */
export async function fetchOvation(
  fetchImpl: typeof fetch = fetch,
): Promise<OvationGrid> {
  const res = await fetchImpl(OVATION_AURORA_URL);
  if (!res.ok) throw new Error(`ovation-aurora ${res.status}`);
  const json = await res.json();
  return parseOvation(json);
}
