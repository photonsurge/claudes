import { AirEntrySchema, AirRunSchema } from "./air-log-model";

describe("AirEntrySchema", () => {
  // Strict schema: an as-run field missing here is silently dropped on write.
  it("persists who ordered a cut through the command queue", () => {
    expect(AirEntrySchema.path("command.source")).toBeDefined();
    expect(AirEntrySchema.path("command.author")).toBeDefined();
  });

  it("persists the break-in detail and a grouped cut's members", () => {
    expect(AirEntrySchema.path("breakIn.reason")).toBeDefined();
    expect(AirEntrySchema.path("breakIn.interrupted")).toBeDefined();
    expect(AirEntrySchema.path("breakInItems")).toBeDefined();
  });
});

describe("AirRunSchema", () => {
  it("persists the run counters", () => {
    for (const k of ["breakIns", "grouped", "commands", "viewerRequests", "queueDropped"]) {
      expect([k, AirRunSchema.path(k) != null]).toEqual([k, true]);
    }
  });
});
