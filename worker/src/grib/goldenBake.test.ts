// Golden bake test: run known synthetic grids through the REAL bake path (sharp
// PNG encode) and decode the PNG back, asserting dimensions, decoded values
// (within 8-bit tolerance) and nodata→alpha-0. A decode roundtrip is used instead
// of a committed reference PNG so the test is stable across libvips versions while
// still verifying the encode is correct and reversible.
import sharp from "sharp";
import { bakeScalar } from "./bakeScalar";
import { bakeVector } from "./bakeVector";
import { byteToValue } from "./encode";
import { imageUnscaleFor, vectorImageUnscaleFor } from "./bake";

async function decode(buffer: Buffer) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const raw = await img.raw().toBuffer();
  return { width: meta.width!, height: meta.height!, raw };
}

describe("golden scalar bake (temp)", () => {
  it("produces a PNG of the right size whose R decodes back to the input", async () => {
    const width = 4;
    const height = 2;
    const values = Float32Array.from([-40, 0, 15, 30, -10, 5, 20, 40]); // °C
    const res = await bakeScalar({ variableId: "temp", values, width, height, preRolled: true, skipUnitConvert: true });
    const { width: w, height: h, raw } = await decode(res.buffer);
    expect([w, h]).toEqual([width, height]);
    const unscale = imageUnscaleFor("temp");
    expect(res.imageUnscale).toEqual(unscale);
    for (let i = 0; i < width * height; i++) {
      const R = raw[i * 4];
      expect(raw[i * 4 + 3]).toBe(255); // opaque (no mask)
      expect(byteToValue(R, unscale)).toBeCloseTo(values[i], 0); // within one 8-bit step
    }
  });
});

describe("golden vector bake (current) with nodata", () => {
  it("encodes u→R, v→G, bakes land (undefined) as alpha 0", async () => {
    const width = 3;
    const height = 1;
    // pixel 1 is land (undefined) → must be transparent.
    const u = Float32Array.from([1.5, 9.999e20, -2]);
    const v = Float32Array.from([-1.0, 9.999e20, 2.5]);
    const res = await bakeVector({ variableId: "current", u, v, width, height, preRolled: true });
    const { raw } = await decode(res.buffer);
    const unscale = vectorImageUnscaleFor("current");
    expect(raw[0 * 4 + 3]).toBe(255);
    expect(raw[1 * 4 + 3]).toBe(0); // land → nodata
    expect(raw[2 * 4 + 3]).toBe(255);
    expect(byteToValue(raw[0], unscale)).toBeCloseTo(1.5, 1);
    expect(byteToValue(raw[0 * 4 + 1], unscale)).toBeCloseTo(-1.0, 1);
    expect(byteToValue(raw[2 * 4 + 0], unscale)).toBeCloseTo(-2, 1);
    expect(byteToValue(raw[2 * 4 + 1], unscale)).toBeCloseTo(2.5, 1);
  });
});
