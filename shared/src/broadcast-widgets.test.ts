import {
  BROADCAST_WIDGETS,
  WIDGET_IDS,
  WIDGET_ZONE_LABELS,
  WIDGET_ZONE_ORDER,
  isWidgetId,
} from "./broadcast-widgets";
import { DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

describe("broadcast-widgets catalog", () => {
  it("has unique ids", () => {
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_IDS.length);
  });

  it("places every widget in a known, ordered zone", () => {
    for (const w of BROADCAST_WIDGETS) {
      expect(WIDGET_ZONE_ORDER).toContain(w.zone);
      expect(WIDGET_ZONE_LABELS[w.zone]).toBeTruthy();
      expect(w.label).toBeTruthy();
    }
  });

  it("orders zones without duplicates and only for real zones", () => {
    const zones = new Set(BROADCAST_WIDGETS.map((w) => w.zone));
    expect(new Set(WIDGET_ZONE_ORDER).size).toBe(WIDGET_ZONE_ORDER.length);
    for (const z of WIDGET_ZONE_ORDER) expect(zones.has(z)).toBe(true);
  });

  it("recognises catalog ids and rejects anything else", () => {
    expect(isWidgetId("worldReport")).toBe(true);
    expect(isWidgetId("nope")).toBe(false);
    expect(isWidgetId(null)).toBe(false);
    expect(isWidgetId(42)).toBe(false);
  });
});

describe("mergeControlState widgetsOff", () => {
  it("defaults to showing everything", () => {
    expect(DEFAULT_CONTROL_STATE.widgetsOff).toEqual([]);
  });

  it("keeps only valid ids and dedupes", () => {
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, {
      widgetsOff: ["seismic", "seismic", "bogus", "worldReport"] as never,
    });
    expect(merged.widgetsOff.sort()).toEqual(["seismic", "worldReport"]);
  });

  it("leaves the base list untouched when the patch omits it", () => {
    const base = { ...DEFAULT_CONTROL_STATE, widgetsOff: ["tsunami" as const] };
    expect(mergeControlState(base, { showWind: false }).widgetsOff).toEqual(["tsunami"]);
  });
});
