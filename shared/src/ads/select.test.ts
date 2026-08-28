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
  placements: ["break"],
  storage: "inline",
  ...over,
});

describe("pickAdForAir", () => {
  it("returns null when there are no active ads", () => {
    expect(pickAdForAir([])).toBeNull();
    expect(pickAdForAir([ad({ status: "inactive" })])).toBeNull();
  });

  it("only ever picks an active ad", () => {
    const ads = [ad({ adId: "off", status: "inactive", timesShown: 0 }), ad({ adId: "on", timesShown: 5 })];
    expect(pickAdForAir(ads, () => 0)?.adId).toBe("on");
  });

  it("rotates to the least-shown ad, not a repeat of the leader", () => {
    // "a" has already aired twice, "b" and "c" never have — both are due
    // before "a" gets another turn, regardless of weight.
    const ads = [
      ad({ adId: "a", timesShown: 2, weight: 5 }),
      ad({ adId: "b", timesShown: 0 }),
      ad({ adId: "c", timesShown: 0 }),
    ];
    const pick = pickAdForAir(ads, () => 0)?.adId;
    expect(["b", "c"]).toContain(pick);
    expect(pick).not.toBe("a");
  });

  it("cycles the whole set before repeating once every ad has aired equally", () => {
    const ads = [ad({ adId: "a", timesShown: 3 }), ad({ adId: "b", timesShown: 3 })];
    // Now tied on timesShown and lastShownAt — falls back to weight/exclude/rng.
    expect(pickAdForAir(ads, () => 0, "a")?.adId).toBe("b");
    expect(pickAdForAir(ads, () => 0, "b")?.adId).toBe("a");
  });

  it("uses weight only to break a genuine tie among equally-due ads", () => {
    const ads = [ad({ adId: "a", timesShown: 0, weight: 1 }), ad({ adId: "b", timesShown: 0, weight: 5 })];
    expect(pickAdForAir(ads, () => 0.99)?.adId).toBe("b");
  });

  it("prefers whoever aired longest ago when timesShown ties", () => {
    const ads = [
      ad({ adId: "a", timesShown: 1, lastShownAt: 200 }),
      ad({ adId: "b", timesShown: 1, lastShownAt: 100 }),
    ];
    expect(pickAdForAir(ads, () => 0)?.adId).toBe("b");
  });

  it("excludes the previous airing so back-to-back breaks don't repeat", () => {
    const ads = [ad({ adId: "a" }), ad({ adId: "b" })];
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
