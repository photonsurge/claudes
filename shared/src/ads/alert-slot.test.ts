import { alertSlotAds, alertSlotAt } from "./alert-slot";
import type { Ad } from "./types";

const ad = (adId: string, over: Partial<Ad> = {}): Ad => ({
  adId,
  title: adId,
  status: "active",
  mediaType: "image",
  contentType: "image/png",
  byteSize: 10,
  weight: 1,
  placements: ["alertSlot"],
  storage: "inline",
  updatedAt: 1000,
  ...over,
});

describe("alertSlotAds", () => {
  it("keeps only active, alert-slot-placed image ads", () => {
    const list = alertSlotAds([
      ad("on"),
      ad("off", { status: "inactive" }),
      ad("corner-only", { placements: ["billboard"] }),
      ad("clip", { mediaType: "video", contentType: "video/mp4" }),
    ]);
    expect(list.map((a) => a.adId)).toEqual(["on"]);
    expect(list[0].mediaUrl).toBe("/api/ads/on/media?v=1000");
  });
});

describe("alertSlotAt", () => {
  const seq = (n: number, alerts: number, sponsors: number) =>
    Array.from({ length: n }, (_, i) => {
      const s = alertSlotAt(i, alerts, sponsors)!;
      return `${s.kind === "alert" ? "a" : "S"}${s.index}`;
    });

  it("is nothing at all with no warnings and no sponsors", () => {
    expect(alertSlotAt(0, 0, 0)).toBeNull();
  });

  it("cycles the warnings alone when nothing is placed", () => {
    expect(seq(4, 3, 0)).toEqual(["a0", "a1", "a2", "a0"]);
  });

  it("holds the slot with the sponsors alone when nothing fresh is out", () => {
    expect(seq(3, 0, 2)).toEqual(["S0", "S1", "S0"]);
  });

  it("gives a sponsor its own turn after every two warnings, sponsors taking turns", () => {
    expect(seq(9, 3, 2)).toEqual(["a0", "a1", "S0", "a2", "a0", "S1", "a1", "a2", "S0"]);
  });

  it("alternates a lone warning with the sponsor rather than repeating it back-to-back", () => {
    expect(seq(4, 1, 1)).toEqual(["a0", "S0", "a0", "S0"]);
  });

  it("keeps a growing counter in range as the lists change underneath it", () => {
    expect(alertSlotAt(1000, 3, 2)).toEqual({ kind: "alert", index: 1 });
    expect(alertSlotAt(1001, 3, 2)).toEqual({ kind: "sponsor", index: 1 });
  });
});
