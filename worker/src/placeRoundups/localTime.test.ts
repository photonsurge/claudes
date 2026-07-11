import { placeOffsetHours, localHourFloat, isPlaceDue, TARGET_HOURS } from "./localTime";

type Bbox = [number, number, number, number];

const UK: Bbox = [-8, 49, 2, 61]; // centre ~-3°E → offset 0
const JAPAN: Bbox = [129, 31, 146, 46]; // centre ~137°E → offset +9
const CALIFORNIA: Bbox = [-124, 32, -114, 42]; // centre ~-119°E → offset -8

describe("placeOffsetHours", () => {
  it("maps centre longitude to a whole-hour offset", () => {
    expect(placeOffsetHours(UK)).toBe(0);
    expect(placeOffsetHours(JAPAN)).toBe(9);
    expect(placeOffsetHours(CALIFORNIA)).toBe(-8);
  });

  it("clamps to the real offset range", () => {
    expect(placeOffsetHours([179, 0, 179.5, 1])).toBeLessThanOrEqual(14);
    expect(placeOffsetHours([-179.5, 0, -179, 1])).toBeGreaterThanOrEqual(-12);
  });
});

describe("localHourFloat", () => {
  it("adds the offset and wraps past midnight", () => {
    const noonUtc = new Date("2026-07-11T12:00:00Z");
    expect(localHourFloat(noonUtc, 0)).toBeCloseTo(12);
    expect(localHourFloat(noonUtc, 9)).toBeCloseTo(21); // Japan: 21:00
  });

  it("wraps a negative-offset place into the previous day", () => {
    const earlyUtc = new Date("2026-07-11T04:00:00Z");
    expect(localHourFloat(earlyUtc, -8)).toBeCloseTo(20); // 04:00Z − 8h = 20:00 prev day
  });
});

describe("isPlaceDue", () => {
  // Defaults: TARGET_HOURS [6,18], catch-up 3h, min-gap 11h.
  it("uses the [6,18] targets by default", () => {
    expect(TARGET_HOURS).toEqual([6, 18]);
  });

  it("fires a never-generated place when local time hits its morning slot", () => {
    // Japan (offset +9): local 06:00 ⇒ 21:00Z the day before.
    const utc = new Date("2026-07-10T21:00:00Z");
    expect(localHourFloat(utc, 9)).toBeCloseTo(6);
    expect(isPlaceDue(utc, JAPAN, null)).toBe(true);
  });

  it("does NOT fire the same place at a non-target local hour", () => {
    // Japan local 12:00 ⇒ 03:00Z.
    const utc = new Date("2026-07-11T03:00:00Z");
    expect(isPlaceDue(utc, JAPAN, null)).toBe(false);
  });

  it("fires two different places at different UTC instants (their own mornings)", () => {
    // UK morning (offset 0): 06:00Z.
    const ukMorning = new Date("2026-07-11T06:00:00Z");
    expect(isPlaceDue(ukMorning, UK, null)).toBe(true);
    expect(isPlaceDue(ukMorning, JAPAN, null)).toBe(false); // Japan is at 15:00, not a slot
    // California morning (offset -8): 06:00 local ⇒ 14:00Z.
    const caMorning = new Date("2026-07-11T14:00:00Z");
    expect(isPlaceDue(caMorning, CALIFORNIA, null)).toBe(true);
    expect(isPlaceDue(caMorning, UK, null)).toBe(false); // UK is at 14:00, not a slot
  });

  it("skips a place that already generated within the min-gap window", () => {
    const utc = new Date("2026-07-11T06:00:00Z"); // UK morning slot
    const twoHoursAgo = new Date("2026-07-11T04:00:00Z");
    expect(isPlaceDue(utc, UK, twoHoursAgo)).toBe(false);
  });

  it("re-fires a place whose last round-up predates the min-gap", () => {
    const utc = new Date("2026-07-11T06:00:00Z"); // UK morning slot
    const twelveHoursAgo = new Date("2026-07-10T18:00:00Z"); // last evening slot
    expect(isPlaceDue(utc, UK, twelveHoursAgo)).toBe(true);
  });

  it("stays eligible through the catch-up window after the exact slot hour", () => {
    // UK 08:00Z = 2h past the 06:00 morning slot, still < 3h catch-up.
    const utc = new Date("2026-07-11T08:00:00Z");
    expect(isPlaceDue(utc, UK, null)).toBe(true);
    // 09:00Z = 3h past ⇒ window closed.
    const closed = new Date("2026-07-11T09:00:00Z");
    expect(isPlaceDue(closed, UK, null)).toBe(false);
  });
});
