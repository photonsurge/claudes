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
}

/** What the overlay hook receives: frame metadata plus a cache-bust key. */
export interface AuroraMeta extends AuroraFrame {
  /** When the worker last baked this frame (ISO) — busts the image URL cache. */
  updatedAt: string;
}
