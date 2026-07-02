import { regionalGridFromGeometry } from "./rtofsRegional";

/** A probed geometry stub — only the fields regionalGridFromGeometry reads. */
function geom(over: Partial<Parameters<typeof regionalGridFromGeometry>[0]>) {
  return {
    nx: 100,
    ny: 50,
    lat0: 0,
    lat1: 10,
    lon0: 0,
    lon1: 10,
    dLon: 0.08,
    ...over,
  };
}

describe("regionalGridFromGeometry", () => {
  it("carries the real nx/ny and grid spacing through unchanged", () => {
    const g = regionalGridFromGeometry(geom({ nx: 575, ny: 435, dLon: 0.08 }));
    expect(g.width).toBe(575);
    expect(g.height).toBe(435);
    expect(g.resDeg).toBe(0.08);
  });

  it("orders lat as [S,N] regardless of scan direction (S→N or N→S)", () => {
    const ascending = regionalGridFromGeometry(geom({ lat0: -30, lat1: 0 }));
    expect(ascending.bounds[1]).toBe(-30); // S
    expect(ascending.bounds[3]).toBe(0); // N
    const descending = regionalGridFromGeometry(geom({ lat0: 44.8, lat1: 10 }));
    expect(descending.bounds[1]).toBe(10);
    expect(descending.bounds[3]).toBe(44.8);
  });

  it("wraps a 0..360 window into −180..180 (west_atl: 260..306 → −100..−54)", () => {
    const g = regionalGridFromGeometry(geom({ lon0: 260, lon1: 306, lat0: 10, lat1: 44.8 }));
    expect(g.bounds).toEqual([-100, 10, -54, 44.8]);
  });

  it("keeps W<E monotonic across the antimeridian (samoa: 170..214.8 → E>180)", () => {
    const g = regionalGridFromGeometry(geom({ lon0: 170, lon1: 214.8, lat0: -30, lat1: 0 }));
    // West stays 170, East extends past 180 by the ascending span (periodic globe).
    expect(g.bounds[0]).toBe(170);
    expect(g.bounds[2]).toBeCloseTo(214.8, 6);
    expect(g.bounds[0]).toBeLessThan(g.bounds[2]);
  });

  it("handles a window whose west edge sits exactly on 180 (honolulu: 180..230)", () => {
    const g = regionalGridFromGeometry(geom({ lon0: 180, lon1: 230, lat0: 0, lat1: 40 }));
    // wrapLon(180) → −180; east = −180 + 50 = −130 (a clean −180..−130 window).
    expect(g.bounds[0]).toBe(-180);
    expect(g.bounds[2]).toBeCloseTo(-130, 6);
  });
});
