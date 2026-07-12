import { AlertResourceSchema, type iAlertResource } from "./alert-resource-model";

describe("AlertResourceSchema", () => {
  it("persists every iAlertResource field (strict mode drops unknown keys)", () => {
    const sample: Omit<iAlertResource, "id" | "created" | "updated"> = {
      source: "gdacs",
      identifier: "TC1000",
      alertId: "uuid",
      url: "https://example.org/map.png",
      mimeType: "image/png",
      kind: "map",
      description: "GDACS map",
      harvestedAt: new Date(),
    };
    const persisted = new Set(Object.keys(AlertResourceSchema.paths).map((p) => p.split(".")[0]));
    const missing = Object.keys(sample).filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });
});
