import sharp from "sharp";
import { imageUnscaleFor, SCALAR_IMAGE_UNSCALE, WIND_IMAGE_UNSCALE } from "./bake";
import { byteToValue } from "./encode";
import { convertScalarUnits, bakeScalar, scalarKeepMask } from "./bakeScalar";
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
    expect(imageUnscaleFor("rain")).toEqual([0, 50]);
    expect(imageUnscaleFor("storm")).toEqual([0, 8000]);
    expect(imageUnscaleFor("gust")).toEqual([0, 120]);
    expect(imageUnscaleFor("pressure")).toEqual([870, 1085]);
    expect(imageUnscaleFor("sst")).toEqual([-5, 40]);
    expect(imageUnscaleFor("cloud")).toEqual([0, 100]);
    expect(imageUnscaleFor("snow")).toEqual([0, 500]);
  });

  it("defines a radar (dBZ) decode range wider than its 5..75 colour domain", () => {
    expect(SCALAR_IMAGE_UNSCALE.radar).toBeDefined();
    const [min, max] = imageUnscaleFor("radar");
    expect(min).toBeLessThan(5); // covers the clear-air floor
    expect(max).toBeGreaterThanOrEqual(75); // covers hail cores
    expect(SCALAR_IMAGE_UNSCALE.radar).toEqual([-30, 80]);
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
  it("passes CAPE/gust through unchanged (identity)", () => {
    expect(convertScalarUnits("storm", Float32Array.from([2500]))[0]).toBe(2500);
    expect(convertScalarUnits("gust", Float32Array.from([42]))[0]).toBe(42);
  });
  it("converts rain PRATE mm/s -> mm/h (×3600)", () => {
    const out = convertScalarUnits("rain", Float32Array.from([0.001, 0]));
    expect(out[0]).toBeCloseTo(3.6, 5); // 0.001 mm/s -> 3.6 mm/h
    expect(out[1]).toBe(0);
  });
  it("converts sst WTMP K -> °C", () => {
    const out = convertScalarUnits("sst", Float32Array.from([273.15, 300]));
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[1]).toBeCloseTo(26.85, 2);
  });
  it("converts snow SNOD m -> cm (×100)", () => {
    const out = convertScalarUnits("snow", Float32Array.from([0.5, 1.2]));
    expect(out[0]).toBeCloseTo(50, 4);
    expect(out[1]).toBeCloseTo(120, 3);
  });
  it("passes cloud TCDC % through unchanged", () => {
    expect(convertScalarUnits("cloud", Float32Array.from([73]))[0]).toBe(73);
  });
  it("returns a new array and does not mutate the input", () => {
    const input = Float32Array.from([300]);
    const out = convertScalarUnits("temp", input);
    expect(out).not.toBe(input);
    expect(input[0]).toBe(300); // untouched
  });
});

describe("scalarKeepMask", () => {
  it("is undefined for vars with no mask/minVisible (fully opaque)", () => {
    expect(scalarKeepMask("temp", Float32Array.from([1, 2, 3]))).toBeUndefined();
  });

  it("masks SST to sea (keeps where land < 0.5)", () => {
    const vals = Float32Array.from([10, 12, 14, 16]);
    const land = Float32Array.from([1, 0, 1, 0]); // land, sea, land, sea
    const keep = scalarKeepMask("sst", vals, land);
    expect(Array.from(keep!)).toEqual([0, 1, 0, 1]);
  });

  it("masks snow to land AND hides below minVisible (0.5 cm)", () => {
    const vals = Float32Array.from([0.2, 5, 30, 0.4]); // cm
    const land = Float32Array.from([1, 1, 0, 1]); // land, land, sea, land
    const keep = scalarKeepMask("snow", vals, land);
    // idx0: land but <0.5cm → hide; idx1: land + 5cm → keep; idx2: sea → hide;
    // idx3: land but 0.4cm → hide.
    expect(Array.from(keep!)).toEqual([0, 1, 0, 0]);
  });

  it("hides cloud below minVisible (10%) with no land mask", () => {
    const keep = scalarKeepMask("cloud", Float32Array.from([5, 10, 80]));
    expect(Array.from(keep!)).toEqual([0, 1, 1]);
  });

  it("drops GRIB-undefined / non-finite points (wave land bitmap)", () => {
    // wave has no mask/minVisible, but bitmap-masked land is ~9.999e20 → nodata.
    const keep = scalarKeepMask("wave", Float32Array.from([2.5, 9.999e20, NaN, 4]));
    expect(Array.from(keep!)).toEqual([1, 0, 0, 1]);
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

  it("converts rain PRATE (mm/s) to mm/h and the rate decodes back", async () => {
    // 2-wide single row. rain decode range is [0,50] mm/h. rollLongitude with
    // width=2 shift=1 swaps the two columns, so assert per-decoded-value set.
    const w = 2;
    const h = 1;
    const curr = Float32Array.from([0.001, 0.002]); // mm/s -> ×3600 = 3.6, 7.2 mm/h
    const res = await bakeScalar({ variableId: "rain", values: curr, width: w, height: h });
    expect(res.encoding).toBe("scalar");
    expect(res.imageUnscale).toEqual([0, 50]);
    const { data } = await sharp(res.buffer).raw().toBuffer({ resolveWithObject: true });
    const range = res.imageUnscale;
    const lsb = (range[1] - range[0]) / 255;
    const decoded = [byteToValue(data[0], range), byteToValue(data[4], range)].sort((a, b) => a - b);
    expect(Math.abs(decoded[0] - 3.6)).toBeLessThanOrEqual(lsb); // 3.6 mm/h
    expect(Math.abs(decoded[1] - 7.2)).toBeLessThanOrEqual(lsb); // 7.2 mm/h
  });

  it("bakes SST transparent (alpha 0) over land using the land mask", async () => {
    // 2-wide single row; rollLongitude (shift=1) swaps the columns, so land
    // [land, sea] rolls to [sea, land] → keep [1, 0] → alpha [255, 0].
    const res = await bakeScalar({
      variableId: "sst",
      values: Float32Array.from([288, 290]), // K
      width: 2,
      height: 1,
      landValues: Float32Array.from([1, 0]),
    });
    const { data } = await sharp(res.buffer).raw().toBuffer({ resolveWithObject: true });
    const alphas = [data[3], data[7]];
    expect(alphas).toContain(0); // the land pixel is masked out
    expect(alphas).toContain(255); // the sea pixel is kept
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
