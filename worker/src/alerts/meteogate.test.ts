import { readFileSync } from "fs";
import { join } from "path";
import { parseLocationsPage, emmaFromCapJson, geometryFromFeatureDoc } from "./meteogate";

// Live captures from the MeteoGate EDR API (Poland, July 2026) — the shape this
// adapter exists to handle. Trimmed to 3 features; otherwise verbatim.
const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const LOCATIONS = fixture("meteogate-locations-pl.json");
const CAP_ALERT = fixture("meteogate-alert.json");
const FEATURE_GEOM = fixture("meteogate-feature-geom.json");

describe("parseLocationsPage", () => {
  it("pulls the alert id, bbox and both links out of a live EDR page", () => {
    const page = parseLocationsPage(LOCATIONS);

    expect(page.features.length).toBeGreaterThan(0);
    const f = page.features[0];
    expect(f.alertId).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.countryCode).toBe("PL");
    // The links are what make resolution possible at all: EMMA_ID is only in the
    // CAP json, the true shape only in the geometry doc.
    expect(f.jsonHref).toContain(".json");
    expect(f.geometryHref).toContain(".geojson");
    expect(f.bbox?.type).toBe("Polygon");
  });

  it("reads pagination so a sweep does not silently stop at page 1", () => {
    const page = parseLocationsPage(LOCATIONS);
    expect(page.page).toBe(1);
    expect(page.totalPages).toBeGreaterThanOrEqual(1);
  });

  it("survives junk instead of throwing mid-sweep", () => {
    expect(parseLocationsPage("not json").features).toEqual([]);
    expect(parseLocationsPage(JSON.stringify({ features: [{ properties: {} }] })).features).toEqual(
      [],
    );
  });
});

describe("emmaFromCapJson", () => {
  it("extracts the EMMA_ID that joins geometry to our CAP-feed alerts", () => {
    const { emmaId, identifier } = emmaFromCapJson(CAP_ALERT);
    expect(emmaId).toMatch(/^PL\d+$/);
    // The identifier is the same CAP id the meteoalarm adapter stores.
    expect(identifier).toContain("2.49.0.0.616.0.PL");
  });

  it("falls back to the first EMMA-bearing area when the index misses", () => {
    // Some members index inconsistently; an out-of-range index must not lose the code.
    const { emmaId } = emmaFromCapJson(CAP_ALERT, 99, 99);
    expect(emmaId).toMatch(/^PL\d+$/);
  });

  it("accepts both a bare alert and an {alert} wrapper", () => {
    const bare = JSON.parse(CAP_ALERT);
    expect(emmaFromCapJson(JSON.stringify({ alert: bare })).emmaId).toBe(
      emmaFromCapJson(CAP_ALERT).emmaId,
    );
  });

  it("returns no code rather than throwing on junk or a geocode-less alert", () => {
    expect(emmaFromCapJson("not json").emmaId).toBeUndefined();
    expect(
      emmaFromCapJson(JSON.stringify({ info: [{ area: [{ areaDesc: "x", geocode: [] }] }] })).emmaId,
    ).toBeUndefined();
  });
});

describe("geometryFromFeatureDoc", () => {
  it("returns the true area polygon, wound so Mongo's 2dsphere accepts it", () => {
    const g = geometryFromFeatureDoc(FEATURE_GEOM) as { type: string; coordinates: number[][][] };
    expect(g.type).toBe("Polygon");

    const ring = g.coordinates[0];
    expect(ring.length).toBeGreaterThan(3);
    // Closed …
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // … and counter-clockwise (a CW small ring reads as its complement → rejected).
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    expect(area).toBeGreaterThan(0);
  });

  it("returns null on junk so the caller falls back to the bbox", () => {
    expect(geometryFromFeatureDoc("not json")).toBeNull();
    expect(geometryFromFeatureDoc(JSON.stringify({ geometry: null }))).toBeNull();
  });
});
