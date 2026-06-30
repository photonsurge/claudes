import { groupAlerts } from "./alertGroups";
import type { Alert } from "./alerts";

/** Minimal alert with a square polygon footprint + an event. */
function mk(id: string, source: string, event: string, box: [number, number, number, number]): Alert {
  const [w, s, e, n] = box;
  return {
    id,
    source,
    identifier: id,
    sender: source,
    sent: "2026-06-29T10:00:00Z",
    msgType: "Alert",
    status: "Actual",
    active: true,
    maxSeverityRank: 3,
    info: [
      {
        event,
        severityRank: 3,
        area: [{ areaDesc: id, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, geocodes: [] }],
      },
    ],
  } as Alert;
}

describe("groupAlerts", () => {
  it("merges same-hazard overlapping alerts from different sources into one group", () => {
    const a = mk("a", "wmo", "High Wind Warning", [0, 50, 2, 52]);
    const b = mk("b", "meteoalarm", "Wind warning", [1, 51, 3, 53]); // overlaps a
    const groups = groupAlerts([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sources).toEqual(["meteoalarm", "wmo"]);
    expect(groups[0].members).toHaveLength(2);
  });

  it("keeps different hazards separate even when footprints overlap", () => {
    const wind = mk("w", "wmo", "High Wind Warning", [0, 50, 2, 52]);
    const flood = mk("f", "meteoalarm", "Flood warning", [0, 50, 2, 52]);
    const groups = groupAlerts([wind, flood]);
    expect(groups).toHaveLength(2);
  });

  it("keeps non-overlapping same-hazard alerts separate", () => {
    const a = mk("a", "wmo", "Wind", [0, 0, 1, 1]);
    const b = mk("b", "wmo", "Wind", [50, 50, 51, 51]);
    expect(groupAlerts([a, b])).toHaveLength(2);
  });

  it("treats geometry-less alerts as their own group", () => {
    const noGeo = { ...mk("x", "wmo", "Wind", [0, 0, 1, 1]) };
    noGeo.info = [{ event: "Wind", severityRank: 3, area: [{ areaDesc: "x", geometry: null, geocodes: [] }] }];
    const withGeo = mk("y", "meteoalarm", "Wind", [0, 0, 1, 1]);
    const groups = groupAlerts([noGeo as Alert, withGeo]);
    expect(groups).toHaveLength(2); // can't geo-match the geometry-less one
  });
});
