import { WatchedEventSchema, type iWatchedEvent } from "./watched-event-model";

describe("WatchedEventSchema", () => {
  // Strict-mode parity guard: any interface field missing from the schema is
  // silently dropped on write.
  it("persists every iWatchedEvent field", () => {
    const sample: Omit<iWatchedEvent, "id" | "created" | "updated"> = {
      type: "CYCLONE",
      status: "ACTIVE",
      title: "Tropical Cyclone Alpha",
      startedAt: "2026-07-12T14:00:00Z",
      endedAt: "2026-07-14T00:00:00Z",
      repPoint: { type: "Point", coordinates: [120.5, 14.2] },
      bbox: [118, 12, 123, 17],
      primarySource: "gdacs",
      primarySourceId: "TC1000123",
      lastSourceUpdateAt: "2026-07-12T15:00:00Z",
      lastCheckedAt: "2026-07-12T15:05:00Z",
      watchUntil: "2026-07-19T00:00:00Z",
    };
    const persisted = new Set(Object.keys(WatchedEventSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
