import {
  rankFromCapSeverity,
  rankFromMeteoalarmLevel,
  rankFromMetOfficeColour,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
} from "./severity";

describe("rankFromCapSeverity", () => {
  it.each([
    ["Extreme", 4],
    ["Severe", 3],
    ["Moderate", 2],
    ["Minor", 1],
    ["Unknown", 0],
    [undefined, 0],
    ["nonsense", 0],
  ] as const)("maps %s → %i", (input, expected) => {
    expect(rankFromCapSeverity(input as string)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(rankFromCapSeverity("severe")).toBe(3);
  });
});

/**
 * This mapping was correct, tested, and called by NOTHING. The MeteoAlarm ingest
 * ranked on the CAP `severity` field instead, which contradicts the awareness
 * level: measured on the live feed, 58% of 2,681 active alerts disagreed, and
 * 1,540 green "nothing expected" advisories were on the globe as Minor warnings —
 * seven translucent shapes deep over the same ground, all of them clipped by the
 * dissolve for nothing.
 */
describe("rankFromMeteoalarmLevel", () => {
  it.each([
    [4, 4],
    [3, 3],
    [2, 2],
    [1, 0], // green = "no awareness required" — NOT a warning
    ["3", 3],
  ] as const)("maps %s → %i", (input, expected) => {
    expect(rankFromMeteoalarmLevel(input as number)).toBe(expected);
  });

  it("reads the level out of MeteoAlarm's real format", () => {
    // It arrives as "2; yellow; Moderate", not as a bare number.
    expect(rankFromMeteoalarmLevel("2; yellow; Moderate")).toBe(2);
    expect(rankFromMeteoalarmLevel("1; green; Minor")).toBe(0);
    expect(rankFromMeteoalarmLevel("4; red; Extreme")).toBe(4);
  });

  it("returns undefined — NOT 0 — when there is no level", () => {
    // 0 would silently mark a real warning as info on any alert that ships no
    // level. Undefined makes the caller fall back to CAP severity instead. This
    // asserted 0, back when nothing called the function.
    expect(rankFromMeteoalarmLevel(undefined)).toBeUndefined();
    expect(rankFromMeteoalarmLevel(null)).toBeUndefined();
    expect(rankFromMeteoalarmLevel("nonsense")).toBeUndefined();
    expect(rankFromMeteoalarmLevel(9)).toBeUndefined();
  });
});

describe("rankFromMetOfficeColour", () => {
  it.each([
    ["red", 4],
    ["amber", 3],
    ["yellow", 2],
    ["green", 0],
  ] as const)("maps %s → %i", (input, expected) => {
    expect(rankFromMetOfficeColour(input)).toBe(expected);
  });
});

describe("severity presentation tables", () => {
  it("has a colour and label for every rank 0–4", () => {
    for (let r = 0; r <= 4; r++) {
      expect(SEVERITY_COLORS[r as 0]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(SEVERITY_LABELS[r as 0]).toBeTruthy();
    }
  });
});
