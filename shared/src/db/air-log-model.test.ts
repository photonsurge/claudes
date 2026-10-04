import { AirEntrySchema } from "./air-log-model";

describe("AirEntrySchema", () => {
  // Strict schema: an as-run field missing here is silently dropped on write.
  it("persists who ordered a cut through the command queue", () => {
    expect(AirEntrySchema.path("command.source")).toBeDefined();
    expect(AirEntrySchema.path("command.author")).toBeDefined();
  });
});
