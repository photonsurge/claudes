import {
  CEILING_KNEE,
  CEILING_MAX,
  CRACKLE_HISS,
  CRACKLE_POP_PEAK,
  CRACKLE_POPS_PER_SEC,
  fillCrackle,
  softClipCurve,
} from "./dsp";

/** Deterministic PRNG (mulberry32) so the statistical checks are repeatable. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("softClipCurve", () => {
  const curve = softClipCurve(4097);
  const at = (x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

  it("is the identity below the knee", () => {
    for (const x of [0, 0.25, -0.5, 0.79, -0.79]) expect(at(x)).toBeCloseTo(x, 3);
  });

  it("never exceeds the ceiling, even at full scale", () => {
    let max = 0;
    for (const v of curve) max = Math.max(max, Math.abs(v));
    expect(max).toBeLessThanOrEqual(CEILING_MAX);
    expect(at(1)).toBeGreaterThan(CEILING_KNEE);
    expect(at(-1)).toBeCloseTo(-at(1), 6);
  });

  it("is monotonic (no folding)", () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });
});

describe("fillCrackle", () => {
  const countPops = (d: Float32Array) => {
    const thr = CRACKLE_HISS * 2;
    let n = 0;
    for (let i = 1; i < d.length; i++) if (Math.abs(d[i]) > thr && Math.abs(d[i - 1]) <= thr) n++;
    return n;
  };

  it("pops at roughly CRACKLE_POPS_PER_SEC regardless of sample rate", () => {
    const secs = 20;
    for (const sr of [44100, 48000, 96000]) {
      const d = fillCrackle(new Float32Array(sr * secs), sr, seeded(sr));
      const perSec = countPops(d) / secs;
      expect(perSec).toBeGreaterThan(CRACKLE_POPS_PER_SEC * 0.6);
      expect(perSec).toBeLessThan(CRACKLE_POPS_PER_SEC * 1.4);
    }
  });

  it("keeps every sample under the pop ceiling", () => {
    const d = fillCrackle(new Float32Array(48000 * 10), 48000, seeded(7));
    let max = 0;
    for (const v of d) max = Math.max(max, Math.abs(v));
    expect(max).toBeLessThanOrEqual(CRACKLE_POP_PEAK * 1.5);
    expect(max).toBeGreaterThan(CRACKLE_HISS);
  });
});

describe("fillRain", () => {
  const { fillRain, RAIN_DROPS_PER_SEC, RAIN_DROP_PEAK } = jest.requireActual("./dsp") as typeof import("./dsp");
  const seededRng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("drops at roughly RAIN_DROPS_PER_SEC at any sample rate and stays bounded", () => {
    for (const sr of [44100, 96000]) {
      const secs = 4;
      const d = fillRain(new Float32Array(sr * secs), sr, seededRng(sr));
      let onsets = 0;
      let max = 0;
      const thr = 0.03;
      const refractory = Math.floor(sr * 0.003); // a drop is 3–9 ms of noise: count it once
      for (let i = 1; i < d.length; i++) {
        max = Math.max(max, Math.abs(d[i]));
        if (Math.abs(d[i]) > thr) {
          onsets++;
          i += refractory;
        }
      }
      // drops overlap, so only sanity-bound the count
      expect(onsets / secs).toBeGreaterThan(RAIN_DROPS_PER_SEC * 0.4);
      expect(onsets / secs).toBeLessThan(RAIN_DROPS_PER_SEC * 3);
      expect(max).toBeLessThanOrEqual(RAIN_DROP_PEAK * 2);
    }
  });
});
