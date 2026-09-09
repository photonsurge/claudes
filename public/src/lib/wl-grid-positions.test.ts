import icomesh from "icomesh";
import { distance as geoDistanceKm } from "geokdbush";
import {
  globeGridPositions,
  icosphereIndex,
  icosphereOrder,
  icospherePoints,
  viewportGlobeRadiusM,
  WL_EARTH_RADIUS_M,
  type GlobeViewportLike,
} from "./wl-grid-positions";

/** A flat stand-in for a globe viewport: 1 px = `degPerPx` degrees from the centre. */
function fakeGlobe(over: Partial<GlobeViewportLike> & { degPerPx?: number } = {}): GlobeViewportLike {
  const { degPerPx = 0.025, ...rest } = over;
  const v: GlobeViewportLike = {
    resolution: 2,
    scale: 2 ** 3,
    longitude: 10.3,
    latitude: 50.7,
    width: 800,
    height: 600,
    unproject: ([x, y]) => [v.longitude + (x - v.width / 2) * degPerPx, v.latitude - (y - v.height / 2) * degPerPx],
    ...rest,
  };
  return v;
}

describe("WeatherLayers grid positions", () => {
  it("picks the icosphere order from zoom + t, clamped to 0..7", () => {
    expect(icosphereOrder(0, 3)).toBe(2);
    expect(icosphereOrder(2.9, 3)).toBe(4);
    expect(icosphereOrder(5, 3)).toBe(7);
    expect(icosphereOrder(9, 3)).toBe(7);
    expect(icosphereOrder(-4, 3)).toBe(0);
  });

  it("builds each order's points once, poles last, seams and pole rows dropped", () => {
    const one = icospherePoints(1);
    expect(icospherePoints(1)).toBe(one);
    expect(one.slice(-2)).toEqual([
      [0, -90],
      [0, 90],
    ]);
    // Exactly WeatherLayers' loop over icomesh's uv map: skip the u = 0 seam and
    // the pole rows, keep the seam duplicates (u just outside 0..1 — deck wraps
    // their longitude) it keeps.
    const { uv } = icomesh(1, true);
    const expected: [number, number][] = [];
    for (let i = 0; i < uv!.length; i += 2) {
      const u = uv![i];
      const v = uv![i + 1];
      if (u === 0 || v <= 0 || v >= 1) continue;
      expected.push([360 * u - 180, 180 * v - 90]);
    }
    expect(one.slice(0, -2)).toEqual(expected);
    for (const [, lat] of one.slice(0, -2)) {
      expect(lat).toBeGreaterThan(-90);
      expect(lat).toBeLessThan(90);
    }
    expect(icospherePoints(2).length).toBeGreaterThan(one.length * 3);
    expect(icosphereIndex(2)).toBe(icosphereIndex(2));
  });

  it("measures the viewport radius as the farthest sampled edge pixel", () => {
    const v = fakeGlobe();
    const r = viewportGlobeRadiusM(v);
    // The widest sample on a landscape view is the point a full height left of centre.
    const expected = Math.max(
      ...[
        [400, 0],
        [0, 300],
        [400 - 150, 300],
        [400 - 300, 300],
        [400 - 450, 300],
        [400 - 600, 300],
      ].map((px) => {
        const [lng, lat] = v.unproject(px);
        return geoDistanceKm(v.longitude, v.latitude, lng, lat) * 1e3 * (WL_EARTH_RADIUS_M / 6371e3);
      }),
    );
    expect(r).toBeCloseTo(expected, -2);
    // Portrait views sample down the height instead.
    expect(viewportGlobeRadiusM(fakeGlobe({ width: 600, height: 800 }))).toBeGreaterThan(0);
  });

  it("returns exactly the icosphere points within the radius, nearest first", () => {
    const v = fakeGlobe();
    const t = 3;
    const got = globeGridPositions(v, t);
    const order = icosphereOrder(Math.log2(v.scale), t);
    const radiusKm = viewportGlobeRadiusM(v) / 1e3;
    const all = icospherePoints(order);
    const expected = all.filter((p) => geoDistanceKm(v.longitude, v.latitude, p[0], p[1]) <= radiusKm);
    expect(got.length).toBeGreaterThan(10);
    expect(new Set(got)).toEqual(new Set(expected));
    for (let i = 1; i < got.length; i++) {
      const a = geoDistanceKm(v.longitude, v.latitude, got[i - 1][0], got[i - 1][1]);
      const b = geoDistanceKm(v.longitude, v.latitude, got[i][0], got[i][1]);
      expect(b).toBeGreaterThanOrEqual(a);
    }
    // Same tick, same arrays: the memoised points are handed out by identity.
    for (const p of globeGridPositions(v, t)) expect(all.includes(p)).toBe(true);
  });

  it("covers the whole sphere when the view reaches the antipode", () => {
    const v = fakeGlobe({ unproject: () => [10.3 + 180, -50.7] });
    expect(globeGridPositions(v, 3).length).toBe(icospherePoints(icosphereOrder(3, 3)).length);
  });
});
