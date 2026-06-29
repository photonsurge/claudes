import { alertsToFeatures, type Alert } from "./alerts";

const base: Alert = {
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
  info: [],
};

describe("alertsToFeatures", () => {
  it("emits a feature per area that has geometry", () => {
    const alert: Alert = {
      ...base,
      info: [
        {
          event: "Severe Thunderstorm Warning",
          severityRank: 3,
          headline: "SVR",
          web: "https://x",
          area: [
            { areaDesc: "A", geocodes: [], geometry: { type: "Polygon", coordinates: [[[0, 0]]] } },
            { areaDesc: "B (geocode-only)", geocodes: [{ valueName: "UGC", value: "ILC031" }] },
          ],
        },
      ],
    };
    const feats = alertsToFeatures([alert]);
    expect(feats).toHaveLength(1);
    expect(feats[0].type).toBe("Feature");
    expect(feats[0].geometry.type).toBe("Polygon");
    expect(feats[0].properties).toMatchObject({
      id: "a1",
      event: "Severe Thunderstorm Warning",
      severityRank: 3,
      source: "nws",
    });
  });

  it("skips alerts with no drawable geometry", () => {
    const alert: Alert = {
      ...base,
      info: [{ event: "Flood", severityRank: 2, area: [{ areaDesc: "Z", geocodes: [], geometry: null }] }],
    };
    expect(alertsToFeatures([alert])).toEqual([]);
  });
});
