import { VolcanoSchema, type iVolcano } from "./volcano-model";

describe("VolcanoSchema", () => {
  it("persists every iVolcano field (strict mode silently drops anything missing)", () => {
    const sample: Omit<iVolcano, "id" | "created" | "updated"> = {
      volcanoId: "gvp:264260",
      name: "Tara, Batu",
      country: "Indonesia",
      lat: -7.791,
      lng: 123.585,
      status: "erupting",
      firstDate: new Date("2026-07-01T00:00:00Z"),
      lastDate: new Date("2026-07-14T00:00:00Z"),
      statusChangedAt: new Date("2026-07-10T00:00:00Z"),
      sourceUrl: "https://volcano.si.edu/volcano.cfm?vn=264260",
      latestReport: "Ash plume observed.",
      reportDateRange: "8-14 July 2026",
      fetchedAt: new Date("2026-07-15T00:00:00Z"),
      bulletinAt: new Date("2026-07-14T00:00:00Z"),
      archiveEnabled: true,
      loc: { type: "Point", coordinates: [123.585, -7.791] },
      catalogSource: "gvp-wfs",
      catalogFetchedAt: new Date("2026-07-15T00:00:00Z"),
      volcanicLandform: "Composite",
      region: "Sunda-Banda Volcanic Regions",
      subregion: "Sunda Volcanic Arc",
      tectonicSetting: "Subduction zone / Oceanic crust (< 15 km)",
      geologicEpoch: "Holocene",
      evidenceCategory: "Eruption Observed",
      majorRockTypes: ["Trachybasalt", "Tephrite Basanite"],
      geologicalSummary: "The small isolated island of Batu Tara.",
      primaryPhotoUrl: "https://volcano.si.edu/gallery/photos/GVP-06345.jpg",
      primaryPhotoCaption: "Batu Tara from the SE.",
      primaryPhotoCredit: "Photo by O. Rukman, 1981.",
      wikiTitle: "Batu Tara",
      wikiThumb: "https://example.test/t.jpg",
      wikiPhoto: "https://example.test/p.jpg",
      wikiExtract: "A volcanic island.",
      wikiGallery: ["https://example.test/g1.jpg"],
      wikiFetchedAt: new Date("2026-07-01T00:00:00Z"),
      elevationM: 633,
      volcanoType: "Stratovolcano",
      lastEruptionYear: 2015,
      usgsAlertLevel: "WATCH",
      usgsColorCode: "ORANGE",
      usgsNoticeSynopsis: "Elevated unrest.",
      usgsNoticeUrl: "https://volcanoes.usgs.gov/notice",
      usgsUpdatedAt: new Date("2026-07-14T00:00:00Z"),
      officialSource: "geonet",
      officialAlertScheme: "GEONET_VAL",
      officialAlertLevelRaw: "2",
      officialAlertLevelNormalized: "unrest",
      officialActivity: "Moderate volcanic unrest.",
      officialUpdatedAt: new Date("2026-07-14T00:00:00Z"),
      reportVei: 2,
      reportPlumeHeightM: 3000,
      reportParsedAt: new Date("2026-07-14T00:00:00Z"),
    };
    const persisted = new Set(Object.keys(VolcanoSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });

  it("has NO TTL index — the catalog is permanent, dormant volcanoes keep their stats", () => {
    const ttl = VolcanoSchema.indexes().filter(([, opts]: any) => opts?.expireAfterSeconds !== undefined);
    expect(ttl).toEqual([]);
  });
});
