import {
  boxBlur,
  decodeScalar,
  downsample,
  findHighLows,
  findHighLowsAt,
  haversineM,
  workGridFactor,
  type LngLatBounds,
  type ScalarImage,
} from "./high-low";

const W = 360;
const H = 181;
const BOUNDS: LngLatBounds = [-180, -90, 180, 90];
const UNSCALE: [number, number] = [950, 1050];
const RADIUS = 2_000_000;

type Bump = { lng: number; lat: number; amp: number; sigma: number; clipAt?: number };

/** A 1° global RGBA "pressure" texture: 1013 hPa plus Gaussian bumps, byte-encoded like the bake. */
function field(bumps: Bump[], nodata?: (lng: number, lat: number) => boolean): ScalarImage {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) / W) * 360;
      let v = 1013;
      for (const b of bumps) {
        let dLng = Math.abs(lng - b.lng);
        if (dLng > 180) dLng = 360 - dLng;
        const d2 = dLng * dLng + (lat - b.lat) ** 2;
        let contrib = b.amp * Math.exp(-d2 / (2 * b.sigma * b.sigma));
        if (b.clipAt !== undefined) contrib = b.amp > 0 ? Math.min(contrib, b.clipAt) : Math.max(contrib, -b.clipAt);
        v += contrib;
      }
      const o = (y * W + x) * 4;
      data[o] = Math.round(((v - UNSCALE[0]) / (UNSCALE[1] - UNSCALE[0])) * 255);
      data[o + 3] = nodata?.(lng, lat) ? 0 : 255;
    }
  }
  return { data, width: W, height: H };
}

/** Same field on an arbitrary grid/bounds (a regional fine bake). */
function fieldOn(w: number, h: number, [west, south, east, north]: LngLatBounds, bumps: Bump[]): ScalarImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const lat = north - ((y + 0.5) / h) * (north - south);
    for (let x = 0; x < w; x++) {
      const lng = west + ((x + 0.5) / w) * (east - west);
      let v = 1013;
      for (const b of bumps) {
        const d2 = (lng - b.lng) ** 2 + (lat - b.lat) ** 2;
        v += b.amp * Math.exp(-d2 / (2 * b.sigma * b.sigma));
      }
      const o = (y * w + x) * 4;
      data[o] = Math.round(((v - UNSCALE[0]) / (UNSCALE[1] - UNSCALE[0])) * 255);
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const near = (p: [number, number], lng: number, lat: number, tolDeg = 2) => {
  let dLng = Math.abs(p[0] - lng);
  if (dLng > 180) dLng = 360 - dLng;
  return dLng <= tolDeg && Math.abs(p[1] - lat) <= tolDeg;
};

describe("decodeScalar / boxBlur", () => {
  it("unscales bytes to the physical range and marks alpha-0 texels NaN", () => {
    const v = decodeScalar({ data: new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255, 128, 0, 0, 0]), width: 3, height: 1 }, [950, 1050]);
    expect(v[0]).toBeCloseTo(950);
    expect(v[1]).toBeCloseTo(1050);
    expect(Number.isNaN(v[2])).toBe(true);
  });

  it("blurs across the seam of a wrapping grid and ignores NaN", () => {
    const v = new Float32Array([10, 0, 0, 0, 0, NaN]);
    const b = boxBlur(v, 6, 1, 1, true);
    // x=0 averages x=5 (NaN, skipped), x=0, x=1 → (10 + 0) / 2.
    expect(b[0]).toBeCloseTo(5);
    // x=5 averages x=4, x=5 (NaN), x=0 → (0 + 10) / 2.
    expect(b[5]).toBeCloseTo(5);
  });

  it("haversine: a degree of latitude is ~111 km", () => {
    expect(haversineM([0, 0], [0, 1])).toBeCloseTo(111_195, -2);
  });
});

describe("findHighLows", () => {
  it("finds one high and one low at their centres with the decoded value", () => {
    const img = field([
      { lng: 0, lat: 30, amp: 20, sigma: 8 },
      { lng: 120, lat: -20, amp: -25, sigma: 8 },
    ]);
    const pts = findHighLows(img, BOUNDS, UNSCALE, RADIUS);
    const highs = pts.filter((p) => p.type === "H");
    const lows = pts.filter((p) => p.type === "L");
    expect(highs).toHaveLength(1);
    expect(lows).toHaveLength(1);
    expect(near(highs[0].position, 0, 30)).toBe(true);
    expect(highs[0].value).toBeCloseTo(1033, 0);
    expect(near(lows[0].position, 120, -20)).toBe(true);
    expect(lows[0].value).toBeCloseTo(988, 0);
  });

  it("keeps the stronger of two highs closer than the radius", () => {
    const img = field([
      { lng: 0, lat: 30, amp: 20, sigma: 3 },
      { lng: 8, lat: 30, amp: 12, sigma: 3 }, // ~770 km away: two distinct peaks
    ]);
    const highs = findHighLows(img, BOUNDS, UNSCALE, RADIUS).filter((p) => p.type === "H");
    expect(highs).toHaveLength(1);
    expect(near(highs[0].position, 0, 30)).toBe(true);
  });

  it("finds a centre straddling the antimeridian once", () => {
    const img = field([{ lng: 180, lat: 10, amp: 18, sigma: 8 }]);
    const highs = findHighLows(img, BOUNDS, UNSCALE, RADIUS).filter((p) => p.type === "H");
    expect(highs).toHaveLength(1);
    expect(near(highs[0].position, 180, 10)).toBe(true);
  });

  it("puts a flat-topped (byte-quantised plateau) high at its centre", () => {
    // Clipped so the top is flat over ~±2 cells — the byte-step plateau a real
    // broad high shows on the 0.25° grid — narrower than the smoothing window.
    const img = field([{ lng: -60, lat: 45, amp: 20, sigma: 10, clipAt: 19.5 }]);
    const highs = findHighLows(img, BOUNDS, UNSCALE, RADIUS).filter((p) => p.type === "H");
    expect(highs).toHaveLength(1);
    expect(near(highs[0].position, -60, 45, 3)).toBe(true);
  });

  it("ignores no-data (alpha 0) regions", () => {
    const img = field([{ lng: 0, lat: 30, amp: 20, sigma: 8 }], (lng, lat) => Math.abs(lng) < 30 && Math.abs(lat - 30) < 30);
    const highs = findHighLows(img, BOUNDS, UNSCALE, RADIUS).filter((p) => p.type === "H");
    expect(highs.some((p) => near(p.position, 0, 30, 5))).toBe(false);
  });

  it("returns nothing for a degenerate image", () => {
    expect(findHighLows({ data: new Uint8Array(8), width: 2, height: 1 }, BOUNDS, UNSCALE, RADIUS)).toEqual([]);
  });
});

describe("fine bakes: folded search grid + refinement", () => {
  const cell = (deg: number) => 111_000 * deg;

  it("workGridFactor leaves the 0.25° GFS grid alone and folds finer bakes", () => {
    expect(workGridFactor(RADIUS, cell(1))).toBe(1);
    expect(workGridFactor(RADIUS, cell(0.25))).toBe(1);
    expect(workGridFactor(RADIUS, cell(0.125))).toBe(2);
    expect(workGridFactor(RADIUS, cell(0.0625))).toBe(4);
    expect(workGridFactor(RADIUS, cell(0.05))).toBe(5);
  });

  it("downsample takes NaN-aware block means", () => {
    // 4×2 grid, 2×2 blocks → 2×1.
    const v = new Float32Array([1, 3, 10, NaN, 5, 7, 20, 20]);
    const d = downsample(v, 4, 2, 2, 1);
    expect(d[0]).toBeCloseTo((1 + 3 + 5 + 7) / 4);
    expect(d[1]).toBeCloseTo((10 + 20 + 20) / 3);
  });

  it("a 0.05° regional bake: folded search lands where the full-grid search does", () => {
    // Europe at 0.05°: 1200×800 cells of ~5.5 km → factor 5 at the 2 000 km default.
    const EU: LngLatBounds = [-30, 30, 30, 70];
    const img = fieldOn(1200, 800, EU, [
      { lng: 2.03, lat: 50.02, amp: 20, sigma: 4 },
      { lng: 20.47, lat: 40.71, amp: -25, sigma: 4 },
    ]);
    const full = findHighLowsAt(img, EU, UNSCALE, RADIUS, 1);
    const folded = findHighLows(img, EU, UNSCALE, RADIUS);
    expect(full.map((p) => p.type).sort()).toEqual(["H", "L"]);
    expect(folded.map((p) => p.type).sort()).toEqual(["H", "L"]);
    for (const p of folded) {
      const twin = full.find((q) => q.type === p.type)!;
      // Same bake cell give or take one (0.05°), same decoded value (a byte step is 0.4 hPa).
      expect(Math.abs(p.position[0] - twin.position[0])).toBeLessThanOrEqual(0.11);
      expect(Math.abs(p.position[1] - twin.position[1])).toBeLessThanOrEqual(0.11);
      expect(Math.abs(p.value - twin.value)).toBeLessThanOrEqual(0.8);
    }
    const high = folded.find((p) => p.type === "H")!;
    expect(near(high.position, 2.03, 50.02, 0.15)).toBe(true);
    expect(high.value).toBeCloseTo(1033, 0);
    const low = folded.find((p) => p.type === "L")!;
    expect(near(low.position, 20.47, 40.71, 0.15)).toBe(true);
  });
});
