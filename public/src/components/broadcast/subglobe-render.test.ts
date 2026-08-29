import {
  angularDistanceDeg,
  drawSubGlobe,
  footprintDeg,
  formatLonLat,
  projectOrtho,
  slerpLonLat,
  spherePointAt,
  spinLongitude,
  wrapLng,
} from "./subglobe-render";

describe("subglobe math", () => {
  it("wraps longitudes to −180..180", () => {
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(360)).toBe(0);
  });

  it("reproduces Globe.tsx's deterministic spin longitude", () => {
    // 8°/s for 10s past the epoch → +80° from the anchor.
    expect(spinLongitude(10, 8, 1_000, 11_000)).toBeCloseTo(90, 6);
    // Unknown epoch (0) → phase unknowable, stay on the anchor.
    expect(spinLongitude(10, 8, 0, 11_000)).toBe(10);
    expect(spinLongitude(10, 0, 1_000, 11_000)).toBe(10);
  });

  it("footprint ring tightens with zoom and clamps at both ends", () => {
    expect(footprintDeg(0)).toBe(60); // clamped wide
    expect(footprintDeg(2.5)).toBeCloseTo(180 / 2 ** 2.5, 6);
    expect(footprintDeg(5)).toBeCloseTo(5.625, 4);
    expect(footprintDeg(12)).toBe(3); // clamped tight (180/2^12 ≪ 3)
  });

  it("projects orthographically: centre → origin, 90° east → limb, far side flagged", () => {
    const centre = projectOrtho([10, 20], [10, 20], 100);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeCloseTo(0, 6);
    expect(centre.cosc).toBeCloseTo(1, 6);

    const limb = projectOrtho([100, 0], [10, 0], 100);
    expect(limb.x).toBeCloseTo(100, 6);
    expect(limb.y).toBeCloseTo(0, 6);
    expect(limb.cosc).toBeCloseTo(0, 6);

    const far = projectOrtho([-170, 0], [10, 0], 100);
    expect(far.cosc).toBeCloseTo(-1, 6);

    // North pole from an equatorial centre sits at the top of the disc.
    const pole = projectOrtho([0, 90], [0, 0], 100);
    expect(pole.x).toBeCloseTo(0, 6);
    expect(pole.y).toBeCloseTo(100, 6);
  });

  it("slerps along the great circle and measures angular distance", () => {
    expect(angularDistanceDeg([0, 0], [90, 0])).toBeCloseTo(90, 6);
    const mid = slerpLonLat([0, 0], [90, 0], 0.5);
    expect(mid[0]).toBeCloseTo(45, 6);
    expect(mid[1]).toBeCloseTo(0, 6);
    // t=1 lands exactly on the target; identical points return the target.
    expect(slerpLonLat([0, 0], [90, 0], 1)[0]).toBeCloseTo(90, 6);
    expect(slerpLonLat([12, 34], [12, 34], 0.3)).toEqual([12, 34]);
  });

  it("walks great-circle destinations for the ground-circle reticle", () => {
    const north = spherePointAt([0, 0], 90, 0);
    expect(north[1]).toBeCloseTo(90, 6); // 90° due north of the equator = the pole
    const east = spherePointAt([0, 0], 90, 90);
    expect(east[0]).toBeCloseTo(90, 6);
    expect(east[1]).toBeCloseTo(0, 6);
    const small = spherePointAt([10, 20], 5, 180);
    expect(small[0]).toBeCloseTo(10, 6); // due south keeps the meridian
    expect(small[1]).toBeCloseTo(15, 6);
  });

  it("formats the coordinate readout with hemispheres", () => {
    expect(formatLonLat(10.04, 20.06)).toBe("20.1°N · 10.0°E");
    expect(formatLonLat(-149.94, -17.53)).toBe("17.5°S · 149.9°W");
  });
});

describe("drawSubGlobe", () => {
  const stubCtx = () =>
    ({
      clearRect: jest.fn(),
      createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      save: jest.fn(),
      clip: jest.fn(),
      restore: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      stroke: jest.fn(),
    }) as unknown as CanvasRenderingContext2D;
  const square = (lng0: number, lng1: number, lat0: number, lat1: number): [number, number][] => [
    [lng0, lat0],
    [lng1, lat0],
    [lng1, lat1],
    [lng0, lat1],
    [lng0, lat0],
  ];
  const calls = (g: CanvasRenderingContext2D, m: keyof CanvasRenderingContext2D) =>
    (g[m] as unknown as jest.Mock).mock.calls.length;

  it("paints a frame against a stub 2d context without throwing", () => {
    const g = stubCtx();
    drawSubGlobe(g, 720, { lng: 10, lat: 10, zoom: 3 }, [square(0, 20, 0, 20)], "#38bdf8");
    expect(calls(g, "clearRect")).toBe(1);
    // Disc + limb + reticle ring + centre dot all arc; land ring drew lines.
    expect(calls(g, "arc")).toBeGreaterThanOrEqual(4);
    expect(calls(g, "lineTo")).toBeGreaterThan(0);
    expect(calls(g, "stroke")).toBeGreaterThan(0);
  });

  it("uses the supplied scene-theme ocean palette", () => {
    const g = stubCtx();
    drawSubGlobe(g, 720, { lng: 0, lat: 0, zoom: 3 }, [], "#abcdef", 0, 0, {
      oceanInner: "#111111",
      oceanOuter: "#222222",
      land: "#333333",
      landEdge: "#444444",
      grid: "#555555",
      limb: "#666666",
    });

    const gradient = (g.createRadialGradient as jest.Mock).mock.results[0].value;
    expect(gradient.addColorStop).toHaveBeenNthCalledWith(1, 0, "#111111");
    expect(gradient.addColorStop).toHaveBeenNthCalledWith(2, 1, "#222222");
  });

  it("horizon-clips rings: far-side land draws nothing, straddling land rides the limb", () => {
    // A ring fully behind the planet contributes NO path at all — the old
    // clamp-to-limb shortcut swept it across the disc as a giant false wedge.
    const farSide = stubCtx();
    drawSubGlobe(farSide, 720, { lng: 0, lat: 0, zoom: 3 }, [square(160, 200, -20, 20)], "#fff");
    const empty = stubCtx();
    drawSubGlobe(empty, 720, { lng: 0, lat: 0, zoom: 3 }, [], "#fff");
    expect(calls(farSide, "lineTo")).toBe(calls(empty, "lineTo"));
    expect(calls(farSide, "moveTo")).toBe(calls(empty, "moveTo"));

    // A ring crossing the horizon (edge at ~lng 90) bridges its hidden
    // stretch with an extra limb arc beyond the 4 chrome arcs.
    const straddle = stubCtx();
    drawSubGlobe(straddle, 720, { lng: 0, lat: 0, zoom: 3 }, [square(60, 120, -20, 20)], "#fff");
    expect(calls(straddle, "arc")).toBeGreaterThanOrEqual(5);
  });
});
