// satimg/disk.ts
// Geostationary Earth-disk geometry, used by the check:satimg eyeball tool to draw a
// GEOMETRICALLY-CORRECT synthetic full-disk footprint before the real satpy bake
// exists. A geostationary satellite sees the cap of the globe within the horizon
// angle of its sub-satellite point; a surface point (lat, lon) is visible iff the
// great-circle angle from the sub-point is below that horizon. This is exactly the
// footprint the real reprojection fills, so the synthetic frame lands the disk over
// the same region (Asia/Australia/W-Pacific for Himawari-9 at 140.7°E).

const DEG = Math.PI / 180;

/** Equatorial Earth radius (km) and geostationary orbital radius from Earth centre (km). */
export const R_EARTH_KM = 6378.137;
export const R_GEO_KM = 42164;

/**
 * cos(horizon angle) for a geostationary satellite = R_earth / R_geo ≈ 0.1513
 * (horizon ≈ 81.3° of geocentric angle). A point is visible when the cosine of its
 * geocentric angle from the sub-satellite point EXCEEDS this.
 */
export const GEO_HORIZON_COS = R_EARTH_KM / R_GEO_KM;

/** Cosine of the geocentric angle between (lat, lon) and the sub-satellite point (0, subLon). */
export function subPointCos(lat: number, lon: number, subLon: number): number {
  // cos c = sin0·sinφ + cos0·cosφ·cos(Δλ) = cosφ·cos(Δλ). cos is periodic so the
  // longitude difference needs no explicit wrap.
  return Math.cos(lat * DEG) * Math.cos((lon - subLon) * DEG);
}

/** Whether (lat, lon) is within a geostationary satellite's Earth disk. */
export function isVisibleFromGeo(lat: number, lon: number, subLon: number): boolean {
  return subPointCos(lat, lon, subLon) > GEO_HORIZON_COS;
}

/**
 * 0..1 "how head-on" the view is: 1 at the sub-satellite point, → 0 at the limb.
 * Maps subPointCos from [horizon, 1] onto [0, 1]. Returns 0 outside the disk.
 */
export function viewFactor(lat: number, lon: number, subLon: number): number {
  const c = subPointCos(lat, lon, subLon);
  if (c <= GEO_HORIZON_COS) return 0;
  return (c - GEO_HORIZON_COS) / (1 - GEO_HORIZON_COS);
}

/**
 * A synthetic full-disk as a plate-carrée RGBA buffer on GLOBAL bounds
 * [-180,-90,180,90] — brightening toward the sub-satellite point, transparent
 * outside the disk, with faint 15° graticule ticks inside so the limb curvature and
 * centring read clearly. NOT real imagery — a georeferenced stand-in so the overlay
 * + coastline compositing can be eyeballed before the real bake.
 */
export function syntheticDiskRgba(width: number, height: number, subLon: number): Buffer {
  const out = Buffer.alloc(width * height * 4); // zero-filled → transparent by default
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      const lon = -180 + ((x + 0.5) / width) * 360;
      const f = viewFactor(lat, lon, subLon);
      if (f <= 0) continue;
      const o = (y * width + x) * 4;
      // Cool→bright ramp; a faint graticule every 15° for orientation.
      const onGrid =
        Math.abs(((lon % 15) + 15) % 15) < 0.25 || Math.abs(((lat % 15) + 15) % 15) < 0.25;
      const base = 40 + Math.round(f * 180);
      out[o] = onGrid ? 90 : Math.round(base * 0.5); // R
      out[o + 1] = onGrid ? 160 : Math.round(base * 0.75); // G
      out[o + 2] = onGrid ? 220 : base; // B (bluish, satellite-ish)
      out[o + 3] = 255; // opaque inside the disk
    }
  }
  return out;
}
