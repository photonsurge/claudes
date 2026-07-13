import { EventWatchScheduleSchema, type iEventWatchSchedule } from "./event-watch-schedule-model";

describe("EventWatchScheduleSchema", () => {
  it("persists every iEventWatchSchedule field", () => {
    const sample: Omit<iEventWatchSchedule, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      source: "gdacs",
      nextCheckAt: new Date("2026-07-12T15:05:00Z"),
      intervalSeconds: 120,
      failureCount: 0,
      lastSuccessAt: new Date("2026-07-12T15:00:00Z"),
      lastCheckedAt: new Date("2026-07-12T15:00:00Z"),
    };
    const persisted = new Set(Object.keys(EventWatchScheduleSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
