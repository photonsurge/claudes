import { mosaicByPriority, blendSeams, isDefined } from "./mosaic";

const U = 9.999e20; // nodata

describe("mosaicByPriority", () => {
  it("picks the highest-priority defined value per pixel", () => {
    // 4 pixels. coarse covers all; fine covers pixels 1-2 only (nodata elsewhere).
    const coarse = { values: Float32Array.from([1, 1, 1, 1]), priority: 10 };
    const fine = { values: Float32Array.from([U, 2, 2, U]), priority: 20 };
    const out = mosaicByPriority([coarse, fine], 4);
    expect(Array.from(out)).toEqual([1, 2, 2, 1]); // fine wins where defined
  });

  it("leaves nodata where no tile covers", () => {
    const a = { values: Float32Array.from([U, 5]), priority: 5 };
    const out = mosaicByPriority([a], 2);
    expect(isDefined(out[0])).toBe(false);
    expect(out[1]).toBe(5);
  });

  it("is order-independent (sorts by priority, not array order)", () => {
    const coarse = { values: Float32Array.from([1, 1]), priority: 10 };
    const fine = { values: Float32Array.from([9, U]), priority: 20 };
    expect(Array.from(mosaicByPriority([coarse, fine], 2))).toEqual([9, 1]);
    expect(Array.from(mosaicByPriority([fine, coarse], 2))).toEqual([9, 1]);
  });
});

describe("blendSeams", () => {
  it("averages only across owner boundaries, leaving interiors intact", () => {
    // 1x4 row: pixels 0-1 owned by A (value 10), 2-3 by B (value 20).
    const values = Float32Array.from([10, 10, 20, 20]);
    const owner = Int32Array.from([1, 1, 2, 2]);
    const out = blendSeams(values, owner, 4, 1, 1);
    // Interior-most pixels (0 and 3) don't touch the other owner within margin 1?
    // pixel0 neighbours {0,1} all owner1 → unchanged.
    expect(out[0]).toBe(10);
    // pixel1 neighbours {0,1,2}: owner2 present → blended (10+10+20)/3.
    expect(out[1]).toBeCloseTo((10 + 10 + 20) / 3, 5);
    // pixel3 neighbours {2,3} all owner2 → unchanged.
    expect(out[3]).toBe(20);
  });

  it("margin 0 is a no-op", () => {
    const values = Float32Array.from([10, 20]);
    const owner = Int32Array.from([1, 2]);
    expect(Array.from(blendSeams(values, owner, 2, 1, 0))).toEqual([10, 20]);
  });
});
