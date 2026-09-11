import { ensurePlaceIndex, isPlaceIndexReady, placeAt, resetPlaceIndexForTests } from "./place-at";

const box = (w: number, s: number, e: number, n: number) => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
];

const mockFeatures = [
  {
    properties: { name: "Bigland", continent: "Africa", iso_a2: "bg" },
    geometry: { type: "Polygon", coordinates: box(0, 0, 20, 20) },
  },
  {
    // An enclave wholly inside Bigland — the smaller part must win.
    properties: { name: "Smallia", continent: "Africa", iso_a2: "SM" },
    geometry: { type: "Polygon", coordinates: box(5, 5, 7, 7) },
  },
  {
    // Two far-apart parts: the antimeridian-spanning bbox trap.
    properties: { name: "Splitia", continent: "Oceania", iso_a2: "SP" },
    geometry: { type: "MultiPolygon", coordinates: [box(-179, -5, -177, -3), box(177, -5, 179, -3)] },
  },
  {
    properties: { name: "Lone I.", continent: "Seven seas (open ocean)", iso_a2: "-99" },
    geometry: { type: "Polygon", coordinates: box(100, 0, 102, 2) },
  },
  {
    // No name → not a place the banner can title.
    properties: { continent: "Europe" },
    geometry: { type: "Polygon", coordinates: box(30, 30, 32, 32) },
  },
];

jest.mock("../layers/country-features", () => ({
  loadCountryFeatureList: jest.fn(() => Promise.resolve(mockFeatures)),
}));

describe("placeAt", () => {
  beforeEach(() => resetPlaceIndexForTests());

  it("answers null (and never throws) before the index is built", () => {
    expect(isPlaceIndexReady()).toBe(false);
    expect(placeAt(10, 10)).toBeNull();
  });

  it("names the country and continent under the point", async () => {
    await ensurePlaceIndex();
    expect(isPlaceIndexReady()).toBe(true);
    expect(placeAt(10, 10)).toEqual({ country: "Bigland", continent: "Africa", iso: "BG" });
  });

  it("prefers the smallest part, so an enclave beats the country around it", async () => {
    await ensurePlaceIndex();
    expect(placeAt(6, 6)?.country).toBe("Smallia");
  });

  it("leaves open ocean unnamed", async () => {
    await ensurePlaceIndex();
    expect(placeAt(60, 60)).toBeNull();
  });

  it("wraps a spun longitude back into the file's coordinate space", async () => {
    await ensurePlaceIndex();
    expect(placeAt(365, 12)?.country).toBe("Bigland");
    expect(placeAt(-355, 12)?.country).toBe("Bigland");
  });

  it("indexes multipolygon parts separately (no ocean between the halves)", async () => {
    await ensurePlaceIndex();
    expect(placeAt(178, -4)?.country).toBe("Splitia");
    expect(placeAt(-178, -4)?.country).toBe("Splitia");
    expect(placeAt(0, -4)).toBeNull();
  });

  it("treats Natural Earth's open-ocean pseudo-continent and -99 ISO as unknown", async () => {
    await ensurePlaceIndex();
    expect(placeAt(101, 1)).toEqual({ country: "Lone I.", continent: null, iso: null });
  });

  it("skips features with no usable name", async () => {
    await ensurePlaceIndex();
    expect(placeAt(31, 31)).toBeNull();
  });

  it("builds the index once, however many callers ask", async () => {
    const { loadCountryFeatureList } = jest.requireMock("../layers/country-features");
    loadCountryFeatureList.mockClear();
    await Promise.all([ensurePlaceIndex(), ensurePlaceIndex()]);
    await ensurePlaceIndex();
    expect(loadCountryFeatureList).toHaveBeenCalledTimes(1);
  });
});
