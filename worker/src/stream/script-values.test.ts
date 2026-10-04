// Title-code values stamped on a script (short-video plan §6.8).
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../director/script-generate", () => ({ sceneDirectorConfig: jest.fn(async () => ({ minAlertSeverity: 0, minQuakeMag: 0 })) }));
jest.mock("../director/script-scope", () => ({
  resolveScope: jest.fn(async () => ({ type: "country" })),
  scopeAlerts: jest.fn(async () => [{}, {}]),
  scopeQuakes: jest.fn(async () => [{}]),
  scopeVolcanoes: jest.fn(async () => []),
}));
jest.mock("../director/script-template", () => ({
  roundupText: (r: any) => [r.summary, r.stateOfPlay].filter(Boolean).join(" "),
}));

import type { AppDb } from "@photonsurge/shared/db/index";
import { firstSentence, formatDuration, kindOf, scriptValues } from "./script-values";

const NONE = { alerts: false, quakes: false, volcanoes: false };

describe("helpers", () => {
  it("formats a duration as YouTube shows one", () => {
    expect(formatDuration(105_000)).toBe("1:45");
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
  it("takes the first sentence", () => {
    expect(firstSentence("Storms sweep in. Then calm.")).toBe("Storms sweep in.");
    expect(firstSentence("No full stop")).toBe("No full stop");
    expect(firstSentence("")).toBe("");
  });
  it("names what the video is", () => {
    expect(kindOf(NONE)).toBe("round-up");
    expect(kindOf({ alerts: true, quakes: true, volcanoes: false })).toBe("alerts and earthquakes");
  });
});

describe("scriptValues", () => {
  const db = {
    countryRoundups: { latestForPlace: jest.fn(async () => ({ summary: "Wet and windy in the west. Drier east.", stateOfPlay: "More later.", generatedAt: new Date("2026-10-04T05:00:00Z") })) },
    regionRoundups: { latestForPlace: jest.fn(async () => null) },
  } as unknown as AppDb;

  it("stamps a country's name, id, flag, round-up, counts and top event", async () => {
    const v = await scriptValues(
      db,
      { scope: { type: "country", id: "uk" }, include: { ...NONE, alerts: true }, clips: [{ id: "a", target: "country:uk", durationMs: 1, label: { title: "UK" } }, { id: "b", target: "storm:met:1", durationMs: 1, label: { title: "Red wind warning" } }] },
      { formatName: "Country round-up", now: Date.parse("2026-10-04T06:00:00Z") },
    );
    expect(v).toEqual({
      kind: "alerts",
      places: "1",
      format: "Country round-up",
      place: "United Kingdom",
      placeId: "uk",
      flag: "🇬🇧",
      roundup: "Wet and windy in the west. Drier east. More later.",
      headline: "Wet and windy in the west.",
      asOf: "06:00",
      alerts: "2",
      quakes: "1",
      volcanoes: "0",
      top: "Red wind warning",
    });
    expect((db.countryRoundups.latestForPlace as jest.Mock)).toHaveBeenCalledWith("gb"); // keyed by ISO
  });

  it("counts the globe's event clips instead of scanning the planet; a missing round-up leaves values out", async () => {
    const v = await scriptValues(db, {
      scope: { type: "globe" },
      include: NONE,
      clips: [{ id: "q", target: "quake:us1", durationMs: 1, label: { title: "M6" } }],
    });
    expect(v).toMatchObject({ place: "World", placeId: "world", kind: "round-up", alerts: "0", quakes: "1", volcanoes: "0", top: "M6" });
    expect(v.headline).toBeUndefined();
  });
});
