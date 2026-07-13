import { EventSnapshotSchema, type iEventSnapshot } from "./event-snapshot-model";

describe("EventSnapshotSchema", () => {
  it("persists every iEventSnapshot field", () => {
    const sample: Omit<iEventSnapshot, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      source: "gdacs",
      kind: "satellite",
      layer: "truecolor",
      slotKey: "evt-1:satellite:truecolor:2026-07-12T15",
      hourSlot: "2026-07-12T15",
      bounds: [118, 12, 123, 17],
      width: 1024,
      height: 768,
      observationTime: new Date("2026-07-12T00:00:00Z"),
      capturedAt: new Date("2026-07-12T15:00:00Z"),
      contentType: "image/png",
      pHash: "ffee00aa",
      meanLuma: 42,
      camId: "cam-9",
      distanceKm: 18,
      attribution: "NASA GIBS",
      png: Buffer.from([1, 2, 3]),
    };
    const persisted = new Set(Object.keys(EventSnapshotSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
