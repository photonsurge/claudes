import sharp from "sharp";
import { vectorRgba, byteToValue } from "./encode";
import { vectorKeepMask, bakeVector } from "./bakeVector";
import { vectorImageUnscaleFor, VECTOR_IMAGE_UNSCALE } from "./bake";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";

/** Decode a baked PNG back to raw RGBA — same roundtrip goldenBake uses. */
async function decode(buffer: Buffer) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const raw = await img.raw().toBuffer();
  return { width: meta.width!, height: meta.height!, raw };
}

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

  it("intersects with a LAND mask when maskSide=land (the inverse)", () => {
    const u = Float32Array.from([1, 1, 1]);
    const v = Float32Array.from([1, 1, 1]);
    const land = Float32Array.from([0, 1, 0]); // only the middle pixel is land
    const keep = vectorKeepMask(u, v, { maskSide: "land", land })!;
    expect(Array.from(keep)).toEqual([0, 1, 0]);
  });

  it("nodata beats the side mask — an undefined sea pixel is still dropped", () => {
    // A pixel on the KEEP side that is also GRIB-undefined must not be kept:
    // finiteness is checked first, so land/sea can't resurrect a nodata point.
    const u = Float32Array.from([1, 9.999e20]);
    const v = Float32Array.from([1, 1]);
    const land = Float32Array.from([0, 0]); // both sea → both on the keep side
    const keep = vectorKeepMask(u, v, { maskSide: "sea", land })!;
    expect(Array.from(keep)).toEqual([1, 0]);
  });

  it("returns a mask (never undefined) whenever a side mask is requested", () => {
    // Even a totally clean field yields an explicit mask once maskSide is set —
    // the undefined shortcut is only for the no-mask, nothing-dropped case.
    const u = Float32Array.from([1, 2]);
    const v = Float32Array.from([3, 4]);
    const land = Float32Array.from([0, 0]);
    expect(vectorKeepMask(u, v, { maskSide: "sea", land })).toBeInstanceOf(Uint8Array);
  });

  it("the land pixel of a sea field has no coords stored, but the mask still marks it", () => {
    const u = Float32Array.from([5, 5]);
    const v = Float32Array.from([5, 5]);
    const land = Float32Array.from([1, 0]);
    expect(Array.from(vectorKeepMask(u, v, { maskSide: "sea", land })!)).toEqual([0, 1]);
  });
});

describe("bakeVector — the function, end to end", () => {
  const W = 4;
  const H = 1;
  const u = () => Float32Array.from([0, 1.5, -2, 3]);
  const v = () => Float32Array.from([0, -1.5, 2, -3]);

  it("throws for an unknown variable id (parity with bakeScalar)", async () => {
    await expect(bakeVector({ variableId: "nope", u: u(), v: v(), width: W, height: H })).rejects.toThrow(
      /unknown variable/i,
    );
  });

  it("produces a uv PNG of the right size, encoding and domain", async () => {
    const res = await bakeVector({ variableId: "wind", u: u(), v: v(), width: W, height: H, preRolled: true });
    const { width, height } = await decode(res.buffer);
    expect([width, height]).toEqual([W, H]);
    expect(res.encoding).toBe("uv");
    expect(res.imageUnscale).toEqual(vectorImageUnscaleFor("wind"));
    const reg = VARIABLE_REGISTRY["wind"];
    expect(res.domain).toEqual([reg.domain[0], reg.domain[1]]);
  });

  it("decodes u→R, v→G back within 8-bit tolerance", async () => {
    // `current` has a tight [-3,3] unscale (~0.024/byte), so decode precision is
    // fine here; `wind` is [-128,128] (~1.0/byte) and is exercised structurally
    // by the roll test below, where exact value precision doesn't matter.
    const res = await bakeVector({ variableId: "current", u: u(), v: v(), width: W, height: H, preRolled: true });
    const { raw } = await decode(res.buffer);
    const unscale = vectorImageUnscaleFor("current");
    for (let i = 0; i < W; i++) {
      expect(byteToValue(raw[i * 4], unscale)).toBeCloseTo(u()[i], 1);
      expect(byteToValue(raw[i * 4 + 1], unscale)).toBeCloseTo(v()[i], 1);
      expect(raw[i * 4 + 2]).toBe(0); // B always 0
    }
  });

  it("wind (a clean field, no mask) bakes fully opaque", async () => {
    const res = await bakeVector({ variableId: "wind", u: u(), v: v(), width: W, height: H, preRolled: true });
    const { raw } = await decode(res.buffer);
    for (let i = 0; i < W; i++) expect(raw[i * 4 + 3]).toBe(255);
  });

  it("maskSide=sea bakes land pixels transparent end to end", async () => {
    const land = Float32Array.from([0, 1, 0, 1]); // pixels 1 and 3 are land
    const res = await bakeVector({
      variableId: "current",
      u: u(),
      v: v(),
      width: W,
      height: H,
      preRolled: true,
      maskSide: "sea",
      landValues: land,
    });
    const { raw } = await decode(res.buffer);
    expect(raw[0 * 4 + 3]).toBe(255);
    expect(raw[1 * 4 + 3]).toBe(0); // land → nodata
    expect(raw[2 * 4 + 3]).toBe(255);
    expect(raw[3 * 4 + 3]).toBe(0); // land → nodata
  });

  it("rolls longitude when NOT pre-rolled, and leaves it alone when pre-rolled", async () => {
    // The synchronous roll pass — a 4-wide row rolls by half width (0..360 →
    // −180..180), so [a,b,c,d] becomes [c,d,a,b]. preRolled skips it entirely.
    const unscale = vectorImageUnscaleFor("wind");
    const decodeR = async (preRolled: boolean) => {
      const res = await bakeVector({ variableId: "wind", u: u(), v: v(), width: W, height: H, preRolled });
      const { raw } = await decode(res.buffer);
      return Array.from({ length: W }, (_, i) => Math.round(byteToValue(raw[i * 4], unscale)));
    };

    const notRolled = await decodeR(true);
    const rolled = await decodeR(false);

    // preRolled keeps source order; rolled swaps the two halves.
    expect(rolled).toEqual([notRolled[2], notRolled[3], notRolled[0], notRolled[1]]);
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
