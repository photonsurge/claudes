import { AlertSeriesSchema, type iAlertSeries } from "./alert-series-model";

describe("AlertSeriesSchema", () => {
  it("persists every iAlertSeries field (strict mode drops unknown keys)", () => {
    const sample: Omit<iAlertSeries, "id" | "created" | "updated"> = {
      key: "gdacs:TC1000:alertscore",
      source: "gdacs",
      identifier: "TC1000",
      alertId: "uuid",
      metric: "alertscore",
      samples: [{ t: 1, v: 1.5 }],
      latest: 1.5,
      updatedAt: new Date(),
      loc: { type: "Point", coordinates: [0, 0] },
    };
    const persisted = new Set(Object.keys(AlertSeriesSchema.paths).map((p) => p.split(".")[0]));
    const missing = Object.keys(sample).filter((k) => !persisted.has(k));
    expect(missing).toEqual([]);
  });
});
