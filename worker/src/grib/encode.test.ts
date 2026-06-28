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

  it("handles non-finite and degenerate range", () => {
    expect(scaleToByte(NaN, [0, 1])).toBe(0);
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

describe("PNG encoders", () => {
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
