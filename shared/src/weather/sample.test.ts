import {
  byteToValue,
  normalizeLng,
  latLngToPixel,
  bilinearChannel,
  sampleFrame,
  areaStatsFrame,
  seriesStats,
  type SampleGrid,
  type FrameLike,
} from "./sample";

/** Build an RGBA grid from per-pixel [r,g,b,a] tuples, row-major from NW. */
const rgbaOf = (pixels: number[][]): Uint8Array => Uint8Array.from(pixels.flat());

const GLOBAL_GFS = { bounds: [-180, -90, 180, 90], res: 0.25, width: 1440, height: 721 };

describe("byteToValue", () => {
  it("inverts the bake-side linear scale", () => {
    expect(byteToValue(0, [-90, 60])).toBe(-90);
    expect(byteToValue(255, [-90, 60])).toBe(60);
    expect(byteToValue(127.5, [0, 100])).toBeCloseTo(50);
  });
});

describe("normalizeLng", () => {
  it("wraps into -180..180", () => {
    expect(normalizeLng(190)).toBe(-170);
    expect(normalizeLng(-190)).toBe(170);
    expect(normalizeLng(360)).toBe(0);
    expect(normalizeLng(45)).toBe(45);
  });
});

describe("latLngToPixel", () => {
  it("maps the GFS corners (row 0 = north, col 0 = -180)", () => {
    expect(latLngToPixel(90, -180, GLOBAL_GFS)).toEqual({ x: 0, y: 0 });
    expect(latLngToPixel(-90, -180, GLOBAL_GFS)).toEqual({ x: 0, y: 720 });
    expect(latLngToPixel(0, 0, GLOBAL_GFS)).toEqual({ x: 720, y: 360 });
  });

  it("wraps longitude on global grids", () => {
    const px = latLngToPixel(0, 180, GLOBAL_GFS);
    expect(px).not.toBeNull();
    expect(px!.x).toBe(0); // 180°E is the same column as -180
  });

  it("returns null outside a regional frame", () => {
    const nest = { bounds: [-10, 40, 10, 60], res: 0.1, width: 200, height: 201 };
    expect(latLngToPixel(50, 0, nest)).not.toBeNull();
    expect(latLngToPixel(50, 20, nest)).toBeNull();
    expect(latLngToPixel(70, 0, nest)).toBeNull();
  });
});

describe("bilinearChannel", () => {
  const grid: SampleGrid = {
    // 2×2 grid: bytes 0, 100 / 200, 40 in R.
    rgba: rgbaOf([
      [0, 0, 0, 255],
      [100, 0, 0, 255],
      [200, 0, 0, 255],
      [40, 0, 0, 255],
    ]),
    width: 2,
    height: 2,
    bounds: [0, 0, 10, 10],
    res: 10,
  };

  it("returns exact values at pixel centres", () => {
    expect(bilinearChannel(grid, 0, 0, 0)).toBe(0);
    expect(bilinearChannel(grid, 1, 0, 0)).toBe(100);
    expect(bilinearChannel(grid, 0, 1, 0)).toBe(200);
  });

  it("interpolates between pixels", () => {
    expect(bilinearChannel(grid, 0.5, 0, 0)).toBe(50);
    expect(bilinearChannel(grid, 0.5, 0.5, 0)).toBe((0 + 100 + 200 + 40) / 4);
  });

  it("skips nodata (alpha 0) corners and renormalises", () => {
    const masked: SampleGrid = {
      ...grid,
      rgba: rgbaOf([
        [0, 0, 0, 0], // nodata
        [100, 0, 0, 255],
        [200, 0, 0, 0], // nodata
        [40, 0, 0, 255],
      ]),
    };
    // Halfway between the two valid corners of the top row → only x1 counts.
    expect(bilinearChannel(masked, 0.5, 0, 0)).toBe(100);
    const allMasked: SampleGrid = {
      ...grid,
      rgba: rgbaOf([
        [0, 0, 0, 0],
        [1, 0, 0, 0],
        [2, 0, 0, 0],
        [3, 0, 0, 0],
      ]),
    };
    expect(bilinearChannel(allMasked, 0.5, 0.5, 0)).toBeNull();
  });
});

describe("sampleFrame", () => {
  const scalarFrame: FrameLike = {
    encoding: "scalar",
    imageUnscale: [-90, 60],
    rgba: rgbaOf([
      [153, 153, 153, 255],
      [153, 153, 153, 255],
      [153, 153, 153, 255],
      [153, 153, 153, 255],
    ]),
    width: 2,
    height: 2,
    bounds: [0, 0, 10, 10],
    res: 10,
  };

  it("decodes a scalar byte back to physical units", () => {
    const s = sampleFrame(scalarFrame, 5, 5);
    expect(s).not.toBeNull();
    // byte 153 over [-90,60] → -90 + 153/255*150 = 0 °C
    expect(s!.kind).toBe("scalar");
    expect((s as any).value).toBeCloseTo(0, 5);
  });

  it("decodes a uv frame into u/v/speed", () => {
    const uv: FrameLike = {
      ...scalarFrame,
      encoding: "uv",
      imageUnscale: undefined,
      vectorUnscale: [-40, 40],
      // R=191.25 → u≈+20, G=63.75 → v≈-20
      rgba: rgbaOf([
        [191, 64, 0, 255],
        [191, 64, 0, 255],
        [191, 64, 0, 255],
        [191, 64, 0, 255],
      ]),
    };
    const s = sampleFrame(uv, 5, 5);
    expect(s!.kind).toBe("uv");
    const v = s as any;
    expect(v.u).toBeCloseTo(byteToValue(191, [-40, 40]), 5);
    expect(v.v).toBeCloseTo(byteToValue(64, [-40, 40]), 5);
    expect(v.speed).toBeCloseTo(Math.hypot(v.u, v.v), 5);
  });

  it("returns null out of bounds or without a decode range", () => {
    expect(sampleFrame(scalarFrame, 50, 5)).toBeNull();
    expect(sampleFrame({ ...scalarFrame, imageUnscale: undefined }, 5, 5)).toBeNull();
  });
});

describe("areaStatsFrame", () => {
  // 4×3 regional grid over [0,0,30,20], res 10; row 0 = north (lat 20).
  // R bytes laid out north→south: values 0,10,20,30 / 40,50,60,70 / 80,90,100,110.
  const bytes = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  const frame: FrameLike = {
    encoding: "scalar",
    imageUnscale: [0, 255], // identity decode: byte IS the value
    rgba: rgbaOf(bytes.map((b) => [b, b, b, 255])),
    width: 4,
    height: 3,
    bounds: [0, 0, 30, 20],
    res: 10,
  };

  it("aggregates mean/min/max over the covered window", () => {
    const all = areaStatsFrame(frame, [0, 0, 30, 20])!;
    expect(all.count).toBe(12);
    expect(all.min).toBe(0);
    expect(all.max).toBe(110);
    expect(all.mean).toBeCloseTo(55, 5);
    // Southern row only (lat 0 = row 2): 80..110.
    const south = areaStatsFrame(frame, [0, -5, 30, 0])!;
    expect(south.min).toBe(80);
    expect(south.max).toBe(110);
  });

  it("skips nodata pixels and misses cleanly", () => {
    const masked: FrameLike = {
      ...frame,
      rgba: rgbaOf(bytes.map((b, i) => [b, b, b, i === 0 ? 0 : 255])),
    };
    const stats = areaStatsFrame(masked, [0, 0, 30, 20])!;
    expect(stats.count).toBe(11);
    expect(stats.min).toBe(10); // the masked 0-byte pixel dropped out
    expect(areaStatsFrame(frame, [100, 0, 120, 20])).toBeNull(); // window elsewhere
  });

  it("applies an optional per-pixel mask on top of the bbox window", () => {
    // Keep only the western two columns (lng <= 10): 0,10 / 40,50 / 80,90.
    const western = areaStatsFrame(frame, [0, 0, 30, 20], 50_000, (_lat, lng) => lng <= 10)!;
    expect(western.count).toBe(6);
    expect(western.min).toBe(0);
    expect(western.max).toBe(90);
    expect(western.mean).toBeCloseTo(45, 5);
    // A mask that matches nothing misses cleanly, same as a bbox miss.
    expect(areaStatsFrame(frame, [0, 0, 30, 20], 50_000, () => false)).toBeNull();
  });

  it("wraps an antimeridian window on a global grid", () => {
    // 4-wide global grid: columns at -180,-90,0,90; single row.
    const g: FrameLike = {
      encoding: "scalar",
      imageUnscale: [0, 255],
      rgba: rgbaOf([
        [1, 1, 1, 255],
        [2, 2, 2, 255],
        [3, 3, 3, 255],
        [4, 4, 4, 255],
      ]),
      width: 4,
      height: 1,
      bounds: [-180, -45, 180, 45],
      res: 90,
    };
    // 90E → eastwards across the seam to -90: columns 4 (90) and 0 (-180)…
    const wrapped = areaStatsFrame(g, [90, -45, -90, 45])!;
    expect(wrapped.min).toBe(1);
    expect(wrapped.max).toBe(4);
    expect(wrapped.count).toBe(3); // 90, -180(=180), -90
  });
});

describe("seriesStats", () => {
  it("computes count/min/max/avg", () => {
    expect(seriesStats([2, 4, 6])).toEqual({ count: 3, min: 2, max: 6, avg: 4 });
    expect(seriesStats([])).toBeNull();
  });
});
