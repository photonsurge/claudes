/**
 * IGRF-14 geomagnetic field — total-field intensity for the whole-globe magnetic
 * map. The IAGA coefficient file gives Schmidt semi-normalised Gauss coefficients
 * per epoch; we read the 2025.0 main-field column + its secular-variation column
 * and extrapolate to the current decimal year.
 *
 * v1 synthesises the DIPOLE (degree 1) only. That's the ~90% term and is exact +
 * trivially correct: it produces the true tilted equator-to-pole intensity map
 * (~30,000 nT at the geomagnetic equator → ~60,000 nT at the poles, tilted ~11°).
 * The full degree-13 synthesis (which resolves the South Atlantic Anomaly and
 * regional detail) needs Schmidt-normalised Legendre recursions validated against
 * authoritative reference values — a deliberate follow-up, not guessed here.
 *
 * File: https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt
 */

export const IGRF_COEFFS_URL =
  process.env.IGRF_COEFFS_URL || "https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt";

export const GEOMAG_ATTRIBUTION = "Geomagnetic field: IGRF-14 (IAGA)";

/** The model epoch of the coefficients we read (last main-field column). */
export const IGRF_EPOCH = 2025.0;

/** Degree-1 Gauss coefficients (nT) + secular variation (nT/yr) at IGRF_EPOCH. */
export interface DipoleCoeffs {
  epoch: number;
  g10: number;
  g11: number;
  h11: number;
  g10sv: number;
  g11sv: number;
  h11sv: number;
}

/**
 * IGRF-14 degree-1 fallback (epoch 2025.0), so a bake still works if the coeff
 * fetch fails. These are the real published values from the IAGA file.
 */
export const IGRF14_DIPOLE_2025: DipoleCoeffs = {
  epoch: IGRF_EPOCH,
  g10: -29350.0,
  g11: -1410.3,
  h11: 4545.5,
  g10sv: 12.6,
  g11sv: 10.0,
  h11sv: -21.5,
};

const D2R = Math.PI / 180;

/**
 * Parse the degree-1 terms from an IGRF coefficient file. Each data row is
 * `g|h  n  m  <epoch values...>  <SV>`; the second-to-last number is the 2025.0
 * value and the last is the 2025–2030 secular variation. Returns the embedded
 * fallback if the degree-1 rows aren't found.
 */
export function parseIgrfDipole(txt: string): DipoleCoeffs {
  const out: DipoleCoeffs = { ...IGRF14_DIPOLE_2025 };
  let g10 = false, g11 = false, h11 = false;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || (t[0] !== "g" && t[0] !== "h")) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 5) continue;
    const kind = parts[0];
    const n = Number(parts[1]);
    const m = Number(parts[2]);
    if (n !== 1) continue;
    const nums = parts.slice(3).map(Number);
    if (nums.length < 2) continue;
    const value = nums[nums.length - 2]; // 2025.0 main-field value
    const sv = nums[nums.length - 1]; // 2025–2030 secular variation
    if (!Number.isFinite(value) || !Number.isFinite(sv)) continue;
    if (kind === "g" && m === 0) { out.g10 = value; out.g10sv = sv; g10 = true; }
    else if (kind === "g" && m === 1) { out.g11 = value; out.g11sv = sv; g11 = true; }
    else if (kind === "h" && m === 1) { out.h11 = value; out.h11sv = sv; h11 = true; }
  }
  return g10 && g11 && h11 ? out : { ...IGRF14_DIPOLE_2025 };
}

/** Extrapolate the degree-1 coefficients to a decimal year via secular variation. */
export function dipoleForYear(c: DipoleCoeffs, year: number): { g10: number; g11: number; h11: number } {
  const dt = year - c.epoch;
  return {
    g10: c.g10 + c.g10sv * dt,
    g11: c.g11 + c.g11sv * dt,
    h11: c.h11 + c.h11sv * dt,
  };
}

/**
 * Total-field intensity |B| (nT) of the geomagnetic DIPOLE at a geographic
 * lat/lon, evaluated at the reference sphere (sea level). Geodetic→geocentric
 * flattening is neglected (<0.2° shift — visually irrelevant for a global map).
 * Exact for degree 1; see the module note on higher degrees.
 */
export function dipoleTotalIntensity(
  latDeg: number,
  lonDeg: number,
  g: { g10: number; g11: number; h11: number },
): number {
  const theta = (90 - latDeg) * D2R; // colatitude
  const phi = lonDeg * D2R;
  const ct = Math.cos(theta), st = Math.sin(theta);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const eq = g.g11 * cp + g.h11 * sp; // combined m=1 term
  const Br = 2 * (g.g10 * ct + eq * st); // radial
  const Bth = g.g10 * st - eq * ct; // colatitudinal (sign irrelevant for |B|)
  const Bph = g.g11 * sp - g.h11 * cp; // azimuthal
  return Math.sqrt(Br * Br + Bth * Bth + Bph * Bph);
}

/** Fetch + parse the IGRF-14 degree-1 coefficients. Falls back to the embedded set. */
export async function fetchIgrfDipole(fetchImpl: typeof fetch = fetch): Promise<DipoleCoeffs> {
  try {
    const res = await fetchImpl(IGRF_COEFFS_URL);
    if (!res.ok) throw new Error(`igrf ${res.status}`);
    return parseIgrfDipole(await res.text());
  } catch {
    return { ...IGRF14_DIPOLE_2025 };
  }
}
