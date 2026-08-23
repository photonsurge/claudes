import {
  angularDistanceDeg,
  drawSubGlobe,
  footprintDeg,
  formatLonLat,
  projectOrtho,
  slerpLonLat,
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

  it("formats the coordinate readout with hemispheres", () => {
    expect(formatLonLat(10.04, 20.06)).toBe("20.1°N · 10.0°E");
    expect(formatLonLat(-149.94, -17.53)).toBe("17.5°S · 149.9°W");
  });
});

describe("drawSubGlobe", () => {
  it("paints a frame against a stub 2d context without throwing", () => {
    const g = {
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
    } as unknown as CanvasRenderingContext2D;
    const square: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ];
    drawSubGlobe(g, 720, { lng: 10, lat: 10, zoom: 3 }, [square], "#38bdf8");
    expect((g.clearRect as jest.Mock).mock.calls.length).toBe(1);
    // Disc + limb + reticle ring + centre dot all arc; land ring drew lines.
    expect((g.arc as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect((g.lineTo as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((g.stroke as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });
});
