import {
  parseActivationList,
  parseCentroid,
  matchActivation,
  harvestUrls,
  normalizeCopernicusDetail,
  copernicusSource,
} from "./copernicus";

const listPayload = {
  activations: [
    { code: "EMSR847", gdacsId: "TC1000123", centroid: [120.1, 14.1], status: "open", title: "Cyclone Alpha" },
    { code: "EMSR900", gdacsId: "FL2000999", centroid: [-50, -20], status: "open" },
  ],
};

const detailPayload = {
  activation: {
    code: "EMSR847",
    title: "Cyclone Alpha",
    status: "open",
    lastUpdate: "2026-07-12T15:00:00Z",
    eventTime: "2026-07-12T12:00:00Z",
    gdacsId: "TC1000123",
    products: [
      { name: "Delineation", zip: "https://rapidmapping.emergency.copernicus.eu/EMSR847/DEL_01.zip" },
      { name: "Grading map", pdf: "https://rapidmapping.emergency.copernicus.eu/EMSR847/GRA_01.pdf" },
    ],
    services: ["https://services.emergency.copernicus.eu/arcgis/rest/services/EMSR847"],
  },
};

describe("parseCentroid", () => {
  it("reads centroids in several shapes", () => {
    expect(parseCentroid([10, 20])).toEqual([10, 20]);
    expect(parseCentroid({ lng: 10, lat: 20 })).toEqual([10, 20]);
    expect(parseCentroid({ longitude: 10, latitude: 20 })).toEqual([10, 20]);
    expect(parseCentroid({ coordinates: [10, 20] })).toEqual([10, 20]);
    expect(parseCentroid(null)).toBeNull();
  });
});

describe("parseActivationList", () => {
  it("pulls code / GDACS numeric id / centroid from the envelope", () => {
    const items = parseActivationList(listPayload);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ code: "EMSR847", gdacsNumericId: "1000123" });
    expect(items[0].centroid).toEqual([120.1, 14.1]);
  });
});

describe("matchActivation", () => {
  it("matches a GDACS-primary event EXPLICITLY by GDACS id", () => {
    const event = { primarySource: "gdacs", primarySourceId: "TC1000123", repPoint: { type: "Point", coordinates: [0, 0] } } as any;
    const m = matchActivation(event, parseActivationList(listPayload));
    expect(m).toEqual({ code: "EMSR847", method: "EXPLICIT_ID" });
  });

  it("falls back to a centroid proximity match (DERIVED) for a non-GDACS event", () => {
    const event = { primarySource: "wmo", primarySourceId: "cap-1", repPoint: { type: "Point", coordinates: [120.0, 14.0] } } as any;
    const m = matchActivation(event, parseActivationList(listPayload));
    expect(m?.code).toBe("EMSR847");
    expect(m?.method).toBe("DERIVED");
    expect(m?.score).toBeGreaterThan(0.9);
  });

  it("returns null when nothing is near", () => {
    const event = { primarySource: "wmo", primarySourceId: "cap-1", repPoint: { type: "Point", coordinates: [0, 0] } } as any;
    expect(matchActivation(event, parseActivationList(listPayload))).toBeNull();
  });
});

describe("harvestUrls / normalizeCopernicusDetail", () => {
  it("recursively harvests product/service URLs regardless of nesting", () => {
    const urls = harvestUrls(detailPayload);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://rapidmapping.emergency.copernicus.eu/EMSR847/DEL_01.zip",
        "https://rapidmapping.emergency.copernicus.eu/EMSR847/GRA_01.pdf",
        "https://services.emergency.copernicus.eu/arcgis/rest/services/EMSR847",
      ]),
    );
  });

  it("normalizes status/lastUpdate and a stable hash basis", () => {
    const n = normalizeCopernicusDetail(detailPayload, "EMSR847");
    expect(n.status).toBe("open");
    expect(n.lastUpdate).toBe("2026-07-12T15:00:00Z");
    expect(n.urls.length).toBe(3);
    const bumped = { activation: { ...detailPayload.activation, lastUpdate: "2026-07-12T16:00:00Z" } };
    expect(normalizeCopernicusDetail(bumped, "EMSR847").hashBasis).not.toBe(n.hashBasis);
  });
});

describe("copernicusSource.acquire", () => {
  const event = { id: "evt-1", primarySource: "gdacs", primarySourceId: "TC1000123", repPoint: { type: "Point", coordinates: [120, 14] }, title: "TC Alpha" } as any;

  function fakeDb() {
    const calls = { links: [] as any[], revisions: 0, resources: 0, beats: [] as any[] };
    const db = {
      eventLinks: {
        async listForEvent() {
          return [];
        },
        async upsertLink(l: any) {
          calls.links.push(l);
          return { linked: true };
        },
      },
      eventSources: { async observe() { return { changed: true, firstSeen: true }; } },
      eventSourceRevisions: { async append() { calls.revisions++; return {}; } },
      eventResources: { async upsertMany(l: any[]) { calls.resources += l.length; return { upserted: l.length, matched: 0 }; } },
      eventTimeline: { async appendMany(l: any[]) { calls.beats.push(...l); return { inserted: l.length }; } },
    } as any;
    return { db, calls };
  }

  const twoStepFetch = async (url: string) => {
    const body = url.includes("public-activations-info") ? listPayload : detailPayload;
    return { ok: true, json: async () => body } as unknown as Response;
  };

  it("explicit-matches by GDACS id, links it and stores products + beats", async () => {
    const { db, calls } = fakeDb();
    const res = await copernicusSource.acquire({ db, event, now: new Date("2026-07-12T15:00:00Z"), fetchImpl: twoStepFetch as any });
    expect(res.changed).toBe(true);
    expect(calls.links[0]).toMatchObject({ source: "copernicus", externalId: "EMSR847", matchMethod: "EXPLICIT_ID" });
    expect(calls.revisions).toBe(1);
    expect(calls.resources).toBe(3);
    expect(calls.beats.map((b) => b.type)).toEqual(expect.arrayContaining(["SOURCE_LINKED", "PRODUCT_ADDED"]));
  });
});
