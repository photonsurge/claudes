import { parseImoEruptionImages, resolveImoEruptionImageOperations } from "./imo";

describe("IMO EPOS eruption image adapter", () => {
  it("resolves only currently advertised operations from OpenAPI", () => {
    expect(resolveImoEruptionImageOperations({ servers: [{ url: "https://api.vedur.is/epos/" }], paths: {
      "/volcano/general-information/eruption-images": { get: {} },
    } })).toEqual(["https://api.vedur.is/epos/volcano/general-information/eruption-images"]);
  });

  it("resolves a relative OpenAPI server against the schema URL", () => {
    expect(resolveImoEruptionImageOperations({ servers: [{ url: "/epos/" }], paths: {
      "/volcano/monitoring-data/eruption-images": { get: {} },
    } })).toEqual(["https://api.vedur.is/epos/volcano/monitoring-data/eruption-images"]);
  });

  it("normalises image records without assuming one response envelope", () => {
    const rows = parseImoEruptionImages({ items: [{ id: "x1", volcano_name: "Fagradalsfjall", image_url: "/files/x.jpg",
      date: "2026-07-01T12:00:00Z", caption: "Eruption", credit: "IMO" }] }, "https://api.vedur.is/epos/volcano/general-information/eruption-images");
    expect(rows[0]).toMatchObject({ sourceMediaId: "x1", volcanoName: "Fagradalsfjall", attribution: "IMO", reuseAllowed: true });
    expect(rows[0].imageUrl).toBe("https://api.vedur.is/files/x.jpg");
  });
});
