import { EventSeriesSchema, type iEventSeries } from "./event-series-model";

describe("EventSeriesSchema", () => {
  it("persists every iEventSeries field", () => {
    const sample: Omit<iEventSeries, "id" | "created" | "updated"> = {
      key: "evt-1:gdacs:alertscore",
      eventId: "evt-1",
      source: "gdacs",
      metric: "alertscore",
      unit: "score",
      samples: [{ t: 1_752_330_000_000, v: 1.2 }],
      latest: 1.2,
      updatedAt: new Date("2026-07-12T15:00:00Z"),
    };
    const persisted = new Set(Object.keys(EventSeriesSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
