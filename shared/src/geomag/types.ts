/**
 * Geomagnetic-field (IGRF) overlay domain types, shared by the worker (bake) and
 * the public app (overlay). This is the whole-globe magnetic FIELD — total-field
 * intensity from equator to poles — NOT the polar aurora (which is the space-weather
 * ACTIVITY). The worker computes the field on a grid, bakes a scalar texture, and
 * the client renders it via the same RasterLayer path as the weather rasters.
 */

/** [west, south, east, north] in degrees — the baked field's geographic extent. */
export type GeomagBounds = [number, number, number, number];

/**
 * Render params shared by the worker bake and the client RasterLayer. The frame is
 * a SCALAR total-intensity texture (nanoTesla): the worker packs |B| via
 * `GEOMAG_IMAGE_UNSCALE`; the client colours it over `GEOMAG_DOMAIN` with the
 * `geomag` palette (blue at the weak geomagnetic equator → red at the strong poles).
 */
export const GEOMAG_IMAGE_UNSCALE: [number, number] = [15000, 70000]; // byte ↔ nT decode
export const GEOMAG_DOMAIN: [number, number] = [23000, 65000]; // palette spread (nT)

/** Metadata for one baked geomagnetic-field frame (no pixel bytes). */
export interface GeomagMeta {
  /** IGRF model epoch used (e.g. 2025.0). */
  epoch: number;
  /** Decimal year the field was extrapolated to (e.g. 2026.5). */
  year: number;
  /** Max spherical-harmonic degree synthesised (1 = dipole). */
  nmax: number;
  bounds: GeomagBounds;
  width: number;
  height: number;
  /** Min / max total intensity across the grid (nT), for reference. */
  minF: number;
  maxF: number;
  /** When the worker last baked this frame (ISO) — busts the image URL cache. */
  updatedAt: string;
}
