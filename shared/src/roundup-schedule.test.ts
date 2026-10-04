import {
  SLOT_CATCHUP_HOURS,
  bboxCenterLng,
  currentSlotStart,
  isRoundupDue,
  maxSlotGapHours,
  nextSlotStart,
  placeOffsetHours,
  roundupStaleAfterMs,
} from "./roundup-schedule";
import { DEFAULT_ROUNDUP_SETTINGS } from "./roundup-settings";

const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const HOUR = 3_600_000;

describe("currentSlotStart", () => {
  it("returns null with no slots", () => {
    expect(currentSlotStart(at("2026-10-04T10:00:00Z"), [])).toBeNull();
  });

  it("finds the latest UTC slot at-or-before now (inclusive)", () => {
    expect(iso(currentSlotStart(at("2026-10-04T12:00:00Z"), [0, 12]))).toBe("2026-10-04T12:00:00.000Z");
    expect(iso(currentSlotStart(at("2026-10-04T11:59:59Z"), [0, 12]))).toBe("2026-10-04T00:00:00.000Z");
  });

  it("looks back across midnight", () => {
    expect(iso(currentSlotStart(at("2026-10-04T03:00:00Z"), [6, 18]))).toBe("2026-10-03T18:00:00.000Z");
  });

  it("honours a positive offset (UTC+9: 06:00 local = 21:00Z the day before)", () => {
    // 22:30Z on the 3rd = 07:30 local on the 4th → slot 06:00 local on the 4th.
    expect(iso(currentSlotStart(at("2026-10-03T22:30:00Z"), [6, 18], 9))).toBe("2026-10-03T21:00:00.000Z");
    // 20:30Z on the 3rd = 05:30 local on the 4th → yesterday's 18:00 local = 09:00Z on the 3rd.
    expect(iso(currentSlotStart(at("2026-10-03T20:30:00Z"), [6, 18], 9))).toBe("2026-10-03T09:00:00.000Z");
  });

  it("honours a negative offset (UTC-5: 18:00 local = 23:00Z)", () => {
    // 02:00Z on the 4th = 21:00 local on the 3rd → slot 18:00 local on the 3rd.
    expect(iso(currentSlotStart(at("2026-10-04T02:00:00Z"), [6, 18], -5))).toBe("2026-10-03T23:00:00.000Z");
  });

  it("treats -0 like 0", () => {
    expect(iso(currentSlotStart(at("2026-10-04T13:00:00Z"), [12], -0))).toBe("2026-10-04T12:00:00.000Z");
  });

  it("handles the extreme offsets", () => {
    expect(iso(currentSlotStart(at("2026-10-04T00:00:00Z"), [6], 14))).toBe("2026-10-03T16:00:00.000Z");
    expect(iso(currentSlotStart(at("2026-10-04T00:00:00Z"), [6], -12))).toBe("2026-10-03T18:00:00.000Z");
  });
});

describe("nextSlotStart", () => {
  it("returns null with no slots", () => {
    expect(nextSlotStart(at("2026-10-04T10:00:00Z"), [])).toBeNull();
  });

  it("is strictly after now", () => {
    expect(iso(nextSlotStart(at("2026-10-04T12:00:00Z"), [0, 12]))).toBe("2026-10-05T00:00:00.000Z");
    expect(iso(nextSlotStart(at("2026-10-04T11:00:00Z"), [0, 12]))).toBe("2026-10-04T12:00:00.000Z");
  });

  it("rolls over midnight, with offsets", () => {
    expect(iso(nextSlotStart(at("2026-10-04T19:00:00Z"), [6, 18]))).toBe("2026-10-05T06:00:00.000Z");
    // UTC+9: 10:00Z = 19:00 local → next is 06:00 local tomorrow = 21:00Z today.
    expect(iso(nextSlotStart(at("2026-10-04T10:00:00Z"), [6, 18], 9))).toBe("2026-10-04T21:00:00.000Z");
    // UTC-5: 12:00Z = 07:00 local → next is 18:00 local = 23:00Z.
    expect(iso(nextSlotStart(at("2026-10-04T12:00:00Z"), [6, 18], -5))).toBe("2026-10-04T23:00:00.000Z");
  });
});

describe("isRoundupDue", () => {
  const on = { enabled: true, hours: [6, 18] };

  it("is due inside a fresh slot that was never generated", () => {
    expect(isRoundupDue(at("2026-10-04T06:05:00Z"), on, null)).toBe(true);
  });

  it("is due when the last generation predates the slot", () => {
    expect(isRoundupDue(at("2026-10-04T06:05:00Z"), on, at("2026-10-03T18:01:00Z"))).toBe(true);
  });

  it("is NOT due once the slot was served (including a manual run inside it)", () => {
    expect(isRoundupDue(at("2026-10-04T07:00:00Z"), on, at("2026-10-04T06:20:00Z"))).toBe(false);
    expect(isRoundupDue(at("2026-10-04T07:00:00Z"), on, at("2026-10-04T06:00:00Z"))).toBe(false);
  });

  it("stops catching up SLOT_CATCHUP_HOURS after the slot began", () => {
    const justInside = new Date(Date.parse("2026-10-04T06:00:00Z") + SLOT_CATCHUP_HOURS * HOUR - 1);
    const expired = new Date(Date.parse("2026-10-04T06:00:00Z") + SLOT_CATCHUP_HOURS * HOUR);
    expect(isRoundupDue(justInside, on, null)).toBe(true);
    expect(isRoundupDue(expired, on, null)).toBe(false);
  });

  it("is never due when disabled or slot-less", () => {
    expect(isRoundupDue(at("2026-10-04T06:05:00Z"), { enabled: false, hours: [6, 18] }, null)).toBe(false);
    expect(isRoundupDue(at("2026-10-04T06:05:00Z"), { enabled: true, hours: [] }, null)).toBe(false);
  });

  it("does not let an earlier slot's run block a third slot in the day", () => {
    const three = { enabled: true, hours: [6, 12, 18] };
    expect(isRoundupDue(at("2026-10-04T18:10:00Z"), three, at("2026-10-04T12:30:00Z"))).toBe(true);
  });

  it("evaluates local slots via the offset", () => {
    // UTC+9, 21:30Z = 06:30 local → the 06:00 local slot (21:00Z).
    expect(isRoundupDue(at("2026-10-03T21:30:00Z"), on, at("2026-10-03T09:10:00Z"), 9)).toBe(true);
    expect(isRoundupDue(at("2026-10-03T21:30:00Z"), on, at("2026-10-03T21:05:00Z"), 9)).toBe(false);
  });
});

describe("maxSlotGapHours", () => {
  it("measures the longest gap round the clock", () => {
    expect(maxSlotGapHours([])).toBe(24);
    expect(maxSlotGapHours([0])).toBe(24);
    expect(maxSlotGapHours([7])).toBe(24);
    expect(maxSlotGapHours(Array.from({ length: 24 }, (_, h) => h))).toBe(1);
    expect(maxSlotGapHours([0, 12])).toBe(12);
    expect(maxSlotGapHours([6, 18])).toBe(12);
    expect(maxSlotGapHours([6, 9])).toBe(21); // wrap 9 → 6 next day
    expect(maxSlotGapHours([18, 6, 6])).toBe(12); // unsorted/dupes tolerated
  });
});

describe("roundupStaleAfterMs", () => {
  const FALLBACK = 123;

  it("equals the old constants at default settings", () => {
    expect(roundupStaleAfterMs(DEFAULT_ROUNDUP_SETTINGS["global-hourly"], FALLBACK)).toBe(3 * HOUR);
    expect(roundupStaleAfterMs(DEFAULT_ROUNDUP_SETTINGS["global-12h"], FALLBACK)).toBe(36 * HOUR);
    expect(roundupStaleAfterMs(DEFAULT_ROUNDUP_SETTINGS["global-daily"], FALLBACK)).toBe(72 * HOUR);
  });

  it("uses the fallback when disabled or slot-less", () => {
    expect(roundupStaleAfterMs({ enabled: false, hours: [0, 12] }, FALLBACK)).toBe(FALLBACK);
    expect(roundupStaleAfterMs({ enabled: true, hours: [] }, FALLBACK)).toBe(FALLBACK);
  });
});

describe("placeOffsetHours", () => {
  it("maps the box's centre longitude to a whole-hour offset", () => {
    expect(placeOffsetHours([-8, 49, 2, 61])).toBe(0); // UK
    expect(placeOffsetHours([129, 31, 146, 46])).toBe(9); // Japan
    expect(placeOffsetHours([-124, 32, -114, 42])).toBe(-8); // California
    expect(Object.is(placeOffsetHours([-1, 0, 0.5, 1]), 0)).toBe(true); // never -0
  });

  it("clamps to the real offset range and handles boxes across ±180", () => {
    expect(placeOffsetHours([179, 0, 179.5, 1])).toBeLessThanOrEqual(14);
    expect(placeOffsetHours([-179.5, 0, -179, 1])).toBeGreaterThanOrEqual(-12);
    expect(bboxCenterLng([170, -50, -170, -30])).toBe(180); // wraps: centre on the antimeridian
    expect(bboxCenterLng([160, -50, -160, -30])).toBe(180);
  });

  it("phases a place's slots: Europe's 06:00 local is 05:00 UTC", () => {
    expect(nextSlotStart(at("2026-10-04T02:00:00Z"), [6, 18], placeOffsetHours([-10, 35, 30, 70]))?.toISOString()).toBe(
      "2026-10-04T05:00:00.000Z",
    );
  });
});
