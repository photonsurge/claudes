import { EventResourceSchema, type iEventResource } from "./event-resource-model";

describe("EventResourceSchema", () => {
  it("persists every iEventResource field", () => {
    const sample: Omit<iEventResource, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      source: "copernicus",
      url: "https://emergency.copernicus.eu/EMSR123/product.pdf",
      kind: "MAP",
      title: "Delineation Map",
      description: "First mapping product for the activation.",
      mimeType: "application/pdf",
      sourceName: "Copernicus EMS",
      attribution: "© Copernicus Emergency Management Service",
      license: "CC-BY-4.0",
      rebroadcastSafe: false,
      contentHash: "chash1",
      discoveredAt: "2026-07-12T17:44:00Z",
      lastSeenAt: "2026-07-12T18:00:00Z",
      assetId: "snap-2",
    };
    const persisted = new Set(Object.keys(EventResourceSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
