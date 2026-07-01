/**
 * PURE solar-geometry helpers for the day/night globe — no GL, no DOM, fully
 * unit-testable. Given a wall-clock time these compute where the sun is overhead
 * (the subsolar point), how lit any point on the planet is, and how dark to shade
 * the night side across a soft terminator band.
 *
 * The subsolar model is the standard NOAA/Spencer approximation: accurate to a
 * fraction of a degree — far tighter than the eye can read on a broadcast globe.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Wrap a longitude into [-180, 180). */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The point [lng, lat] where the sun is directly overhead at `date` (UTC). Uses
 * Spencer's Fourier series for the solar declination + equation of time, then
 * places the subsolar longitude from apparent solar time (15°/hour west of the
 * anti-noon meridian).
 */
export function subsolarPoint(date: Date): [number, number] {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayMs = 86_400_000;
  const doy = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - yearStart) / dayMs,
  ); // 0-based day of year
  const ut = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Fractional year angle (radians).
  const g = ((2 * Math.PI) / 365) * (doy + (ut - 12) / 24);
  // Solar declination (radians) — Spencer 1971.
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  // Equation of time (minutes).
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));

  const lat = decl * RAD;
  const lng = wrapLng(-15 * (ut + eqtime / 60 - 12));
  return [lng, lat];
}

/**
 * Cosine of the sun's zenith angle at [lng, lat] — i.e. dot(surface normal, sun
 * direction). +1 = sun straight up, 0 = sun on the horizon (the terminator),
 * negative = night. This is just the cosine of the great-circle distance to the
 * subsolar point.
 */
export function cosSunZenith(lng: number, lat: number, subsolar: [number, number]): number {
  const phi = lat * DEG;
  const phiS = subsolar[1] * DEG;
  const dLng = (lng - subsolar[0]) * DEG;
  return Math.sin(phi) * Math.sin(phiS) + Math.cos(phi) * Math.cos(phiS) * Math.cos(dLng);
}

/**
 * Night darkness 0..1 from the sun-zenith cosine, with a soft twilight band so
 * the terminator reads as a gradient rather than a hard line. Day (cos ≥ ~0.10)
 * = 0; deep night (cos ≤ ~-0.18, past civil twilight) = 1; smoothstep between.
 */
export function nightAlpha(cosZenith: number): number {
  const hi = 0.1; // just after sunrise → still fully lit
  const lo = -0.18; // past civil twilight → fully dark
  const t = clamp((hi - cosZenith) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t); // smoothstep
}
