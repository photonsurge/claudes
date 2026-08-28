import {
  BROADCAST_REPORT_SLIDES,
  REPORT_SLIDE_IDS,
  REPORT_PRESETS,
  REPORT_KINDS,
  isReportSlideId,
  isReportKind,
  applyReportPrefs,
  DEFAULT_REPORT_HOLD_MS,
} from "./broadcast-report";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

describe("broadcast-report catalog", () => {
  it("has unique ids and non-empty labels", () => {
    expect(new Set(REPORT_SLIDE_IDS).size).toBe(REPORT_SLIDE_IDS.length);
    for (const s of BROADCAST_REPORT_SLIDES) {
      expect(s.label).toBeTruthy();
      expect(s.note).toBeTruthy();
    }
  });

  it("recognises catalog ids and rejects anything else", () => {
    expect(isReportSlideId("seismic")).toBe(true);
    expect(isReportSlideId("nope")).toBe(false);
    expect(isReportSlideId(3)).toBe(false);
  });

  it("presets curate both layers with real ids; 'Everything' clears both", () => {
    for (const p of REPORT_PRESETS) {
      for (const id of p.off) expect(isReportSlideId(id)).toBe(true);
      for (const id of p.kindsOff) expect(isReportKind(id)).toBe(true);
    }
    const all = REPORT_PRESETS.find((p) => p.id === "all");
    expect(all?.off).toEqual([]);
    expect(all?.kindsOff).toEqual([]);
    const weather = REPORT_PRESETS.find((p) => p.id === "weather");
    expect(weather?.off).toEqual(["seismic", "volcanoes"]);
    expect(weather?.kindsOff).toEqual(["quake", "volcano"]);
    const geo = REPORT_PRESETS.find((p) => p.id === "geo");
    expect(geo?.kindsOff).toEqual(["alert"]);
  });

  it("recognises report kinds", () => {
    expect(REPORT_KINDS.map((k) => k.id)).toEqual(["alert", "quake", "volcano"]);
    expect(isReportKind("quake")).toBe(true);
    expect(isReportKind("weather")).toBe(false);
  });
});

describe("applyReportPrefs", () => {
  const deck = () => BROADCAST_REPORT_SLIDES.map((s) => ({ id: s.id }));

  it("is identity with no prefs", () => {
    expect(applyReportPrefs(deck(), [], []).map((s) => s.id)).toEqual([...REPORT_SLIDE_IDS]);
  });

  it("a weather-focus channel drops the geo slides", () => {
    const out = applyReportPrefs(deck(), ["seismic", "volcanoes"], []).map((s) => s.id);
    expect(out).toEqual(["detection", "hourly", "alerts", "about"]);
  });

  it("reorders by the ranking, keeping the rest natural", () => {
    const out = applyReportPrefs(deck(), [], ["seismic", "volcanoes"]).map((s) => s.id);
    expect(out).toEqual(["seismic", "volcanoes", "detection", "hourly", "alerts", "about"]);
  });
});

describe("mergeControlState report fields", () => {
  it("defaults empty", () => {
    expect(DEFAULT_CONTROL_STATE.reportOff).toEqual([]);
    expect(DEFAULT_CONTROL_STATE.reportOrder).toEqual([]);
    expect(DEFAULT_CONTROL_STATE.reportHoldMs).toBe(DEFAULT_REPORT_HOLD_MS);
  });

  it("accepts a positive reportHoldMs and rejects non-positive values", () => {
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { reportHoldMs: 12000 }).reportHoldMs).toBe(12000);
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { reportHoldMs: 0 }).reportHoldMs).toBe(
      DEFAULT_REPORT_HOLD_MS,
    );
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { reportHoldMs: "9000" as never }).reportHoldMs).toBe(
      DEFAULT_REPORT_HOLD_MS,
    );
  });

  it("filters invalid ids and dedupes", () => {
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, {
      reportOff: ["seismic", "seismic", "bogus"] as never,
      reportOrder: ["hourly", "nope"] as never,
      reportKindsOff: ["quake", "quake", "nope"] as never,
      reportHazardsOff: ["fire", "bogus"] as never,
      pointVarsOff: ["storm", "storm", "nope"] as never,
    });
    expect(merged.reportOff).toEqual(["seismic"]);
    expect(merged.reportOrder).toEqual(["hourly"]);
    expect(merged.reportKindsOff).toEqual(["quake"]);
    expect(merged.reportHazardsOff).toEqual(["fire"]);
    expect(merged.pointVarsOff).toEqual(["storm"]);
  });
});
