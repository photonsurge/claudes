import { BILLBOARD_HOLD_MS, billboardAds, billboardIndex } from "./billboard";
import type { Ad } from "./types";

const ad = (adId: string, over: Partial<Ad> = {}): Ad => ({
  adId,
  title: adId,
  status: "active",
  mediaType: "image",
  contentType: "image/png",
  byteSize: 10,
  weight: 1,
  placements: ["billboard"],
  storage: "inline",
  updatedAt: 1000,
  ...over,
});

describe("billboardAds", () => {
  it("keeps only active, billboard-placed image ads", () => {
    const list = billboardAds([
      ad("on"),
      ad("off", { status: "inactive" }),
      ad("break-only", { placements: ["break"] }),
      ad("clip", { mediaType: "video", contentType: "video/mp4" }),
    ]);
    expect(list.map((a) => a.adId)).toEqual(["on"]);
  });

  it("orders by title then adId so every client rotates identically", () => {
    const list = billboardAds([
      ad("b", { title: "Zeta" }),
      ad("c", { title: "Acme" }),
      ad("a", { title: "Acme" }),
    ]);
    expect(list.map((a) => a.adId)).toEqual(["a", "c", "b"]);
  });

  it("ships a lean wire shape with a cache-busted media URL, no operator metadata", () => {
    const [wire] = billboardAds([
      ad("x", { advertiser: "Acme", width: 840, height: 300, notes: "private", tags: ["t"] }),
    ]);
    expect(wire).toEqual({
      adId: "x",
      title: "x",
      advertiser: "Acme",
      mediaUrl: "/api/ads/x/media?v=1000",
      width: 840,
      height: 300,
    });
  });
});

describe("billboardIndex", () => {
  it("advances once per hold window and wraps", () => {
    expect(billboardIndex(0, 3)).toBe(0);
    expect(billboardIndex(BILLBOARD_HOLD_MS - 1, 3)).toBe(0);
    expect(billboardIndex(BILLBOARD_HOLD_MS, 3)).toBe(1);
    expect(billboardIndex(3 * BILLBOARD_HOLD_MS, 3)).toBe(0);
  });

  it("is safe on an empty list", () => {
    expect(billboardIndex(Date.now(), 0)).toBe(0);
  });
});
