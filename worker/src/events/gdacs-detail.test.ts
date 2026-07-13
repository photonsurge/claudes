import { normalizeGdacsDetail, parseGdacsPrimaryId, gdacsDetailSource } from "./gdacs-detail";

/** A representative GDACS geteventdata payload (Feature with properties). */
const fixture = {
  type: "Feature",
  properties: {
    eventtype: "TC",
    eventid: 1000123,
    alertlevel: "Orange",
    alertscore: 1.5,
    episodealertscore: 1.2,
    severitydata: { severity: 120, severitytext: "Category 3" },
    population: 4_800_000,
    name: "Tropical Cyclone Alpha",
    url: {
      report: "https://www.gdacs.org/report.aspx?eventid=1000123",
      details: "https://www.gdacs.org/gdacsapi/details/1000123",
      geometry: "https://www.gdacs.org/contentdata/1000123/geometry.geojson",
    },
    mapimage: "https://www.gdacs.org/contentdata/1000123/map.png",
    resources: [{ url: "https://www.gdacs.org/contentdata/1000123/track.kml", title: "Storm track" }],
  },
};

describe("parseGdacsPrimaryId", () => {
  it("splits a GDACS primary id into type + numeric id", () => {
    expect(parseGdacsPrimaryId("TC1000123")).toEqual({ eventType: "TC", eventid: "1000123" });
    expect(parseGdacsPrimaryId("FL987")).toEqual({ eventType: "FL", eventid: "987" });
  });
  it("rejects non-GDACS ids", () => {
    expect(parseGdacsPrimaryId("cap-123")).toBeNull();
    expect(parseGdacsPrimaryId("")).toBeNull();
  });
});

describe("normalizeGdacsDetail", () => {
  it("extracts metrics, resources and alert level defensively", () => {
    const n = normalizeGdacsDetail(fixture);
    expect(n.alertLevel).toBe("Orange");
    expect(n.eventName).toBe("Tropical Cyclone Alpha");
    expect(n.series.map((s) => s.metric).sort()).toEqual(["alertscore", "episodealertscore", "population", "severity"]);
    expect(n.series.find((s) => s.metric === "population")?.value).toBe(4_800_000);
    // report + details + geometry + map + track = 5 resources, kinds inferred.
    expect(n.resources.map((r) => r.kind).sort()).toEqual(["GEOJSON", "KML", "LINK", "MAP", "REPORT"]);
  });

  it("is stable: the hash basis only changes when a meaningful value moves", () => {
    const a = normalizeGdacsDetail(fixture).hashBasis;
    const b = normalizeGdacsDetail(JSON.parse(JSON.stringify(fixture))).hashBasis;
    expect(a).toBe(b);
    const bumped = { ...fixture, properties: { ...fixture.properties, alertlevel: "Red" } };
    expect(normalizeGdacsDetail(bumped).hashBasis).not.toBe(a);
  });

  it("survives a missing/empty payload", () => {
    const n = normalizeGdacsDetail({});
    expect(n.series).toEqual([]);
    expect(n.resources).toEqual([]);
  });
});

describe("gdacsDetailSource.appliesTo", () => {
  it("matches only GDACS-primary events with a parseable id", () => {
    expect(gdacsDetailSource.appliesTo({ primarySource: "gdacs", primarySourceId: "TC1000123" } as any)).toBe(true);
    expect(gdacsDetailSource.appliesTo({ primarySource: "wmo", primarySourceId: "cap-1" } as any)).toBe(false);
    expect(gdacsDetailSource.appliesTo({ primarySource: "gdacs", primarySourceId: "weird" } as any)).toBe(false);
  });
});

describe("gdacsDetailSource.acquire", () => {
  const event = { id: "evt-1", primarySource: "gdacs", primarySourceId: "TC1000123", title: "TC Alpha" } as any;

  /** A fake AppDb that records what the adapter persists. */
  function fakeDb(observeChanged: boolean, firstSeen: boolean) {
    const calls = { revisions: 0, links: 0, series: [] as string[], resources: 0, beats: [] as any[] };
    const db = {
      eventSources: { async observe() { return { changed: observeChanged, firstSeen }; } },
      eventLinks: { async upsertLink() { calls.links++; return { linked: true }; } },
      eventSourceRevisions: { async append() { calls.revisions++; return {}; } },
      eventSeries: { async appendSample(s: any) { calls.series.push(s.metric); return { appended: true }; } },
      eventResources: { async upsertMany(list: any[]) { calls.resources += list.length; return { upserted: list.length, matched: 0 }; } },
      eventTimeline: { async appendMany(list: any[]) { calls.beats.push(...list); return { inserted: list.length }; } },
    } as any;
    return { db, calls };
  }

  const okFetch = async () =>
    ({ ok: true, json: async () => fixture }) as unknown as Response;

  it("persists revision + series + resources + beats when the payload changed", async () => {
    const { db, calls } = fakeDb(true, true);
    const res = await gdacsDetailSource.acquire({ db, event, now: new Date("2026-07-12T15:00:00Z"), fetchImpl: okFetch as any });
    expect(res.changed).toBe(true);
    expect(calls.revisions).toBe(1);
    expect(calls.links).toBe(1);
    expect(calls.series.length).toBe(4);
    expect(calls.resources).toBe(5);
    // First-seen → SOURCE_LINKED beat present; alert level → IMPACT_UPDATE; products → PRODUCT_ADDED.
    expect(calls.beats.map((b) => b.type)).toEqual(
      expect.arrayContaining(["SOURCE_LINKED", "IMPACT_UPDATE", "PRODUCT_ADDED"]),
    );
  });

  it("writes nothing but the link when the payload is unchanged", async () => {
    const { db, calls } = fakeDb(false, false);
    const res = await gdacsDetailSource.acquire({ db, event, now: new Date(), fetchImpl: okFetch as any });
    expect(res.changed).toBe(false);
    expect(calls.revisions).toBe(0);
    expect(calls.beats).toHaveLength(0);
    expect(calls.links).toBe(1); // link is idempotent, always recorded
  });

  it("throws on an HTTP error so the scheduler backs off", async () => {
    const { db } = fakeDb(true, true);
    const badFetch = async () => ({ ok: false, status: 503 }) as unknown as Response;
    await expect(
      gdacsDetailSource.acquire({ db, event, now: new Date(), fetchImpl: badFetch as any }),
    ).rejects.toThrow(/503/);
  });
});
