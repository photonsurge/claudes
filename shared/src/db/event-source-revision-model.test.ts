import { EventSourceRevisionSchema, type iEventSourceRevision } from "./event-source-revision-model";

describe("EventSourceRevisionSchema", () => {
  it("persists every iEventSourceRevision field", () => {
    const sample: Omit<iEventSourceRevision, "id" | "created" | "updated"> = {
      eventId: "evt-1",
      source: "gdacs",
      seq: 2,
      sourceTimestamp: "2026-07-12T15:00:00Z",
      acquiredAt: "2026-07-12T15:01:00Z",
      payloadHash: "def456",
      rawPayloadRef: "events/evt-1/raw/gdacs/2.json",
      normalized: { alertLevel: "Red" },
      diff: { changedFields: ["alertLevel"], before: { alertLevel: "Orange" }, after: { alertLevel: "Red" } },
    };
    const persisted = new Set(Object.keys(EventSourceRevisionSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });
});
