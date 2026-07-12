import { AlertRevisionSchema, type iAlertRevision } from "./alert-revision-model";

describe("AlertRevisionSchema", () => {
  // Strict-mode parity guard (see broadcast-state-model.test.ts): any interface
  // field missing from the schema is silently dropped on write.
  it("persists every iAlertRevision field", () => {
    // A fully-populated revision — every domain key must map to a schema path.
    const sample: Omit<iAlertRevision, "id" | "created" | "updated"> = {
      source: "wmo",
      identifier: "cap-123",
      alertId: "uuid",
      seq: 1,
      at: "2026-07-12T14:00:00Z",
      msgType: "Update",
      status: "Actual",
      changes: [{ type: "SEVERITY_CHANGED", from: "2", to: "3" }],
      severityRank: 3,
      areaKm2: 12345,
      expiresAt: "2026-07-12T17:00:00Z",
      onset: "2026-07-12T14:00:00Z",
    };
    const persisted = new Set(Object.keys(AlertRevisionSchema.paths).map((p) => p.split(".")[0]));
    const missing = Object.keys(sample).filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });
});
