import {
  areaAlertFeatures,
  areaSummary,
  expiresLabel,
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
