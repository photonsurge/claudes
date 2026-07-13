import { diffVolcanoStatus, normalizeVolcanoStatus, type DiffableVolcano } from "./diff";

function make(o: Partial<DiffableVolcano> = {}): DiffableVolcano {
  return {
    status: o.status ?? "unrest",
    usgsAlertLevel: o.usgsAlertLevel,
    usgsColorCode: o.usgsColorCode,
    reportVei: o.reportVei,
    reportPlumeHeightM: o.reportPlumeHeightM,
    latestReport: o.latestReport ?? "Steady low-level activity continues.",
  };
}

const types = (a: DiffableVolcano | undefined, b: DiffableVolcano) => diffVolcanoStatus(a, b).map((e) => e.type);

describe("diffVolcanoStatus", () => {
  it("returns no changes on an identical re-poll", () => {
    expect(diffVolcanoStatus(make(), make())).toEqual([]);
  });

  it("returns no changes when prev is undefined (first-seen — ISSUED synthesised elsewhere)", () => {
    expect(diffVolcanoStatus(undefined, make())).toEqual([]);
  });

  it("detects a GVP activity-level change with raw from/to and scheme", () => {
    const d = diffVolcanoStatus(make({ status: "unrest" }), make({ status: "erupting" }));
    expect(d).toEqual([{ type: "ALERT_LEVEL_CHANGED", scheme: "GVP", from: "unrest", to: "erupting" }]);
  });

  it("detects a USGS alert-level change independently of the GVP status", () => {
    const d = diffVolcanoStatus(make({ usgsAlertLevel: "WATCH" }), make({ usgsAlertLevel: "WARNING" }));
    expect(d).toEqual([
      { type: "ALERT_LEVEL_CHANGED", scheme: "USGS_VOLCANO_ALERT_LEVEL", from: "WATCH", to: "WARNING" },
    ]);
  });

  it("emits both GVP and USGS level beats when both schemes move", () => {
    const prev = make({ status: "unrest", usgsAlertLevel: "WATCH" });
    const next = make({ status: "erupting", usgsAlertLevel: "WARNING" });
    expect(types(prev, next)).toEqual(["ALERT_LEVEL_CHANGED", "ALERT_LEVEL_CHANGED"]);
  });

  it("detects an aviation colour-code change", () => {
    const d = diffVolcanoStatus(make({ usgsColorCode: "ORANGE" }), make({ usgsColorCode: "RED" }));
    expect(d).toEqual([{ type: "AVIATION_COLOR_CHANGED", scheme: "USGS_AVIATION", from: "ORANGE", to: "RED" }]);
  });

  it("detects an activity/bulletin-text change", () => {
    const prev = make({ latestReport: "Quiet week, no unrest observed." });
    const next = make({ latestReport: "Ash plume to 5 km observed on 12 July." });
    expect(types(prev, next)).toEqual(["ACTIVITY_CHANGED"]);
  });

  it("ignores a re-published identical bulletin", () => {
    const report = "Continuing eruptive activity at the summit crater.";
    expect(diffVolcanoStatus(make({ latestReport: report }), make({ latestReport: report }))).toEqual([]);
  });

  it("does not flap ACTIVITY_CHANGED when the new bulletin text is empty", () => {
    const prev = make({ latestReport: "Some activity." });
    const next = make({ latestReport: "" });
    expect(diffVolcanoStatus(prev, next)).toEqual([]);
  });

  it("detects VEI and plume-height changes with from/to", () => {
    const prev = make({ reportVei: 2, reportPlumeHeightM: 3000 });
    const next = make({ reportVei: 3, reportPlumeHeightM: 8000 });
    expect(diffVolcanoStatus(prev, next)).toEqual([
      { type: "VEI_CHANGED", from: "2", to: "3" },
      { type: "PLUME_CHANGED", from: "3000", to: "8000" },
    ]);
  });

  it("does not emit VEI/plume changes when the new parse is missing (transient gap)", () => {
    const prev = make({ reportVei: 3, reportPlumeHeightM: 8000 });
    const next = make({ reportVei: undefined, reportPlumeHeightM: undefined });
    expect(diffVolcanoStatus(prev, next)).toEqual([]);
  });

  it("emits VEI when it appears for the first time (undefined → value)", () => {
    const d = diffVolcanoStatus(make({ reportVei: undefined }), make({ reportVei: 1 }));
    expect(d).toEqual([{ type: "VEI_CHANGED", from: undefined, to: "1" }]);
  });
});

describe("normalizeVolcanoStatus", () => {
  it("maps USGS volcano alert levels", () => {
    expect(normalizeVolcanoStatus({ scheme: "USGS_VOLCANO_ALERT_LEVEL", raw: "Warning" })).toBe("warning");
    expect(normalizeVolcanoStatus({ scheme: "USGS_VOLCANO_ALERT_LEVEL", raw: "normal" })).toBe("normal");
  });

  it("maps our GVP-derived status", () => {
    expect(normalizeVolcanoStatus({ scheme: "GVP", raw: "erupting" })).toBe("eruption");
    expect(normalizeVolcanoStatus({ scheme: "GVP", raw: "dormant" })).toBe("normal");
  });

  it("maps GeoNet numeric VAL levels", () => {
    expect(normalizeVolcanoStatus({ scheme: "GEONET_VAL", raw: "0" })).toBe("normal");
    expect(normalizeVolcanoStatus({ scheme: "GEONET_VAL", raw: "5" })).toBe("eruption");
  });

  it("falls through to unknown for unrecognised schemes/levels — never guessed", () => {
    expect(normalizeVolcanoStatus({ scheme: "PHIVOLCS", raw: "4" })).toBe("unknown");
    expect(normalizeVolcanoStatus({ scheme: "USGS_VOLCANO_ALERT_LEVEL", raw: "BANANA" })).toBe("unknown");
  });
});
