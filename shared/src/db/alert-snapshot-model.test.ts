import { AlertSnapshotSchema, type iAlertSnapshot } from "./alert-snapshot-model";

describe("AlertSnapshotSchema", () => {
  it("persists every iAlertSnapshot field (strict mode drops unknown keys)", () => {
    const sample: Omit<iAlertSnapshot, "id" | "created" | "updated"> = {
      source: "wmo",
      identifier: "cap-1",
      alertId: "uuid",
      kind: "satellite",
      layer: "geocolor",
      slotKey: "uuid:satellite:geocolor:2026-07-12T15",
      hourSlot: "2026-07-12T15",
      bounds: [0, 0, 1, 1],
      width: 1024,
      height: 768,
      observationTime: new Date(),
      capturedAt: new Date(),
      contentType: "image/png",
      pHash: "ffff",
      camId: "cam-1",
      distanceKm: 22,
      attribution: "NASA GIBS",
      png: Buffer.alloc(0),
    };
    const persisted = new Set(Object.keys(AlertSnapshotSchema.paths).map((p) => p.split(".")[0]));
    const missing = Object.keys(sample).filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });
});
