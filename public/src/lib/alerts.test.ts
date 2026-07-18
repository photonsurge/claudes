import {
  areaAlertFeatures,
  areaSummary,
  alertLocationLabels,
  expiresLabel,
  formatPeople,
  severityColor,
  severityLabel,
  type Alert,
} from "./alerts";

/** A geometry with the coordinates projected away (what omitCoordinates returns). */
const coordlessGeom = (type: string) =>
  ({ type } as unknown as { type: string; coordinates: unknown });

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: "a1",
  source: "nws",
  identifier: "urn:1",
  sender: "noaa",
  sent: "2026-06-28T11:30:00Z",
  msgType: "Alert",
  status: "Actual",
  active: true,
  maxSeverityRank: 3,
  expiresAt: "2026-06-28T13:00:00Z",
  info: [
    {
      event: "Severe Thunderstorm Warning",
      severityRank: 3,
      area: [{ areaDesc: "Cook County, IL", geocodes: [] }],
    },
  ],
  ...over,
});

describe("areaSummary", () => {
  it("shows the single area name", () => {
    expect(areaSummary(alert())).toBe("Cook County, IL");
  });
  it("collapses multiple unique areas to '+N more'", () => {
    const a = alert({
      info: [
        {
          event: "x",
          severityRank: 2,
          area: [
            { areaDesc: "A", geocodes: [] },
            { areaDesc: "B", geocodes: [] },
            { areaDesc: "C", geocodes: [] },
          ],
        },
      ],
    });
    expect(areaSummary(a)).toBe("A +2 more");
  });
  it("returns an em dash when there are no areas", () => {
    expect(areaSummary(alert({ info: [{ event: "x", severityRank: 0, area: [] }] }))).toBe("—");
  });
});

describe("alertLocationLabels", () => {
  it("shows a geometry-derived region and flag country for a MeteoAlarm alert", () => {
    const location = alertLocationLabels(alert({
      source: "meteoalarm",
      identifier: "2.49.0.0.250.0.FR.20260714232857.660046",
      info: [{
        event: "Heat warning",
        severityRank: 4,
        area: [{
          areaDesc: "Paris",
          geocodes: [],
          geometry: {
            type: "Polygon",
            coordinates: [[[2.2, 48.8], [2.5, 48.8], [2.5, 49], [2.2, 48.8]]],
          },
        }],
      }],
    }));

    expect(location).toEqual({ region: "Europe", country: "🇫🇷 France" });
  });

  it("uses the country catalog to supply a region when geometry is absent", () => {
    expect(alertLocationLabels(alert())).toEqual({
      region: "North America",
      country: "🇺🇸 United States",
    });
  });
});

describe("expiresLabel", () => {
  const now = new Date("2026-06-28T12:00:00Z");
  it("renders minutes when under an hour", () => {
    expect(expiresLabel(alert({ expiresAt: "2026-06-28T12:42:00Z" }), now)).toBe("in 42m");
  });
  it("renders hours when over an hour", () => {
    expect(expiresLabel(alert({ expiresAt: "2026-06-28T14:00:00Z" }), now)).toBe("in 2h");
  });
  it("renders 'expired' in the past and '—' when missing", () => {
    expect(expiresLabel(alert({ expiresAt: "2026-06-28T11:00:00Z" }), now)).toBe("expired");
    expect(expiresLabel(alert({ expiresAt: undefined }), now)).toBe("—");
  });
});

describe("areaAlertFeatures", () => {
  it("emits a geometry-less feature per polygoned area, carrying properties", () => {
    const a = alert({
      info: [
        {
          event: "Flood Warning",
          severityRank: 3,
          area: [
            { areaDesc: "River Basin", geocodes: [], geometry: coordlessGeom("Polygon") },
            { areaDesc: "Geocode Only", geocodes: [] }, // no geometry → skipped
          ],
        },
      ],
    });
    const feats = areaAlertFeatures([a]);
    expect(feats).toHaveLength(1);
    // The polygon vertices never reached us; the panel reads only properties.
    expect(feats[0].geometry).toEqual({ type: "Polygon", coordinates: [] });
    expect(feats[0].properties.areaDesc).toBe("River Basin");
    expect(feats[0].properties.identifier).toBe("urn:1");
    expect(feats[0].properties.severityRank).toBe(3);
  });

  it("never reads coordinates (safe when they're projected out of the read)", () => {
    const a = alert({
      info: [
        { event: "x", severityRank: 2, area: [{ areaDesc: "Z", geocodes: [], geometry: coordlessGeom("MultiPolygon") }] },
      ],
    });
    expect(areaAlertFeatures([a])[0].geometry).toEqual({ type: "MultiPolygon", coordinates: [] });
  });
});

describe("severity presentation", () => {
  it("maps ranks to a hex colour and label", () => {
    expect(severityColor(4)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(severityLabel(4)).toBe("Extreme");
  });
});

describe("formatPeople", () => {
  it("renders a compact label per magnitude", () => {
    expect(formatPeople(2_300_000_000)).toBe("2.3B");
    expect(formatPeople(1_200_000)).toBe("1.2M");
    expect(formatPeople(2_000_000)).toBe("2M"); // trailing .0 trimmed
    expect(formatPeople(410_000)).toBe("410k");
    expect(formatPeople(8_300)).toBe("8,300"); // below 10k stays exact
  });

  it("returns null for a missing or zero count so the field can hide", () => {
    // A geocode-only alert has no shape to count — rendering "0 people" over a
    // real warning reads as broken, so callers hide it instead.
    expect(formatPeople(undefined)).toBeNull();
    expect(formatPeople(null)).toBeNull();
    expect(formatPeople(0)).toBeNull();
    expect(formatPeople(NaN)).toBeNull();
  });
});
