import { clusterHotspots, magToSeverity, alertCentroid, aggregate, type HotspotPoint } from "./aggregate";

describe("magToSeverity", () => {
  it.each([
    [6.2, 4],
    [5.0, 3],
    [4.1, 2],
    [3.0, 1],
    [1.5, 1],
  ])("maps M%s → rank %i", (mag, rank) => {
    expect(magToSeverity(mag as number)).toBe(rank);
  });
});

describe("alertCentroid", () => {
  it("returns the bbox midpoint of a polygon area", () => {
    const alert = {
      info: [{ area: [{ geometry: { coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]] } }] }],
    };
    expect(alertCentroid(alert)).toEqual({ lng: 5, lat: 10 });
  });

  it("returns null when there is no geometry", () => {
    expect(alertCentroid({ info: [{ area: [{ geometry: null }] }] })).toBeNull();
  });
});

describe("clusterHotspots", () => {
  it("merges two nearby points into one hotspot with the max severity + count", () => {
    const pts: HotspotPoint[] = [
      { lng: 12, lat: 41, sev: 2, hazard: "flood", kind: "alert" },
      { lng: 13, lat: 42, sev: 4, hazard: "cyclone", kind: "alert" },
    ];
    const hotspots = clusterHotspots(pts, 5);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].count).toBe(2);
    expect(hotspots[0].maxSeverity).toBe(4);
    expect(hotspots[0].hazards).toEqual(["cyclone", "flood"]);
  });

  it("keeps far-apart points as separate hotspots, densest/severest first", () => {
    const pts: HotspotPoint[] = [
      { lng: 12, lat: 41, sev: 2, kind: "alert" },
      { lng: -120, lat: 37, sev: 4, kind: "quake" },
    ];
    const hotspots = clusterHotspots(pts, 5);
    expect(hotspots).toHaveLength(2);
    expect(hotspots[0].maxSeverity).toBe(4); // sorted severest first
  });

  it("clusters cross-kind events in the same cell", () => {
    const pts: HotspotPoint[] = [
      { lng: 100, lat: 0, sev: 3, hazard: "flood", kind: "alert" },
      { lng: 101, lat: 1, sev: 2, hazard: "earthquake", kind: "quake" },
    ];
    const hotspots = clusterHotspots(pts, 5);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].kinds).toEqual(["alert", "quake"]);
  });
});

describe("aggregate", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");

  const stubDb = (over: Partial<Record<"alerts" | "quakes" | "trackSnapshots", any>> = {}) =>
    ({
      alerts: { list: async () => over.alerts ?? [] },
      quakes: { list: async () => over.quakes ?? [] },
      trackSnapshots: { latest: async () => over.trackSnapshots ?? { at: null, rows: [] } },
    }) as any;

  it("reduces alerts into severity/hazard/source stats and counts cyclones", async () => {
    const alerts = [
      {
        id: "a1",
        identifier: "id-1",
        source: "gdacs",
        sent: "2026-07-01T11:00:00Z",
        maxSeverityRank: 4,
        info: [{ event: "Tropical Cyclone", headline: "TC Alpha", area: [] }],
      },
      {
        id: "a2",
        identifier: "id-2",
        source: "wmo",
        sent: "2026-07-01T11:30:00Z",
        maxSeverityRank: 2,
        info: [{ event: "Flood Warning", area: [] }],
      },
    ];
    const res = await aggregate(stubDb({ alerts }), "hourly", now);
    expect(res.stats.alertsActive).toBe(2);
    expect(res.stats.cyclones).toBe(1);
    expect(res.stats.alertsBySeverity["4"]).toBe(1);
    expect(res.stats.alertsBySeverity["2"]).toBe(1);
    expect(res.stats.alertsBySource).toEqual({ gdacs: 1, wmo: 1 });
    expect(res.sources).toContain("gdacs");
  });

  it("ranks top events by severity across kinds and tracks quake max magnitude", async () => {
    const alerts = [
      {
        id: "a1",
        identifier: "id-1",
        source: "wmo",
        sent: "2026-07-01T11:00:00Z",
        maxSeverityRank: 2,
        info: [{ event: "Flood", area: [] }],
      },
    ];
    const quakes = [
      { quakeId: "q1", mag: 6.5, place: "Off Japan", time: now, lng: 140, lat: 38 },
      { quakeId: "q2", mag: 3.2, place: "Nevada", time: now, lng: -117, lat: 39 },
    ];
    const res = await aggregate(stubDb({ alerts, quakes }), "daily", now);
    expect(res.stats.quakeCount).toBe(2);
    expect(res.stats.quakeMaxMag).toBe(6.5);
    // The M6.5 quake (sev 4) outranks the flood alert (sev 2).
    expect(res.topEvents[0].kind).toBe("quake");
    expect(res.topEvents[0].severity).toBe(4);
    expect(res.sources).toContain("usgs");
  });

  it("computes the lookback window from the cadence", async () => {
    const res = await aggregate(stubDb(), "12h", now);
    expect(res.windowEnd).toBe(now.toISOString());
    expect(res.windowStart).toBe(new Date("2026-07-01T00:00:00.000Z").toISOString());
  });
});
