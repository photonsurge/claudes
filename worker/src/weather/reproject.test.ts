import {
  lccProjector,
  lccGridFromOrigin,
  lccGridFromCorners,
  reprojectScalar,
  outDims,
  type NativeGrid,
} from "./reproject";

const DMI = { lam0: -8, phi0: 55.5, phi1: 55.5, radius: 6371229 } as const;

describe("lccProjector", () => {
  it("puts the central meridian on x=0 and higher lat higher on the cone", () => {
    const fwd = lccProjector(DMI);
    const [x0] = fwd(50, DMI.lam0); // on the central meridian → x≈0
    expect(Math.abs(x0)).toBeLessThan(1); // metres
    const [, yLow] = fwd(45, DMI.lam0);
    const [, yHigh] = fwd(60, DMI.lam0);
    expect(yHigh).toBeGreaterThan(yLow); // north is "up" in projected y
  });
  it("is symmetric about the central meridian", () => {
    const fwd = lccProjector(DMI);
    const [xw] = fwd(50, DMI.lam0 - 5);
    const [xe] = fwd(50, DMI.lam0 + 5);
    expect(xw).toBeCloseTo(-xe, 3);
  });
});

describe("grid builders", () => {
  it("origin form: first grid point projects to (x0,y0)", () => {
    const g = lccGridFromOrigin({ nx: 100, ny: 80, dx: 2000, dy: 2000, originLat: 39.671, originLon: -25.421997, proj: DMI });
    const [x, y] = g.fwd(39.671, -25.421997);
    expect(x).toBeCloseTo(g.x0, 3);
    expect(y).toBeCloseTo(g.y0, 3);
    expect(g.dx).toBe(2000);
  });
  it("corner form: derives dx/dy so the NE corner lands on the last cell", () => {
    const g = lccGridFromCorners({ nx: 1796, ny: 2321, swLat: 52.30272, swLon: 1.9184653, neLat: 72.18527, neLon: 41.764282,
      proj: { lam0: 15, phi0: 63, phi1: 63, radius: 6371229 } });
    const [x1, y1] = g.fwd(72.18527, 41.764282);
    expect(x1).toBeCloseTo(g.x0 + (g.nx - 1) * g.dx, 2);
    expect(y1).toBeCloseTo(g.y0 + (g.ny - 1) * g.dy, 2);
    expect(g.dx).toBeGreaterThan(500); // sane metre spacing (~1–3 km)
    expect(g.dx).toBeLessThan(5000);
  });
});

describe("outDims", () => {
  it("preserves ~native spacing and stays under the cap", () => {
    const { width, height } = outDims([-25.42, 39.67, 40.07, 62.67], 2000);
    expect(width).toBeGreaterThan(1500);
    expect(width).toBeLessThanOrEqual(3000);
    expect(height).toBeGreaterThan(1000);
  });
});

describe("reprojectScalar", () => {
  // A native grid whose value == the source ROW index, so we can check orientation.
  function rowIndexGrid(g: NativeGrid): Float32Array {
    const s = new Float32Array(g.nx * g.ny);
    for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) s[r * g.nx + c] = r;
    return s;
  }

  // Real dmi dims so the fan actually covers the bbox core (corners stay empty).
  const grid = lccGridFromOrigin({ nx: 1906, ny: 1606, dx: 2000, dy: 2000, originLat: 39.671, originLon: -25.421997, proj: DMI });
  const bbox: [number, number, number, number] = [-25.421997, 39.670998, 40.069855, 62.667618];

  it("masks out-of-grid (fan corner) cells as NaN and keeps the covered core finite", () => {
    const src = new Float32Array(grid.nx * grid.ny).fill(7);
    const out = reprojectScalar(src, grid, bbox, 120, 100);
    // The rectangular bbox is larger than the Lambert fan → some cells fall outside.
    const nan = out.reduce((a, v) => a + (Number.isNaN(v) ? 1 : 0), 0);
    expect(nan).toBeGreaterThan(0);
    expect(nan).toBeLessThan(out.length); // but not everything
    const centre = out[Math.floor(100 / 2) * 120 + Math.floor(120 / 2)];
    expect(centre).toBe(7); // covered core → source value preserved
  });

  it("is NORTH-up: a covered northern output row samples a HIGHER native row than a southern one", () => {
    const src = rowIndexGrid(grid);
    const out = reprojectScalar(src, grid, bbox, 60, 60);
    // find a column that's finite top and bottom
    for (let x = 0; x < 60; x++) {
      const top = out[0 * 60 + x];
      const bot = out[59 * 60 + x];
      if (Number.isFinite(top) && Number.isFinite(bot)) {
        expect(top).toBeGreaterThan(bot); // north row → larger native row index (row 0 = south)
        return;
      }
    }
    throw new Error("no fully-covered column found");
  });

  it("throws when src length != native nx·ny", () => {
    expect(() => reprojectScalar(new Float32Array(10), grid, bbox, 10, 10)).toThrow(/length/);
  });
});
