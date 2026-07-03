import { adMediaUrl } from "./client";
import type { Ad } from "./types";

const baseAd: Ad = {
  adId: "abc 123",
  title: "Sponsor",
  status: "active",
  mediaType: "image",
  contentType: "image/png",
  byteSize: 10,
  weight: 1,
  storage: "inline",
};

describe("adMediaUrl", () => {
  it("builds an encoded, cache-busted media URL from updatedAt", () => {
    expect(adMediaUrl({ ...baseAd, updatedAt: 42 })).toBe("/api/ads/abc%20123/media?v=42");
  });

  it("falls back to createdAt then 0 when updatedAt is absent", () => {
    expect(adMediaUrl({ ...baseAd, createdAt: 7 })).toBe("/api/ads/abc%20123/media?v=7");
    expect(adMediaUrl(baseAd)).toBe("/api/ads/abc%20123/media?v=0");
  });
});
