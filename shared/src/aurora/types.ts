/**
 * Aurora (geomagnetic activity) overlay domain types, shared by the worker
 * (ingest / bake) and the public app (overlay). The worker pulls NOAA SWPC's
 * OVATION Prime auroral-probability grid on a fast cron, bakes it into a
 * pre-coloured translucent glow PNG, and stores that single frame in Mongo; the
 * public app only ever reads the cached frame (same rule as faults / cables).
 *
 * Unlike the static plate boundaries, this frame rolls over every few minutes as
 * geomagnetic activity changes — the overlay is a live "magnetic activity map".
 */

/** [west, south, east, north] in degrees — the baked PNG's geographic extent. */
export type AuroraBounds = [number, number, number, number];

/**
 * Render params shared by the worker bake and the client RasterLayer. The frame
 * is a SCALAR probability texture (like radar/SST): the worker packs probability
 * into the PNG and masks everything at/below `AURORA_FLOOR` to transparent; the
 * client decodes with `AURORA_IMAGE_UNSCALE` and colours it over `AURORA_DOMAIN`
 * with the `aurora` palette. Rendering as a WeatherLayers RasterLayer (finely
 * tessellated) — NOT a coarse full-globe BitmapLayer, which chords the sphere and
 * leaks the oval as diamond artifacts near the limb.
 */
export const AURORA_FLOOR = 3; // aurora probability (%) below which pixels are transparent
export const AURORA_IMAGE_UNSCALE: [number, number] = [0, 100]; // byte ↔ probability decode
export const AURORA_DOMAIN: [number, number] = [AURORA_FLOOR, 50]; // palette spread

/** Metadata for one baked aurora frame (no pixel bytes). */
export interface AuroraFrame {
  /** SWPC observation time (ISO) the OVATION grid was derived from. */
  observationTime: string;
  /** SWPC forecast/valid time (ISO) the grid applies to. */
  forecastTime: string;
  /** Geographic extent of the baked PNG (always the whole globe). */
  bounds: AuroraBounds;
  /** Baked source grid width (columns) before any resample. */
  width: number;
  /** Baked source grid height (rows) before any resample. */
  height: number;
  /** Peak aurora probability across the grid (%, 0–100). Drives the HUD readout. */
  maxProb: number;
  /** Latest planetary Kp index (0–9) — the geomagnetic activity level, or null. */
  kp: number | null;
  /** ISO time of the latest Kp reading, or null when unavailable. */
  kpTime: string | null;
}

/** What the overlay hook receives: frame metadata plus a cache-bust key. */
export interface AuroraMeta extends AuroraFrame {
  /** When the worker last baked this frame (ISO) — busts the image URL cache. */
  updatedAt: string;
}
