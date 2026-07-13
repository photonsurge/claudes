import { EventTimelineUpdateSchema, type iEventTimelineUpdate } from "./event-timeline-update-model";

describe("EventTimelineUpdateSchema", () => {
  it("persists every iEventTimelineUpdate field", () => {
    const sample: Omit<iEventTimelineUpdate, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      at: "2026-07-12T14:17:00Z",
      type: "REPORT_ADDED",
      label: "OCHA flash update published",
      summary: "Situation report on the affected provinces.",
      source: "reliefweb",
      severityRank: 3,
      areaKm2: 14220,
      refUrl: "https://reliefweb.int/report/123",
      payloadHash: "hash789",
      data: { responses: 1241 },
      assetIds: ["snap-1"],
    };
    const persisted = new Set(Object.keys(EventTimelineUpdateSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
