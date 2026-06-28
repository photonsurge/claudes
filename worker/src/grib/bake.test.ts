import sharp from "sharp";
import { imageUnscaleFor, SCALAR_IMAGE_UNSCALE, WIND_IMAGE_UNSCALE } from "./bake";
import { convertScalarUnits, bakeScalar } from "./bakeScalar";
import { bakeWind } from "./bakeWind";

describe("imageUnscaleFor", () => {
  it("returns explicit scalar ranges wider than the colour domain", () => {
    // temp domain is [-40,50]; decode range must be wider on both ends.
    const [min, max] = imageUnscaleFor("temp");
    expect(min).toBeLessThan(-40);
    expect(max).toBeGreaterThanOrEqual(50);
    expect(SCALAR_IMAGE_UNSCALE.temp).toEqual([min, max]);
  });
});

describe("convertScalarUnits", () => {
  it("converts temp K -> °C", () => {
    const out = convertScalarUnits("temp", Float32Array.from([273.15, 300]));
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[1]).toBeCloseTo(26.85, 2);
  });
  it("converts pressure Pa -> hPa", () => {
    const out = convertScalarUnits("pressure", Float32Array.from([101325]));
    expect(out[0]).toBeCloseTo(1013.25, 2);
  });
  it("passes humidity through unchanged", () => {
    const out = convertScalarUnits("humidity", Float32Array.from([55]));
    expect(out[0]).toBe(55);
  });
});

describe("bakeScalar", () => {
  it("produces a scalar PNG with the variable's decode range + domain", async () => {
    const w = 4;
    const h = 2;
    const values = new Float32Array(w * h).fill(290); // K
    const res = await bakeScalar({ variableId: "temp", values, width: w, height: h });
    expect(res.encoding).toBe("scalar");
    expect(res.imageUnscale).toEqual(SCALAR_IMAGE_UNSCALE.temp);
    expect(res.domain).toEqual([-40, 50]);
    const meta = await sharp(res.buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(h);
  });

  it("de-accumulates an accumulated field (rain)", async () => {
    const w = 2;
    const h = 1;
    const prev = Float32Array.from([0, 3]);
    const curr = Float32Array.from([3, 9]);
    const res = await bakeScalar({
      variableId: "rain",
      values: curr,
      prevValues: prev,
      deltaHours: 3,
      width: w,
      height: h,
    });
    expect(res.encoding).toBe("scalar");
    // smoke: it produced a valid PNG
    const meta = await sharp(res.buffer).metadata();
    expect(meta.width).toBe(w);
  });
});

describe("bakeWind", () => {
  it("produces a uv PNG with the symmetric wind decode range", async () => {
    const w = 4;
    const h = 2;
    const u = new Float32Array(w * h).fill(10);
    const v = new Float32Array(w * h).fill(-10);
    const res = await bakeWind({ u, v, width: w, height: h });
    expect(res.encoding).toBe("uv");
    expect(res.imageUnscale).toEqual(WIND_IMAGE_UNSCALE);
    expect(res.domain).toEqual([0, 60]);
    const meta = await sharp(res.buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(h);
  });
});
