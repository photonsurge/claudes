import sharp from "sharp";
import { imageUnscaleFor, SCALAR_IMAGE_UNSCALE, WIND_IMAGE_UNSCALE } from "./bake";
import { byteToValue } from "./encode";
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

  it("returns explicit ranges for every known scalar variable", () => {
    expect(imageUnscaleFor("temp")).toEqual([-90, 60]);
    expect(imageUnscaleFor("humidity")).toEqual([0, 100]);
    expect(imageUnscaleFor("rain")).toEqual([0, 100]);
    expect(imageUnscaleFor("storm")).toEqual([0, 8000]);
    expect(imageUnscaleFor("gust")).toEqual([0, 120]);
    expect(imageUnscaleFor("pressure")).toEqual([870, 1085]);
  });

  it("falls back to the registry colour domain for vars without an explicit range", () => {
    // wind has no SCALAR_IMAGE_UNSCALE entry -> uses registry domain [0,60].
    expect(imageUnscaleFor("wind")).toEqual([0, 60]);
  });

  it("falls back to [0,1] for an entirely unknown variable", () => {
    expect(imageUnscaleFor("does-not-exist")).toEqual([0, 1]);
  });
});

describe("convertScalarUnits", () => {
  it("converts temp K -> °C", () => {
    const out = convertScalarUnits("temp", Float32Array.from([273.15, 300]));
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[1]).toBeCloseTo(26.85, 2);
  });
  it("converts temp K -> °C at physical extremes", () => {
    const out = convertScalarUnits("temp", Float32Array.from([233.15, 333.15]));
    expect(out[0]).toBeCloseTo(-40, 3);
    expect(out[1]).toBeCloseTo(60, 3);
  });
  it("converts pressure Pa -> hPa", () => {
    const out = convertScalarUnits("pressure", Float32Array.from([101325]));
    expect(out[0]).toBeCloseTo(1013.25, 2);
  });
  it("converts pressure Pa -> hPa at storm/high extremes", () => {
    const out = convertScalarUnits("pressure", Float32Array.from([87000, 108500]));
    expect(out[0]).toBeCloseTo(870, 2);
    expect(out[1]).toBeCloseTo(1085, 2);
  });
  it("passes humidity through unchanged", () => {
    const out = convertScalarUnits("humidity", Float32Array.from([55]));
    expect(out[0]).toBe(55);
  });
  it("passes CAPE/gust/rain through unchanged (identity)", () => {
    expect(convertScalarUnits("storm", Float32Array.from([2500]))[0]).toBe(2500);
    expect(convertScalarUnits("gust", Float32Array.from([42]))[0]).toBe(42);
    expect(convertScalarUnits("rain", Float32Array.from([7]))[0]).toBe(7);
  });
  it("returns a new array and does not mutate the input", () => {
    const input = Float32Array.from([300]);
    const out = convertScalarUnits("temp", input);
    expect(out).not.toBe(input);
    expect(input[0]).toBe(300); // untouched
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

  it("de-accumulates an accumulated field (rain) and the rate decodes back", async () => {
    // 2-wide single row. rain decode range is [0,100] mm/h. rollLongitude with
    // width=2 shift=1 swaps the two columns, so assert per-decoded-value set.
    const w = 2;
    const h = 1;
    const prev = Float32Array.from([0, 3]);
    const curr = Float32Array.from([3, 9]); // diffs 3 and 6 over 3h -> 1 and 2 mm/h
    const res = await bakeScalar({
      variableId: "rain",
      values: curr,
      prevValues: prev,
      deltaHours: 3,
      width: w,
      height: h,
    });
    expect(res.encoding).toBe("scalar");
    expect(res.imageUnscale).toEqual([0, 100]);
    const { data } = await sharp(res.buffer).raw().toBuffer({ resolveWithObject: true });
    const range = res.imageUnscale;
    const lsb = (range[1] - range[0]) / 255;
    const decoded = [byteToValue(data[0], range), byteToValue(data[4], range)].sort((a, b) => a - b);
    expect(Math.abs(decoded[0] - 1)).toBeLessThanOrEqual(lsb); // 1 mm/h
    expect(Math.abs(decoded[1] - 2)).toBeLessThanOrEqual(lsb); // 2 mm/h
  });

  it("treats an accumulated field with no prevValues (f000) as zero rate", async () => {
    const w = 2;
    const h = 1;
    const curr = Float32Array.from([5, 8]);
    const res = await bakeScalar({ variableId: "rain", values: curr, width: w, height: h });
    const { data } = await sharp(res.buffer).raw().toBuffer({ resolveWithObject: true });
    const range = res.imageUnscale;
    // zero rate -> byte 0 -> decodes to range min (0)
    expect(byteToValue(data[0], range)).toBeCloseTo(0, 6);
    expect(byteToValue(data[4], range)).toBeCloseTo(0, 6);
  });

  it("throws for an unknown variable id", async () => {
    await expect(
      bakeScalar({ variableId: "nope", values: Float32Array.from([1]), width: 1, height: 1 }),
    ).rejects.toThrow(/Unknown variable/);
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
