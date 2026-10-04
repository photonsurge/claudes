import {
  DEFAULT_ROUNDUP_SETTINGS,
  ROUNDUP_ID_FOR_PERIOD,
  ROUNDUP_ID_FOR_PLACE,
  ROUNDUP_IDS,
  ROUNDUP_META,
  sanitizeRoundupSettings,
} from "./roundup-settings";

describe("DEFAULT_ROUNDUP_SETTINGS", () => {
  it("reproduces the previously hard-wired schedules, all enabled", () => {
    expect(DEFAULT_ROUNDUP_SETTINGS["global-hourly"]).toEqual({
      enabled: true,
      hours: Array.from({ length: 24 }, (_, h) => h),
    });
    expect(DEFAULT_ROUNDUP_SETTINGS["global-12h"]).toEqual({ enabled: true, hours: [0, 12] });
    expect(DEFAULT_ROUNDUP_SETTINGS["global-daily"]).toEqual({ enabled: true, hours: [0] });
    expect(DEFAULT_ROUNDUP_SETTINGS["place-country"]).toEqual({ enabled: true, hours: [6, 18] });
    expect(DEFAULT_ROUNDUP_SETTINGS["place-region"]).toEqual({ enabled: true, hours: [6, 18] });
  });
});

describe("ROUNDUP_META and lookups", () => {
  it("covers every id, and the lookups round-trip through the meta", () => {
    for (const id of ROUNDUP_IDS) expect(ROUNDUP_META[id].label).toBeTruthy();
    for (const [period, id] of Object.entries(ROUNDUP_ID_FOR_PERIOD)) {
      expect(ROUNDUP_META[id].period).toBe(period);
      expect(ROUNDUP_META[id].clock).toBe("utc");
    }
    for (const [kind, id] of Object.entries(ROUNDUP_ID_FOR_PLACE)) {
      expect(ROUNDUP_META[id].placeKind).toBe(kind);
      expect(ROUNDUP_META[id].clock).toBe("local");
    }
  });
});

describe("sanitizeRoundupSettings", () => {
  it("returns the defaults for junk input, as fresh copies", () => {
    for (const input of [undefined, null, 42, "x", []]) {
      const out = sanitizeRoundupSettings(input);
      expect(out).toEqual(DEFAULT_ROUNDUP_SETTINGS);
      for (const id of ROUNDUP_IDS) {
        expect(out[id]).not.toBe(DEFAULT_ROUNDUP_SETTINGS[id]);
        expect(out[id].hours).not.toBe(DEFAULT_ROUNDUP_SETTINGS[id].hours);
      }
    }
  });

  it("merges per id and drops unknown ids", () => {
    const out = sanitizeRoundupSettings({
      "global-daily": { enabled: false, hours: [9] },
      bogus: { enabled: true, hours: [1] },
    });
    expect(out["global-daily"]).toEqual({ enabled: false, hours: [9] });
    expect(out["global-12h"]).toEqual({ enabled: true, hours: [0, 12] });
    expect(out).not.toHaveProperty("bogus");
  });

  it("falls back per field when enabled or hours is missing/invalid", () => {
    const out = sanitizeRoundupSettings({
      "global-12h": { enabled: "yes", hours: [3] },
      "place-country": { enabled: false, hours: "6,18" },
      "place-region": { enabled: false },
    });
    expect(out["global-12h"]).toEqual({ enabled: true, hours: [3] });
    expect(out["place-country"]).toEqual({ enabled: false, hours: [6, 18] });
    expect(out["place-region"]).toEqual({ enabled: false, hours: [6, 18] });
  });

  it("filters hours to integers 0..23, de-duplicates (incl. -0) and sorts", () => {
    const out = sanitizeRoundupSettings({
      "global-daily": { enabled: true, hours: [18, 6, 6, -1, 24, 3.5, "4", null, NaN, -0, 0, 23] },
    });
    expect(out["global-daily"].hours).toEqual([0, 6, 18, 23]);
    expect(Object.is(out["global-daily"].hours[0], -0)).toBe(false);
  });

  it("keeps an empty hours array (no slots = never scheduled)", () => {
    expect(sanitizeRoundupSettings({ "global-hourly": { enabled: true, hours: [] } })["global-hourly"].hours).toEqual([]);
  });
});
