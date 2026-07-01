import { vectorRgba, byteToValue } from "./encode";
import { vectorKeepMask } from "./bakeVector";
import { vectorImageUnscaleFor, VECTOR_IMAGE_UNSCALE } from "./bake";

describe("vectorImageUnscaleFor", () => {
  it("returns the current range and falls back to wind", () => {
    expect(vectorImageUnscaleFor("current")).toEqual(VECTOR_IMAGE_UNSCALE.current);
    expect(vectorImageUnscaleFor("wind")).toEqual(VECTOR_IMAGE_UNSCALE.wind);
    expect(vectorImageUnscaleFor("unknown")).toEqual(VECTOR_IMAGE_UNSCALE.wind);
  });
});

describe("vectorKeepMask", () => {
  it("returns undefined for a clean field with no side mask (opaque like wind)", () => {
    const u = Float32Array.from([1, 2, 3]);
    const v = Float32Array.from([-1, 0, 1]);
    expect(vectorKeepMask(u, v)).toBeUndefined();
  });

  it("drops GRIB-undefined / non-finite pixels (RTOFS land)", () => {
    const u = Float32Array.from([1, 9.999e20, 3, NaN]);
    const v = Float32Array.from([1, 0, 3, 0]);
    const keep = vectorKeepMask(u, v)!;
    expect(Array.from(keep)).toEqual([1, 0, 1, 0]);
  });

  it("intersects with a sea mask when maskSide=sea", () => {
    const u = Float32Array.from([1, 1, 1]);
    const v = Float32Array.from([1, 1, 1]);
    const land = Float32Array.from([0, 1, 0]); // middle pixel is land
    const keep = vectorKeepMask(u, v, { maskSide: "sea", land })!;
    expect(Array.from(keep)).toEqual([1, 0, 1]);
  });
});

describe("vectorRgba encode → decode roundtrip", () => {
  const unscale: [number, number] = [-3, 3];

  it("packs u→R, v→G, B=0 and decodes back within 8-bit tolerance", () => {
    const u = Float32Array.from([0, 1.5, -3, 3]);
    const v = Float32Array.from([0, -1.5, 3, -3]);
    const buf = vectorRgba(u, v, 4, 1, unscale);
    for (let i = 0; i < 4; i++) {
      const o = i * 4;
      expect(byteToValue(buf[o], unscale)).toBeCloseTo(u[i], 1);
      expect(byteToValue(buf[o + 1], unscale)).toBeCloseTo(v[i], 1);
      expect(buf[o + 2]).toBe(0); // B always 0
      expect(buf[o + 3]).toBe(255); // opaque (no keep mask)
    }
  });

  it("bakes masked pixels as alpha 0 (nodata)", () => {
    const u = Float32Array.from([1, 2]);
    const v = Float32Array.from([1, 2]);
    const keep = Uint8Array.from([1, 0]);
    const buf = vectorRgba(u, v, 2, 1, unscale, keep);
    expect(buf[3]).toBe(255);
    expect(buf[7]).toBe(0); // second pixel masked
  });
});
