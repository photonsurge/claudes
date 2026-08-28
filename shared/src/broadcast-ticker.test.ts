import { TICKER_KINDS, TICKER_KIND_IDS, isTickerKind } from "./broadcast-ticker";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

describe("broadcast-ticker catalog", () => {
  it("has unique ids with labels and hints", () => {
    expect(new Set(TICKER_KIND_IDS).size).toBe(TICKER_KIND_IDS.length);
    for (const k of TICKER_KINDS) {
      expect(k.label).toBeTruthy();
      expect(k.hint).toBeTruthy();
    }
  });

  it("recognises catalog ids and rejects anything else", () => {
    expect(isTickerKind("quake")).toBe(true);
    expect(isTickerKind("ad")).toBe(true);
    expect(isTickerKind("nope")).toBe(false);
    expect(isTickerKind(null)).toBe(false);
    expect(isTickerKind(42)).toBe(false);
  });
});

describe("mergeControlState tickerKindsOff / tickerHazardsOff", () => {
  it("defaults to showing everything", () => {
    expect(DEFAULT_CONTROL_STATE.tickerKindsOff).toEqual([]);
    expect(DEFAULT_CONTROL_STATE.tickerHazardsOff).toEqual([]);
  });

  it("keeps only valid ids and dedupes", () => {
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, {
      tickerKindsOff: ["ad", "ad", "bogus", "track"] as never,
      tickerHazardsOff: ["heat", "heat", "nope", "fog"] as never,
    });
    expect(merged.tickerKindsOff.sort()).toEqual(["ad", "track"]);
    expect(merged.tickerHazardsOff.sort()).toEqual(["fog", "heat"]);
  });

  it("leaves the base lists untouched when the patch omits them", () => {
    const base = {
      ...DEFAULT_CONTROL_STATE,
      tickerKindsOff: ["quake" as const],
      tickerHazardsOff: ["fire" as const],
    };
    const merged = mergeControlState(base, { showWind: false });
    expect(merged.tickerKindsOff).toEqual(["quake"]);
    expect(merged.tickerHazardsOff).toEqual(["fire"]);
  });
});
