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

describe("rankFromMeteoalarmLevel", () => {
  it.each([
    [4, 4],
    [3, 3],
    [2, 2],
    [1, 0], // green = info
    ["3", 3],
    [undefined, 0],
  ] as const)("maps %s → %i", (input, expected) => {
    expect(rankFromMeteoalarmLevel(input as number)).toBe(expected);
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
