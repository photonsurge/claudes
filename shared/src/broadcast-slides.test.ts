import {
  BROADCAST_SLIDES,
  SLIDE_IDS,
  SLIDE_GROUP_LABELS,
  SLIDE_GROUP_ORDER,
  isSlideId,
  isPinnedSlide,
  applySlidePrefs,
} from "./broadcast-slides";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

describe("broadcast-slides catalog", () => {
  it("has unique ids in known, ordered groups", () => {
    expect(new Set(SLIDE_IDS).size).toBe(SLIDE_IDS.length);
    for (const s of BROADCAST_SLIDES) {
      expect(SLIDE_GROUP_ORDER).toContain(s.group);
      expect(SLIDE_GROUP_LABELS[s.group]).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });

  it("pins exactly the on-air lede", () => {
    expect(isPinnedSlide("onair")).toBe(true);
    expect(isPinnedSlide("forecast")).toBe(false);
    expect(BROADCAST_SLIDES.filter((s) => s.pinned).map((s) => s.id)).toEqual(["onair"]);
  });

  it("recognises catalog ids and rejects anything else", () => {
    expect(isSlideId("forecast")).toBe(true);
    expect(isSlideId("subglobe")).toBe(true);
    expect(isSlideId("nope")).toBe(false);
    expect(isSlideId(7)).toBe(false);
  });
});

describe("applySlidePrefs", () => {
  const deck = () => [
    { id: "onair" },
    { id: "topcities" },
    { id: "forecast" },
    { id: "history" },
    { id: "region-country-fr" }, // dynamic id, not in catalog
  ];

  it("is identity with no prefs (natural order, onair first)", () => {
    expect(applySlidePrefs(deck(), [], []).map((s) => s.id)).toEqual([
      "onair",
      "topcities",
      "forecast",
      "history",
      "region-country-fr",
    ]);
  });

  it("drops hidden slides but never the pinned lede", () => {
    const out = applySlidePrefs(deck(), ["forecast", "onair"], []).map((s) => s.id);
    expect(out).toContain("onair"); // pinned — kept despite being listed
    expect(out).not.toContain("forecast");
  });

  it("ranks listed ids after the pinned lede, keeps the rest in natural order", () => {
    const out = applySlidePrefs(deck(), [], ["history", "forecast"]).map((s) => s.id);
    expect(out).toEqual(["onair", "history", "forecast", "topcities", "region-country-fr"]);
  });
});

describe("mergeControlState slide + theme fields", () => {
  it("defaults are empty / natural", () => {
    expect(DEFAULT_CONTROL_STATE.slidesOff).toEqual([]);
    expect(DEFAULT_CONTROL_STATE.slideOrder).toEqual([]);
    expect(DEFAULT_CONTROL_STATE.slideHoldMs).toBe(16000);
    expect(DEFAULT_CONTROL_STATE.themeOverrides).toEqual({});
  });

  it("filters invalid slide ids and dedupes order", () => {
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, {
      slidesOff: ["depth", "bogus", "depth"] as never,
      slideOrder: ["forecast", "forecast", "nope"] as never,
    });
    expect(merged.slidesOff).toEqual(["depth"]);
    expect(merged.slideOrder).toEqual(["forecast"]);
  });

  it("rejects a non-positive hold time, keeping the base", () => {
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideHoldMs: 0 }).slideHoldMs).toBe(16000);
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideHoldMs: 9000 }).slideHoldMs).toBe(9000);
  });

  it("sanitises themeOverrides to known string keys and replaces on present", () => {
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, {
      themeOverrides: { name: "WIND", accent: "#0ff", bogus: 5, tickerTitle: "" } as never,
    });
    expect(merged.themeOverrides).toEqual({ name: "WIND", accent: "#0ff", tickerTitle: "" });
  });

  it("keeps base themeOverrides when the patch omits the key", () => {
    const base = { ...DEFAULT_CONTROL_STATE, themeOverrides: { name: "KEEP" } };
    expect(mergeControlState(base, { showWind: false }).themeOverrides).toEqual({ name: "KEEP" });
  });
});
