import { EventSourceSchema, type iEventSource } from "./event-source-model";

describe("EventSourceSchema", () => {
  it("persists every iEventSource field", () => {
    const sample: Omit<iEventSource, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      source: "gdacs",
      sourceEventId: "1000123",
      sourceUrl: "https://www.gdacs.org/report.aspx?eventid=1000123",
      firstSeenAt: "2026-07-12T14:00:00Z",
      lastSeenAt: "2026-07-12T15:00:00Z",
      lastChangedAt: "2026-07-12T15:00:00Z",
      currentPayloadHash: "abc123",
      normalized: { alertLevel: "Orange", score: 1.2 },
    };
    const persisted = new Set(Object.keys(EventSourceSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
