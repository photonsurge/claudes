import sharp from "sharp";
import {
  scaleToByte,
  byteToValue,
  rollLongitude,
  deaccumulate,
  windRgba,
  scalarRgba,
  encodeWindPng,
  encodeScalarPng,
  auroraColor,
  auroraRgba,
  encodeAuroraPng,
  AURORA_FLOOR,
  AURORA_REF,
} from "./encode";

describe("scaleToByte", () => {
  it("maps endpoints and midpoint", () => {
    expect(scaleToByte(-128, [-128, 128])).toBe(0);
    expect(scaleToByte(128, [-128, 128])).toBe(255);
    expect(scaleToByte(0, [-128, 128])).toBe(128); // round(0.5*255)=128
  });

  it("clamps out-of-range values", () => {
    expect(scaleToByte(-200, [-128, 128])).toBe(0);
    expect(scaleToByte(200, [-128, 128])).toBe(255);
  });

  it("clamps exactly at min and max", () => {
    expect(scaleToByte(0, [0, 100])).toBe(0); // at min
    expect(scaleToByte(100, [0, 100])).toBe(255); // at max
  });

  it("clamps just below min and just above max to the endpoints", () => {
    expect(scaleToByte(-0.0001, [0, 100])).toBe(0); // just below min
    expect(scaleToByte(100.0001, [0, 100])).toBe(255); // just above max
  });

  it("maps the midpoint to round(0.5*255)=128", () => {
    expect(scaleToByte(50, [0, 100])).toBe(128);
    expect(scaleToByte(0, [-90, 60])).not.toBeNaN();
  });

  it("handles non-finite and degenerate range", () => {
    expect(scaleToByte(NaN, [0, 1])).toBe(0);
    expect(scaleToByte(Infinity, [0, 1])).toBe(0);
    expect(scaleToByte(-Infinity, [0, 1])).toBe(0);
    expect(scaleToByte(5, [3, 3])).toBe(0);
  });

  it("round-trips a known value within 8-bit tolerance", () => {
    const range: [number, number] = [-90, 60];
    const value = 21.5;
    const b = scaleToByte(value, range);
    const decoded = byteToValue(b, range);
    const lsb = (range[1] - range[0]) / 255;
    expect(Math.abs(decoded - value)).toBeLessThanOrEqual(lsb);
  });
});

describe("rollLongitude", () => {
  it("rotates each row by half width (even width)", () => {
    // 4-wide, 2-row grid. shift = 2.
    const v = Float32Array.from([0, 1, 2, 3, 10, 11, 12, 13]);
    const out = rollLongitude(v, 4, 2);
    // out[col] = v[(col+2)%4]
    expect(Array.from(out)).toEqual([2, 3, 0, 1, 12, 13, 10, 11]);
  });

  it("handles odd width (wrap at 180)", () => {
    // 3-wide single row. shift = floor(3/2)=1.
    const v = Float32Array.from([100, 200, 300]);
    const out = rollLongitude(v, 3, 1);
    expect(Array.from(out)).toEqual([200, 300, 100]);
  });

  it("rolls an exact 4×2 grid mapping 0..360 -> -180..180 per row", () => {
    // Columns represent 0,90,180,270 degE. After roll (shift=2) the column
    // order becomes 180,270,0,90 which corresponds to -180,-90,0,90 degE.
    // Each row is rotated independently.
    const v = Float32Array.from([
      0, 90, 180, 270, // row 0
      1, 91, 181, 271, // row 1
    ]);
    const out = rollLongitude(v, 4, 2);
    expect(Array.from(out)).toEqual([
      180, 270, 0, 90,
      181, 271, 1, 91,
    ]);
  });

  it("width=1 is a no-op (shift=0)", () => {
    const v = Float32Array.from([7, 8, 9]);
    const out = rollLongitude(v, 1, 3);
    expect(Array.from(out)).toEqual([7, 8, 9]);
  });

  it("preserves array length and type", () => {
    const v = new Float32Array(12).fill(3);
    const out = rollLongitude(v, 6, 2);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(12);
  });
});

describe("deaccumulate", () => {
  it("returns zeros at f000 / no prev", () => {
    const curr = Float32Array.from([5, 10, 15]);
    const out = deaccumulate(curr, undefined, 0);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it("computes per-hour rate", () => {
    const prev = Float32Array.from([0, 6, 30]);
    const curr = Float32Array.from([3, 12, 30]);
    const out = deaccumulate(curr, prev, 3);
    // (3-0)/3=1, (12-6)/3=2, (30-30)/3=0
    expect(Array.from(out)).toEqual([1, 2, 0]);
  });

  it("never produces negative rates", () => {
    const prev = Float32Array.from([10]);
    const curr = Float32Array.from([4]);
    const out = deaccumulate(curr, prev, 3);
    expect(out[0]).toBe(0);
  });

  it("zero delta between steps yields zero rate", () => {
    const prev = Float32Array.from([5, 5, 5]);
    const curr = Float32Array.from([5, 5, 5]);
    const out = deaccumulate(curr, prev, 3);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it("clamps a mix of positive and negative diffs (negatives -> 0)", () => {
    const prev = Float32Array.from([0, 10, 4]);
    const curr = Float32Array.from([6, 4, 10]);
    const out = deaccumulate(curr, prev, 2);
    // (6-0)/2=3, (4-10)<0 -> 0, (10-4)/2=3
    expect(Array.from(out)).toEqual([3, 0, 3]);
  });

  it("treats deltaHours <= 0 as no-previous (all zeros)", () => {
    const prev = Float32Array.from([0, 0]);
    const curr = Float32Array.from([3, 9]);
    expect(Array.from(deaccumulate(curr, prev, 0))).toEqual([0, 0]);
    expect(Array.from(deaccumulate(curr, prev, -3))).toEqual([0, 0]);
  });

  it("returns a zero array of curr's length at f000", () => {
    const curr = new Float32Array(5).fill(99);
    const out = deaccumulate(curr, undefined, 3);
    expect(out.length).toBe(5);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("windRgba / scalarRgba", () => {
  it("wind packs u->R, v->G, B=0, A=255", () => {
    const u = Float32Array.from([0]);
    const v = Float32Array.from([128]);
    const buf = windRgba(u, v, 1, 1, [-128, 128]);
    expect(Array.from(buf)).toEqual([128, 255, 0, 255]);
  });

  it("scalar packs value into R=G=B, A=255", () => {
    const vals = Float32Array.from([60]);
    const buf = scalarRgba(vals, 1, 1, [-90, 60]);
    expect(buf[0]).toBe(255);
    expect(buf[1]).toBe(255);
    expect(buf[2]).toBe(255);
    expect(buf[3]).toBe(255);
  });
});

describe("auroraColor / auroraRgba", () => {
  it("is fully transparent at/below the floor", () => {
    expect(auroraColor(0)[3]).toBe(0);
    expect(auroraColor(AURORA_FLOOR)[3]).toBe(0);
  });

  it("keeps RGB non-black even when transparent (so the blur has no black halo)", () => {
    const [r, g, b, a] = auroraColor(0);
    expect(a).toBe(0);
    expect(r + g + b).toBeGreaterThan(0); // green low end, never black
  });

  it("alpha rises with probability above the floor", () => {
    const low = auroraColor(AURORA_FLOOR + 5)[3];
    const mid = auroraColor((AURORA_FLOOR + AURORA_REF) / 2)[3];
    const high = auroraColor(AURORA_REF)[3];
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it("ramps green (low) toward red (high)", () => {
    const lowGreen = auroraColor(AURORA_FLOOR + 1); // near green end
    const high = auroraColor(AURORA_REF); // red end
    expect(lowGreen[1]).toBeGreaterThan(lowGreen[0]); // G > R when green
    expect(high[0]).toBeGreaterThan(high[1]); // R > G when red
  });

  it("clamps probabilities above the reference to full-ramp alpha", () => {
    expect(auroraColor(999)[3]).toBe(auroraColor(AURORA_REF)[3]);
  });

  it("auroraRgba packs one [r,g,b,a] per cell", () => {
    const buf = auroraRgba(Float32Array.from([0, AURORA_REF]), 2, 1);
    expect(buf.length).toBe(2 * 4);
    expect(buf[3]).toBe(0); // first cell transparent
    expect(buf[7]).toBeGreaterThan(0); // second cell opaque-ish
  });
});

describe("PNG encoders", () => {
  it("encodeAuroraPng upsamples ×4 into a valid RGBA PNG", async () => {
    const w = 8;
    const h = 4;
    const vals = new Float32Array(w * h).fill(20);
    const png = await encodeAuroraPng(vals, w, h);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(w * 4);
    expect(meta.height).toBe(h * 4);
    expect(meta.channels).toBe(4);
  });


  it("encodeWindPng produces a valid PNG of expected dims", async () => {
    const w = 8;
    const h = 4;
    const u = new Float32Array(w * h).fill(0);
    const v = new Float32Array(w * h).fill(0);
    const png = await encodeWindPng(u, v, w, h, [-128, 128]);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(h);
  });

  it("encodeScalarPng produces a valid PNG and round-trips a known value", async () => {
    const w = 4;
    const h = 4;
    const range: [number, number] = [-90, 60];
    const value = 21.5;
    const vals = new Float32Array(w * h).fill(value);
    const png = await encodeScalarPng(vals, w, h, range);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(w);
    expect(info.height).toBe(h);
    // first pixel R channel decodes back near the value
    const decoded = byteToValue(data[0], range);
    const lsb = (range[1] - range[0]) / 255;
    expect(Math.abs(decoded - value)).toBeLessThanOrEqual(lsb);
  });
});
