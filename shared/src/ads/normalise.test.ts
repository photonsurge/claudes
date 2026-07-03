import {
  normaliseAdMeta,
  normaliseAdPatch,
  normaliseWeight,
} from "./normalise";
import { adMediaTypeFor } from "./types";

describe("normaliseAdMeta", () => {
  it("requires a title", () => {
    expect(normaliseAdMeta({})).toBeNull();
    expect(normaliseAdMeta({ title: "   " })).toBeNull();
    expect(normaliseAdMeta({ name: "From name" })?.title).toBe("From name");
  });

  it("defaults status to active and weight to 1", () => {
    const ad = normaliseAdMeta({ title: "Sponsor" });
    expect(ad).toMatchObject({ title: "Sponsor", status: "active", weight: 1 });
    expect(ad?.advertiser).toBeUndefined();
    expect(ad?.tags).toBeUndefined();
  });

  it("canonicalises status, weight, tags and trims strings", () => {
    const ad = normaliseAdMeta({
      title: "  Coffee Co  ",
      status: "inactive",
      weight: "3",
      advertiser: " Beans Ltd ",
      clickUrl: " https://beans.example ",
      tags: "coffee, coffee ,  , morning",
    });
    expect(ad).toEqual({
      title: "Coffee Co",
      status: "inactive",
      advertiser: "Beans Ltd",
      clickUrl: "https://beans.example",
      weight: 3,
      tags: ["coffee", "morning"],
      notes: undefined,
    });
  });

  it("falls back to defaults for bad status/weight", () => {
    const ad = normaliseAdMeta({ title: "x", status: "banana", weight: -5 });
    expect(ad?.status).toBe("active");
    expect(ad?.weight).toBe(1);
  });
});

describe("normaliseWeight", () => {
  it("accepts finite non-negative numbers and strings", () => {
    expect(normaliseWeight(2)).toBe(2);
    expect(normaliseWeight("4.5")).toBe(4.5);
    expect(normaliseWeight(0)).toBe(0);
  });
  it("defaults to 1 for junk", () => {
    expect(normaliseWeight(-1)).toBe(1);
    expect(normaliseWeight("abc")).toBe(1);
    expect(normaliseWeight(undefined)).toBe(1);
    expect(normaliseWeight(NaN)).toBe(1);
  });
});

describe("normaliseAdPatch", () => {
  it("only includes keys that are present", () => {
    expect(normaliseAdPatch({ status: "inactive" })).toEqual({ status: "inactive" });
    expect(normaliseAdPatch({})).toEqual({});
  });

  it("never blanks out the title but can clear other fields", () => {
    expect(normaliseAdPatch({ title: "  " })).toEqual({});
    expect(normaliseAdPatch({ advertiser: "" })).toEqual({ advertiser: undefined });
    expect(normaliseAdPatch({ clickUrl: "  " })).toEqual({ clickUrl: undefined });
  });

  it("ignores an invalid status", () => {
    expect(normaliseAdPatch({ status: "nope" })).toEqual({});
  });
});

describe("adMediaTypeFor", () => {
  it("maps supported types to a media kind", () => {
    expect(adMediaTypeFor("image/png")).toBe("image");
    expect(adMediaTypeFor("image/jpeg; charset=binary")).toBe("image");
    expect(adMediaTypeFor("video/mp4")).toBe("video");
  });
  it("returns null for unsupported types", () => {
    expect(adMediaTypeFor("application/pdf")).toBeNull();
    expect(adMediaTypeFor("text/html")).toBeNull();
  });
});
