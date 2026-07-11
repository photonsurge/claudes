/**
 * Keep a framed-area ORBIT shot (country kind) on its subject.
 *
 * Those shots don't spin the whole globe — they slowly pan the camera centre in a
 * circle around the framed centre so a wide area shot drifts alive (see the orbit
 * loop in Globe.tsx). The pan radius (`orbitDrift`, in degrees) was a fixed 5–6°
 * regardless of how tightly the subject is framed, so at a country's zoom the pan
 * dragged the whole country off toward a screen edge.
 *
 * `orbitAmpCap` bounds that pan to a fraction of the on-screen half-height at the
 * given zoom, so the framed subject can never leave frame. It's a function of zoom
 * ALONE (no canvas measurement) so /control and /watch compute the same amplitude
 * and stay phase-locked, exactly like the rest of the deterministic camera motion.
 */

/**
 * On-screen half-height, in latitude-equivalent degrees, of the 1080p broadcast
 * frame at GlobeView `zoom` ≈ ORBIT_VIS_HALF_K / 2^zoom. Calibrated off the
 * country spotlight framing (Spain frames at zoom 4.5 with a visible half-height
 * of ~6.6°, and 6.6 · 2^4.5 ≈ 150). GlobeView is a perspective sphere, so this is
 * a local-scale approximation near the centre — good enough to bound the pan.
 */
export const ORBIT_VIS_HALF_K = 150;

/**
 * The orbit pan never exceeds this fraction of that half-height. 0.22 keeps even
 * a subject that fills ~78% of the vertical fully in frame through the whole orbit
 * (subjectHalf + pan ≤ visibleHalf), while still reading as gentle live motion.
 */
export const ORBIT_MAX_FRAC = 0.22;

/**
 * Max orbit pan radius (degrees) that still keeps the framed subject on screen at
 * `zoom`. The caller uses `min(orbitDrift, orbitAmpCap(zoom))` so the preset's
 * requested drift only ever gets tightened, never amplified. Pass the LIVE zoom
 * (including any push-in) so the cap tightens as the shot zooms in.
 */
export function orbitAmpCap(zoom: number): number {
  return ORBIT_MAX_FRAC * (ORBIT_VIS_HALF_K / Math.pow(2, zoom));
}
