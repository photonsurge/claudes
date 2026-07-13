import { VolcanoSourceLinkSchema, type iVolcanoSourceLink } from "./volcano-source-link-model";

describe("VolcanoSourceLinkSchema", () => {
  it("persists every iVolcanoSourceLink field", () => {
    const sample: Omit<iVolcanoSourceLink, "id" | "created" | "updated"> = {
      volcanoId: "gvp:241040",
      source: "geonet",
      externalId: "ruapehu",
      externalCode: "RU",
      externalUrl: "https://www.geonet.org.nz/volcano/ruapehu",
      matchMethod: "coordinate",
      matchScore: 0.95,
      enabled: true,
      linkedAt: "2026-07-13T00:00:00Z",
    };
    const persisted = new Set(Object.keys(VolcanoSourceLinkSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
