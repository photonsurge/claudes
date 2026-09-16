import {
  BROADCAST_SLIDES,
  SLIDE_IDS,
  SLIDE_GROUP_LABELS,
  SLIDE_GROUP_ORDER,
  isSlideId,
  isPinnedSlide,
  applySlidePrefs,
  baseSlideId,
  SLIDE_RUNS_MIN,
  SLIDE_RUNS_MAX,
  SLIDE_HOLD_MIN_MS,
  SLIDE_HOLD_MAX_MS,
  DEFAULT_SLIDE_HOLD_MS,
  RUN_CEILING_MS,
} from "./broadcast-slides";
import { REPORT_HOLD_MIN_MS, REPORT_HOLD_MAX_MS, DEFAULT_REPORT_HOLD_MS } from "./broadcast-report";
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
    expect(isSlideId("nope")).toBe(false);
    expect(isSlideId(7)).toBe(false);
  });

  it("reads the catalog id out of a per-instance slide id", () => {
    expect(baseSlideId("topcities:paris")).toBe("topcities");
    expect(baseSlideId("volcano-cam:etna-1")).toBe("volcano-cam");
    expect(baseSlideId("topcities")).toBe("topcities");
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

  // Cards that used to page through their own items now air one slide per item,
  // named `<catalogId>:<instance>` — the channel still governs them through the
  // one catalog entry the operator sees.
  const cityDeck = () => [
    { id: "onair" },
    { id: "topcities" },
    { id: "topcities:paris" },
    { id: "topcities:lyon" },
    { id: "forecast" },
  ];

  it("hides every instance of a card through its catalog id", () => {
    expect(applySlidePrefs(cityDeck(), ["topcities"], []).map((s) => s.id)).toEqual(["onair", "forecast"]);
  });

  it("moves the whole run of instances together, in their natural order", () => {
    expect(applySlidePrefs(cityDeck(), [], ["forecast", "topcities"]).map((s) => s.id)).toEqual([
      "onair",
      "forecast",
      "topcities",
      "topcities:paris",
      "topcities:lyon",
    ]);
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

describe("dwell bounds (the *Minimum dwell* control on both decks)", () => {
  // The dwell is the FLOOR under the run pacing, so the top of the operator's
  // range is the deadlock breaker itself — a channel can park a slide for as
  // long as the deck will ever wait. Pinned here so the two can't drift apart.
  it("reaches the shared run ceiling on both decks", () => {
    expect(SLIDE_HOLD_MAX_MS).toBe(RUN_CEILING_MS);
    expect(REPORT_HOLD_MAX_MS).toBe(RUN_CEILING_MS);
  });

  it("keeps each deck's default inside its own range", () => {
    expect(SLIDE_HOLD_MIN_MS).toBeLessThan(SLIDE_HOLD_MAX_MS);
    expect(DEFAULT_SLIDE_HOLD_MS).toBeGreaterThanOrEqual(SLIDE_HOLD_MIN_MS);
    expect(DEFAULT_SLIDE_HOLD_MS).toBeLessThanOrEqual(SLIDE_HOLD_MAX_MS);
    expect(REPORT_HOLD_MIN_MS).toBeLessThan(REPORT_HOLD_MAX_MS);
    expect(DEFAULT_REPORT_HOLD_MS).toBeGreaterThanOrEqual(REPORT_HOLD_MIN_MS);
    expect(DEFAULT_REPORT_HOLD_MS).toBeLessThanOrEqual(REPORT_HOLD_MAX_MS);
  });
});

describe("runs through (the deck rotation control)", () => {
  it("defaults to one complete run per slide on both decks", () => {
    expect(DEFAULT_CONTROL_STATE.slideRuns).toBe(1);
    expect(DEFAULT_CONTROL_STATE.reportRuns).toBe(1);
  });

  it("clamps a patched run count into range and rounds it", () => {
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideRuns: 3 }).slideRuns).toBe(3);
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideRuns: 99 }).slideRuns).toBe(SLIDE_RUNS_MAX);
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideRuns: 0 }).slideRuns).toBe(SLIDE_RUNS_MIN);
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideRuns: 2.4 }).slideRuns).toBe(2);
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { reportRuns: 4 }).reportRuns).toBe(4);
  });

  it("keeps the channel's run count when the patch doesn't mention it", () => {
    const base = mergeControlState(DEFAULT_CONTROL_STATE, { slideRuns: 3, reportRuns: 2 });
    const next = mergeControlState(base, { slideHoldMs: 9000 });
    expect(next.slideRuns).toBe(3);
    expect(next.reportRuns).toBe(2);
  });

  it("survives junk from the wire", () => {
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { slideRuns: NaN as number }).slideRuns).toBe(1);
    expect(
      mergeControlState(DEFAULT_CONTROL_STATE, { reportRuns: "3" as unknown as number }).reportRuns,
    ).toBe(3);
  });
});
