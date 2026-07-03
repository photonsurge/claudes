import {
  regionFitBounds,
  bboxToFitBounds,
  basemapStyle,
  isKnownBasemap,
  resolveBasemapId,
} from "./selectors";
import { DEFAULT_BASEMAP_ID } from "@photonsurge/shared/basemaps";

describe("region / bbox helpers", () => {
  it("converts a known region bbox to fitBounds corners", () => {
    // uk: [-16, 46, 7, 65]
    expect(regionFitBounds("uk")).toEqual([
      [-16, 46],
      [7, 65],
    ]);
  });
  it("returns null for an unknown region", () => {
    expect(regionFitBounds("atlantis")).toBeNull();
  });
  it("bboxToFitBounds maps [w,s,e,n] → [[w,s],[e,n]]", () => {
    expect(bboxToFitBounds([1, 2, 3, 4])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("basemap helpers", () => {
  it("knows registered basemaps", () => {
    expect(isKnownBasemap("dark")).toBe(true);
    expect(isKnownBasemap("nope")).toBe(false);
  });
  it("resolves unknown ids to the default", () => {
    expect(resolveBasemapId("nope")).toBe(DEFAULT_BASEMAP_ID);
    expect(resolveBasemapId(undefined)).toBe(DEFAULT_BASEMAP_ID);
    expect(resolveBasemapId("dark")).toBe("dark");
  });
  it("returns a maplibre style object for a basemap", () => {
    const style = basemapStyle("dark");
    expect(style).toHaveProperty("version", 8);
    expect(style).toHaveProperty("sources");
  });
});
