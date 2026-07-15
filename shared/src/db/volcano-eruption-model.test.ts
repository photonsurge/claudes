import { VolcanoEruptionSchema, type iVolcanoEruption } from "./volcano-eruption-model";
import { eruptionToDoc } from "./volcano-eruption-repo";

describe("VolcanoEruptionSchema", () => {
  it("persists every iVolcanoEruption field", () => {
    const sample: Omit<iVolcanoEruption, "id" | "created" | "updated"> = {
      volcanoId: "gvp:211060",
      eruptionNumber: 12345,
      volcanoName: "Vesuvius",
      activityType: "Confirmed Eruption",
      confirmed: true,
      vei: 5,
      veiModifier: "?",
      startYear: 79,
      startMonth: 8,
      startDay: 24,
      startPrecision: "day",
      startModifier: "?",
      startUncertaintyYears: 2,
      startEvidence: "Observations: Reported",
      endYear: 79,
      endMonth: 9,
      endDay: 1,
      endPrecision: "day",
      endModifier: "<",
      endUncertaintyYears: 1,
      fetchedAt: new Date("2026-07-15T00:00:00Z"),
    };
    const persisted = new Set(Object.keys(VolcanoEruptionSchema.paths).map((p) => p.split(".")[0]));
    expect(Object.keys(sample).filter((k) => !persisted.has(k))).toEqual([]);
  });

  it("has NO TTL — eruption history is permanent", () => {
    const ttl = VolcanoEruptionSchema.indexes().filter(([, o]: any) => o?.expireAfterSeconds !== undefined);
    expect(ttl).toEqual([]);
  });
});

describe("eruptionToDoc", () => {
  it("flattens the fuzzy start/end dates into sortable columns", () => {
    const doc = eruptionToDoc({
      volcanoId: "gvp:1",
      eruptionNumber: 7,
      confirmed: true,
      vei: 6,
      start: { year: -4360, precision: "year", modifier: "?" },
      end: undefined,
      startEvidence: "Isotopic: 14C (calibrated)",
    });
    expect(doc).toMatchObject({
      volcanoId: "gvp:1",
      eruptionNumber: 7,
      startYear: -4360, // BCE survives
      startPrecision: "year",
      startModifier: "?",
    });
    expect(doc.startMonth).toBeUndefined();
    expect(doc.endYear).toBeUndefined(); // no end date (~56% of rows)
  });
});
