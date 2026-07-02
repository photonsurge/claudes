// weather/reproject.ts
// Reproject an Open-Meteo `.om` nest that sits on a PROJECTED native grid onto a
// regular lat/lon grid before bake. Baking such a grid flat (as if lat/lon) shears
// the map (see docs/openmeteo-grid-defs.md + memory openmeteo-projected-grids).
//
// Currently LAMBERT CONFORMAL CONIC only (dmi-europe, metno-nordic) — both verified
// against the coastline. LAEA (ukmo) + rotated-pole (meteoswiss) are not ported yet
// (ukmo is redundant with the direct `ukv` nest; meteoswiss is provisional).
//
// Convention: the native grid is row 0 = SOUTH (first grid point = min y). The
// reprojected output is row 0 = NORTH (bake/encoder convention). Out-of-grid output
// cells (the Lambert "fan" corners) are set to NaN so bakeScalar's keep-mask drops
// them → transparent, letting the base show through.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Normalise a longitude difference into [-180, 180] degrees. */
function wrapLonDeg(d: number): number {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x <= -180) x += 360;
  return x;
}

/** Spherical Lambert Conformal Conic params (tangent case ϕ1=ϕ2 supported). */
export interface LccParams {
  /** Central meridian (deg). */
  lam0: number;
  /** Latitude of origin (deg). */
  phi0: number;
  /** Standard parallel (deg); ϕ1=ϕ2 tangent. */
  phi1: number;
  /** Earth radius (m). */
  radius: number;
}

/** Precomputed LCC forward projector: (lat,lon)°→[x,y] metres. */
export function lccProjector(p: LccParams): (lat: number, lon: number) => [number, number] {
  const phi1 = p.phi1 * D2R;
  const phi0 = p.phi0 * D2R;
  const n = Math.sin(phi1);
  const F = (Math.cos(phi1) * Math.tan(Math.PI / 4 + phi1 / 2) ** n) / n;
  const rho0 = (p.radius * F) / Math.tan(Math.PI / 4 + phi0 / 2) ** n;
  return (lat: number, lon: number): [number, number] => {
    const la = lat * D2R;
    const rho = (p.radius * F) / Math.tan(Math.PI / 4 + la / 2) ** n;
    const th = n * (wrapLonDeg(lon - p.lam0) * D2R);
    return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
  };
}

/**
 * A projected native grid: nx·ny cells, origin (x0,y0) in projected units, spacing
 * dx,dy, and a forward projector mapping lat/lon → projected units. Cell (row,col)
 * sits at (x0+col·dx, y0+row·dy); row 0 = south (y0 = min).
 */
export interface NativeGrid {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  fwd: (lat: number, lon: number) => [number, number];
}

/** LCC grid given the FIRST grid point (min-lat/lon corner) + metre spacing. */
export function lccGridFromOrigin(a: {
  nx: number; ny: number; dx: number; dy: number;
  originLat: number; originLon: number; proj: LccParams;
}): NativeGrid {
  const fwd = lccProjector(a.proj);
  const [x0, y0] = fwd(a.originLat, a.originLon);
  return { nx: a.nx, ny: a.ny, x0, y0, dx: a.dx, dy: a.dy, fwd };
}

/** LCC grid given the SW + NE corner lat/lon (Open-Meteo "range" form); dx/dy derived. */
export function lccGridFromCorners(a: {
  nx: number; ny: number;
  swLat: number; swLon: number; neLat: number; neLon: number; proj: LccParams;
}): NativeGrid {
  const fwd = lccProjector(a.proj);
  const [x0, y0] = fwd(a.swLat, a.swLon);
  const [x1, y1] = fwd(a.neLat, a.neLon);
  return {
    nx: a.nx, ny: a.ny, x0, y0,
    dx: (x1 - x0) / (a.nx - 1),
    dy: (y1 - y0) / (a.ny - 1),
    fwd,
  };
}

/**
 * Output lat/lon grid dims that preserve ~the native metre spacing over `bbox`
 * ([W,S,E,N]). Anisotropic (lon cells widen with latitude) is fine — the texture
 * stretches over the bbox, res is metadata. Capped so textures stay sane.
 */
export function outDims(bbox: [number, number, number, number], dxMetres: number, cap = 3000): { width: number; height: number } {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const degLat = dxMetres / 111_320;
  const degLon = dxMetres / (111_320 * Math.max(0.2, Math.cos(midLat * D2R)));
  const width = Math.min(cap, Math.max(2, Math.round((e - w) / degLon) + 1));
  const height = Math.min(cap, Math.max(2, Math.round((n - s) / degLat) + 1));
  return { width, height };
}

/**
 * Reproject a RAW south-first native scalar grid (`src`, length nx·ny, row 0 = south)
 * onto a regular lat/lon grid over `bbox` ([W,S,E,N]), NORTH-up, nearest-neighbour.
 * Out-of-grid cells → NaN (bake drops them → transparent fan corners).
 */
export function reprojectScalar(
  src: Float32Array,
  grid: NativeGrid,
  bbox: [number, number, number, number],
  outW: number,
  outH: number,
): Float32Array {
  if (src.length !== grid.nx * grid.ny) {
    throw new Error(`reproject: src length ${src.length} != ${grid.nx}×${grid.ny}`);
  }
  const [w, s, e, n] = bbox;
  const out = new Float32Array(outW * outH);
  const lonStep = (e - w) / (outW - 1);
  const latStep = (n - s) / (outH - 1);
  for (let oy = 0; oy < outH; oy++) {
    const lat = n - oy * latStep; // row 0 = north
    for (let ox = 0; ox < outW; ox++) {
      const lon = w + ox * lonStep;
      const [x, y] = grid.fwd(lat, lon);
      const fc = (x - grid.x0) / grid.dx;
      const fr = (y - grid.y0) / grid.dy;
      if (fc >= 0 && fc <= grid.nx - 1 && fr >= 0 && fr <= grid.ny - 1) {
        const col = Math.round(fc);
        const row = Math.round(fr); // row 0 = south, matches raw src
        out[oy * outW + ox] = src[row * grid.nx + col];
      } else {
        out[oy * outW + ox] = NaN;
      }
    }
  }
  return out;
}

/** Round-trip helper for tests: inverse-check a projected point returns near lat/lon. */
export const _internal = { wrapLonDeg, D2R, R2D };
