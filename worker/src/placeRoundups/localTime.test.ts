import { DEFAULT_ROUNDUP_SETTINGS, type RoundupSetting } from "@photonsurge/shared/roundup-settings";
import { placeOffsetHours, isPlaceDue } from "./localTime";

type Bbox = [number, number, number, number];

const UK: Bbox = [-8, 49, 2, 61]; // centre ~-3°E → offset 0
const JAPAN: Bbox = [129, 31, 146, 46]; // centre ~137°E → offset +9
const CALIFORNIA: Bbox = [-124, 32, -114, 42]; // centre ~-119°E → offset -8

const DEFAULT = DEFAULT_ROUNDUP_SETTINGS["place-country"]; // enabled, [6, 18] local
const slots = (hours: number[], enabled = true): RoundupSetting => ({ enabled, hours });

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

describe("isPlaceDue", () => {
  it("defaults to the 06:00 + 18:00 local slots", () => {
    expect(DEFAULT).toEqual({ enabled: true, hours: [6, 18] });
  });

  it("fires a never-generated place when local time hits its morning slot", () => {
    // Japan (offset +9): local 06:00 ⇒ 21:00Z the day before.
    expect(isPlaceDue(new Date("2026-07-10T21:00:00Z"), JAPAN, null, DEFAULT)).toBe(true);
  });

  it("does NOT fire the same place at a non-slot local hour", () => {
    // Japan local 12:00 ⇒ 03:00Z.
    expect(isPlaceDue(new Date("2026-07-11T03:00:00Z"), JAPAN, null, DEFAULT)).toBe(false);
  });

  it("fires two different places at different UTC instants (their own mornings)", () => {
    const ukMorning = new Date("2026-07-11T06:00:00Z");
    expect(isPlaceDue(ukMorning, UK, null, DEFAULT)).toBe(true);
    expect(isPlaceDue(ukMorning, JAPAN, null, DEFAULT)).toBe(false); // Japan is at 15:00
    // California morning (offset -8): 06:00 local ⇒ 14:00Z.
    const caMorning = new Date("2026-07-11T14:00:00Z");
    expect(isPlaceDue(caMorning, CALIFORNIA, null, DEFAULT)).toBe(true);
    expect(isPlaceDue(caMorning, UK, null, DEFAULT)).toBe(false); // UK is at 14:00
  });

  it("skips a place whose current slot is already served (e.g. a manual run at 06:20)", () => {
    const utc = new Date("2026-07-11T07:00:00Z");
    expect(isPlaceDue(utc, UK, new Date("2026-07-11T06:20:00Z"), DEFAULT)).toBe(false);
  });

  it("fires when the last round-up predates the current slot", () => {
    const utc = new Date("2026-07-11T06:00:00Z");
    expect(isPlaceDue(utc, UK, new Date("2026-07-10T18:05:00Z"), DEFAULT)).toBe(true);
    // Even one written just before the slot began doesn't serve it.
    expect(isPlaceDue(utc, UK, new Date("2026-07-11T05:59:00Z"), DEFAULT)).toBe(true);
  });

  it("stays eligible through the catch-up window after the slot hour, then closes", () => {
    expect(isPlaceDue(new Date("2026-07-11T08:00:00Z"), UK, null, DEFAULT)).toBe(true); // 2h in
    expect(isPlaceDue(new Date("2026-07-11T09:00:00Z"), UK, null, DEFAULT)).toBe(false); // 3h ⇒ closed
  });

  it("follows a moved slot", () => {
    const moved = slots([9, 21]);
    expect(isPlaceDue(new Date("2026-07-11T06:00:00Z"), UK, null, moved)).toBe(false); // old slot
    expect(isPlaceDue(new Date("2026-07-11T09:30:00Z"), UK, null, moved)).toBe(true);
    // Japan local 09:00 ⇒ 00:00Z.
    expect(isPlaceDue(new Date("2026-07-11T00:10:00Z"), JAPAN, null, moved)).toBe(true);
  });

  it("serves a third slot in a day only a few hours after the previous one", () => {
    // The old 11h minimum gap would have blocked 12:00 after a 06:00 run.
    const three = slots([6, 12, 18]);
    const morningRun = new Date("2026-07-11T06:15:00Z");
    expect(isPlaceDue(new Date("2026-07-11T12:00:00Z"), UK, morningRun, three)).toBe(true);
    expect(isPlaceDue(new Date("2026-07-11T10:00:00Z"), UK, morningRun, three)).toBe(false); // 06 served, 12 not begun
  });

  it("never fires when the round-up kind is disabled or has no slots", () => {
    const utc = new Date("2026-07-11T06:00:00Z");
    expect(isPlaceDue(utc, UK, null, slots([6, 18], false))).toBe(false);
    expect(isPlaceDue(utc, UK, null, slots([]))).toBe(false);
  });
});
