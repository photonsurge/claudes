import { describe, it, expect } from "@jest/globals";
import { isDarkFrame, pickEvenly, buildTimelapseWebp, frameLuma, planCamThinning } from "./camFrames";
import sharp from "sharp";

const OPTS = { nightMean: 26, glowMax: 90 };

const solid = (r: number, g: number, b: number, w = 16, h = 12) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

describe("isDarkFrame", () => {
  it("flags a flat dark night frame (skip it)", () => {
    expect(isDarkFrame({ mean: 8, max: 20 }, OPTS)).toBe(true);
  });

  it("keeps a daylight frame", () => {
    expect(isDarkFrame({ mean: 130, max: 240 }, OPTS)).toBe(false);
  });

  it("keeps a dark frame that carries a bright glow region (incandescence)", () => {
    // low mean but a hot bright spot → NOT dark → the money shot is kept
    expect(isDarkFrame({ mean: 10, max: 200 }, OPTS)).toBe(false);
  });
});

describe("pickEvenly", () => {
  it("returns the array unchanged when under the cap", () => {
    expect(pickEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("keeps first and last when thinning", () => {
    const got = pickEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
    expect(got[0]).toBe(0);
    expect(got[got.length - 1]).toBe(9);
    expect(got).toHaveLength(4);
  });

  it("max=1 returns the latest frame", () => {
    expect(pickEvenly([1, 2, 3], 1)).toEqual([3]);
  });
});

describe("frameLuma", () => {
  it("reads mean/max brightness", async () => {
    const dark = await frameLuma(await solid(4, 4, 4));
    expect(dark.mean).toBeLessThan(10);
    const bright = await frameLuma(await solid(250, 250, 250));
    expect(bright.mean).toBeGreaterThan(240);
  });
});

describe("planCamThinning", () => {
  const FULLRES = Date.parse("2026-07-10T00:00:00Z"); // frames before this are thinnable
  const opts = { fullResUntilMs: FULLRES, nightMean: 26 };

  it("keeps a day + a night representative per camera per UTC day, deletes the rest", () => {
    const frames = [
      // old day (2026-07-08) for cam A: three day frames + two night frames
      { id: "a-day1", camId: "A", capturedAt: "2026-07-08T10:00:00Z", meanLuma: 120, kind: "camera" },
      { id: "a-day2", camId: "A", capturedAt: "2026-07-08T12:00:00Z", meanLuma: 180, kind: "camera" }, // brightest day → keep
      { id: "a-day3", camId: "A", capturedAt: "2026-07-08T14:00:00Z", meanLuma: 90, kind: "camera" },
      { id: "a-nite1", camId: "A", capturedAt: "2026-07-08T22:00:00Z", meanLuma: 4, kind: "camera" },
      { id: "a-nite2", camId: "A", capturedAt: "2026-07-08T23:00:00Z", meanLuma: 15, kind: "camera" }, // brightest night (glow) → keep
    ];
    const del = planCamThinning(frames, opts);
    expect(del.sort()).toEqual(["a-day1", "a-day3", "a-nite1"].sort());
  });

  it("never thins recent (full-res) frames", () => {
    const frames = [
      { id: "r1", camId: "A", capturedAt: "2026-07-11T10:00:00Z", meanLuma: 120, kind: "camera" },
      { id: "r2", camId: "A", capturedAt: "2026-07-11T12:00:00Z", meanLuma: 180, kind: "camera" },
    ];
    expect(planCamThinning(frames, opts)).toEqual([]);
  });

  it("leaves render timelapses alone", () => {
    const frames = [
      { id: "t1", camId: "A", capturedAt: "2026-07-08T10:00:00Z", meanLuma: 0, kind: "render" },
      { id: "t2", camId: "A", capturedAt: "2026-07-08T12:00:00Z", meanLuma: 0, kind: "render" },
    ];
    expect(planCamThinning(frames, opts)).toEqual([]);
  });

  it("keeps the single frame when a day/cam has only one", () => {
    const frames = [{ id: "solo", camId: "A", capturedAt: "2026-07-08T10:00:00Z", meanLuma: 100, kind: "camera" }];
    expect(planCamThinning(frames, opts)).toEqual([]);
  });
});

describe("buildTimelapseWebp", () => {
  it("stitches frames into a multi-page animated webp", async () => {
    const frames = [await solid(200, 0, 0), await solid(0, 200, 0), await solid(0, 0, 200)];
    const { webp, frames: n, width, height } = await buildTimelapseWebp(frames, { width: 32, height: 24 });
    expect(n).toBe(3);
    expect(width).toBe(32);
    expect(height).toBe(24);
    const meta = await sharp(webp, { animated: true }).metadata();
    expect(meta.pages).toBe(3);
  });

  it("throws with fewer than two frames", async () => {
    await expect(buildTimelapseWebp([await solid(1, 1, 1)])).rejects.toThrow();
  });
});
