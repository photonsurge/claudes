import {
  BROADCAST_REPORT_SLIDES,
  REPORT_SLIDE_IDS,
  REPORT_PRESETS,
  isReportSlideId,
  applyReportPrefs,
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

  it("presets only reference real ids; 'Everything' hides nothing", () => {
    for (const p of REPORT_PRESETS) for (const id of p.off) expect(isReportSlideId(id)).toBe(true);
    expect(REPORT_PRESETS.find((p) => p.id === "all")?.off).toEqual([]);
    expect(REPORT_PRESETS.find((p) => p.id === "weather")?.off).toEqual(["seismic", "volcanoes"]);
    expect(REPORT_PRESETS.find((p) => p.id === "geo")?.off).toEqual(["hourly", "alerts"]);
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
  });

  it("filters invalid ids and dedupes", () => {
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, {
      reportOff: ["seismic", "seismic", "bogus"] as never,
      reportOrder: ["hourly", "nope"] as never,
    });
    expect(merged.reportOff).toEqual(["seismic"]);
    expect(merged.reportOrder).toEqual(["hourly"]);
  });
});
