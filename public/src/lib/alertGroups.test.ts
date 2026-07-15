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

/** Strip an alert's geometry, keeping everything else. */
const noGeom = (a: Alert): Alert => ({
  ...a,
  info: [{ ...a.info[0], area: [{ areaDesc: a.id, geometry: null, geocodes: [] }] }],
});

describe("groupAlerts — exact capId merge", () => {
  const CAP = "2.49.0.0.756.0.CH.26071011050731023dbbbbfd9b41b742";

  it("merges the same national CAP message reported by two sources", () => {
    // The real case: one Swiss warning stored twice, once per source.
    const wmo = { ...mk("w", "wmo", "Wind", [0, 50, 2, 52]), capId: CAP };
    const ma = { ...mk("m", "meteoalarm", "Wind", [90, 10, 91, 11]), capId: CAP };

    const groups = groupAlerts([wmo, ma]);

    // Footprints are on opposite sides of the planet and would never bbox-match;
    // the exact id says it's one warning, and that outranks geometry.
    expect(groups).toHaveLength(1);
    expect(groups[0].sources).toEqual(["meteoalarm", "wmo"]);
  });

  it("merges across hazard buckets — each source words the event its own way", () => {
    const wmo = { ...mk("w", "wmo", "Orange high-temperature warning", [0, 50, 2, 52]), capId: CAP };
    const ma = { ...mk("m", "meteoalarm", "Flood warning", [0, 50, 2, 52]), capId: CAP };

    expect(groupAlerts([wmo, ma])).toHaveLength(1);
  });

  it("NEVER elects a geometry-less representative — the group must stay drawable", () => {
    // The overlay draws only representatives, so electing the shapeless copy
    // would erase this warning from the globe entirely.
    const shapeless = { ...noGeom(mk("m", "meteoalarm", "Wind", [0, 50, 2, 52])), capId: CAP };
    shapeless.maxSeverityRank = 4; // higher severity: would win on the old ordering
    shapeless.sent = "2026-06-29T23:00:00Z"; // and more recent
    const drawable = { ...mk("w", "wmo", "Wind", [0, 50, 2, 52]), capId: CAP };

    const [g] = groupAlerts([shapeless, drawable]);

    expect(g.members).toHaveLength(2);
    expect(g.representative.id).toBe("w");
    expect(g.id).toBe("w");
  });

  it("still ranks by severity then recency when both can be drawn", () => {
    const older = { ...mk("a", "wmo", "Wind", [0, 50, 2, 52]), capId: CAP };
    const newer = { ...mk("b", "meteoalarm", "Wind", [0, 50, 2, 52]), capId: CAP };
    newer.maxSeverityRank = 4;

    expect(groupAlerts([older, newer])[0].representative.id).toBe("b");
  });

  it("keeps the group's max severity across members", () => {
    const a = { ...mk("a", "wmo", "Wind", [0, 50, 2, 52]), capId: CAP };
    const b = { ...mk("b", "meteoalarm", "Wind", [0, 50, 2, 52]), capId: CAP };
    b.maxSeverityRank = 4;

    expect(groupAlerts([a, b])[0].maxSeverityRank).toBe(4);
  });

  it("pulls a three-source pile-up into ONE group", () => {
    const g = groupAlerts([
      { ...mk("a", "wmo", "Wind", [0, 50, 2, 52]), capId: CAP },
      { ...mk("b", "meteoalarm", "Wind", [80, 10, 81, 11]), capId: CAP },
      { ...mk("c", "nws", "Wind", [-100, 30, -99, 31]), capId: CAP },
    ]);

    expect(g).toHaveLength(1);
    expect(g[0].sources).toEqual(["meteoalarm", "nws", "wmo"]);
  });

  it("does not merge DIFFERENT capIds that happen to overlap", () => {
    const a = { ...mk("a", "wmo", "Wind", [0, 50, 2, 52]), capId: "cap-one" };
    const b = { ...mk("b", "meteoalarm", "Wind", [90, 10, 91, 11]), capId: "cap-two" };

    expect(groupAlerts([a, b])).toHaveLength(2);
  });

  it("leaves capId-less alerts to the bbox rule (GDACS, unresolved WMO)", () => {
    // ~20% of WMO alerts carry no identifier at all, so this path stays live.
    const a = mk("a", "wmo", "Wind", [0, 50, 2, 52]);
    const b = mk("b", "gdacs", "Wind", [1, 51, 3, 53]);

    expect(groupAlerts([a, b])).toHaveLength(1); // still merged, but by footprint
    expect(groupAlerts([a, mk("c", "gdacs", "Wind", [70, 10, 71, 11])])).toHaveLength(2);
  });
});
