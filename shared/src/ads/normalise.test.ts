import {
  normaliseAdMeta,
  normaliseAdPatch,
  normalisePlacements,
  normaliseWeight,
  sponsorNames,
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
      placements: ["break"],
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

describe("normalisePlacements", () => {
  it("accepts an array or a comma string, canonical order, junk dropped", () => {
    expect(normalisePlacements(["ticker", "break"])).toEqual(["break", "ticker"]);
    expect(normalisePlacements("ticker, break")).toEqual(["break", "ticker"]);
    expect(normalisePlacements("ticker, popup")).toEqual(["ticker"]);
  });

  it("accepts the billboard surface", () => {
    expect(normalisePlacements("billboard")).toEqual(["billboard"]);
    expect(normalisePlacements(["billboard", "break"])).toEqual(["break", "billboard"]);
  });

  it("defaults to break-only when empty or unusable", () => {
    expect(normalisePlacements(undefined)).toEqual(["break"]);
    expect(normalisePlacements("")).toEqual(["break"]);
    expect(normalisePlacements(["banner"])).toEqual(["break"]);
    expect(normalisePlacements(42)).toEqual(["break"]);
  });

  it("rides create meta and the patch (only when the key is present)", () => {
    expect(normaliseAdMeta({ title: "Spot" })?.placements).toEqual(["break"]);
    expect(normaliseAdMeta({ title: "Spot", placements: "ticker" })?.placements).toEqual(["ticker"]);
    expect(normaliseAdPatch({ placements: "break,ticker" })).toEqual({
      placements: ["break", "ticker"],
    });
    expect(normaliseAdPatch({})).toEqual({});
  });
});

describe("sponsorNames", () => {
  it("uses advertiser, falling back to title, skipping blanks", () => {
    expect(
      sponsorNames([
        { title: "Spring push", advertiser: "Acme Weather Gear" },
        { title: "House promo", advertiser: "   " },
        { title: "   " },
      ]),
    ).toEqual(["Acme Weather Gear", "House promo"]);
  });

  it("dedupes case-insensitively, keeping first spelling and order", () => {
    expect(
      sponsorNames([
        { title: "a", advertiser: "Acme" },
        { title: "b", advertiser: "ACME" },
        { title: "c", advertiser: "Borealis" },
      ]),
    ).toEqual(["Acme", "Borealis"]);
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
