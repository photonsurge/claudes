import { pickAdForAir } from "./select";
import { adMediaPath } from "./types";
import type { Ad } from "./types";

const ad = (over: Partial<Ad>): Ad => ({
  adId: "x",
  title: "x",
  status: "active",
  mediaType: "image",
  contentType: "image/png",
  byteSize: 1,
  weight: 1,
  storage: "inline",
  ...over,
});

describe("pickAdForAir", () => {
  it("returns null when there are no active ads", () => {
    expect(pickAdForAir([])).toBeNull();
    expect(pickAdForAir([ad({ status: "inactive" })])).toBeNull();
  });

  it("only ever picks an active ad", () => {
    const ads = [ad({ adId: "off", status: "inactive", weight: 100 }), ad({ adId: "on", weight: 1 })];
    for (let r = 0; r < 1; r += 0.05) {
      expect(pickAdForAir(ads, () => r)?.adId).toBe("on");
    }
  });

  it("weights the pick by `weight` (rng maps into the cumulative band)", () => {
    // weights 1 (a) then 3 (b): total 4. roll = rng*4.
    const ads = [ad({ adId: "a", weight: 1 }), ad({ adId: "b", weight: 3 })];
    expect(pickAdForAir(ads, () => 0.0)?.adId).toBe("a"); // roll 0 → a
    expect(pickAdForAir(ads, () => 0.2)?.adId).toBe("a"); // roll 0.8 → a (band [0,1))
    expect(pickAdForAir(ads, () => 0.3)?.adId).toBe("b"); // roll 1.2 → b (band [1,4))
    expect(pickAdForAir(ads, () => 0.99)?.adId).toBe("b");
  });

  it("falls back to uniform random when all weights are zero", () => {
    const ads = [ad({ adId: "a", weight: 0 }), ad({ adId: "b", weight: 0 })];
    expect(pickAdForAir(ads, () => 0.0)?.adId).toBe("a");
    expect(pickAdForAir(ads, () => 0.9)?.adId).toBe("b");
  });

  it("excludes the previous airing so back-to-back breaks don't repeat", () => {
    const ads = [ad({ adId: "a" }), ad({ adId: "b" })];
    // rng() => 0 would normally pick "a" first, but it just aired.
    expect(pickAdForAir(ads, () => 0, "a")?.adId).toBe("b");
    expect(pickAdForAir(ads, () => 0, "b")?.adId).toBe("a");
  });

  it("still shows the excluded ad when it's the only active one", () => {
    const ads = [ad({ adId: "a" }), ad({ adId: "off", status: "inactive" })];
    expect(pickAdForAir(ads, () => 0, "a")?.adId).toBe("a");
  });
});

describe("adMediaPath", () => {
  it("builds an encoded, cache-busted serve URL", () => {
    expect(adMediaPath("a b", 42)).toBe("/api/ads/a%20b/media?v=42");
    expect(adMediaPath("x")).toBe("/api/ads/x/media?v=0");
  });
});
