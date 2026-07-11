import { build12hRollupPrompt } from "./rollup";
import type { AggregateResult } from "./aggregate";
import type { iEventSummaryModel } from "@photonsurge/shared/db/event-summary-model";

const hourly = (over: Partial<iEventSummaryModel>): iEventSummaryModel =>
  ({
    id: "h",
    _id: "h",
    period: "hourly",
    windowStart: "2026-07-11T10:00:00.000Z",
    windowEnd: "2026-07-11T11:00:00.000Z",
    generatedAt: new Date("2026-07-11T11:00:00.000Z"),
    stats: {
      alertsActive: 5,
      alertsBySeverity: {},
      alertsByHazard: {},
      alertsBySource: {},
      quakeCount: 2,
      quakeMaxMag: 5.1,
      cyclones: 1,
      tracksNotable: 0,
      volcanoCount: 0,
      volcanoErupting: 0,
    },
    hotspots: [],
    topEvents: [],
    narrative: "An hourly line.",
    narrativeStatus: "ok",
    sources: [],
    ...over,
  }) as iEventSummaryModel;

const CURRENT: AggregateResult = {
  windowStart: "2026-07-11T11:00:00.000Z",
  windowEnd: "2026-07-11T12:00:00.000Z",
  stats: {
    alertsActive: 9,
    alertsBySeverity: {},
    alertsByHazard: {},
    alertsBySource: {},
    quakeCount: 1,
    quakeMaxMag: 6.2,
    cyclones: 2,
    tracksNotable: 0,
    volcanoCount: 0,
    volcanoErupting: 0,
  },
  hotspots: [{ label: "East Asia", lng: 140, lat: 38, count: 3, maxSeverity: 4, hazards: ["cyclone"], kinds: ["alert"] }],
  topEvents: [],
  sources: ["gdacs"],
};

describe("build12hRollupPrompt", () => {
  it("orders hourly digests oldest-first and includes the current snapshot", () => {
    const newest = hourly({ windowEnd: "2026-07-11T11:00:00.000Z", narrative: "Newest hour." });
    const oldest = hourly({ windowEnd: "2026-07-11T00:00:00.000Z", narrative: "Oldest hour." });
    // Repo returns newest-first; the builder must reverse to oldest-first.
    const prompt = build12hRollupPrompt([newest, oldest], CURRENT);
    const facts = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1));
    expect(facts.hourlyRoundUps[0].narrative).toBe("Oldest hour.");
    expect(facts.hourlyRoundUps[1].narrative).toBe("Newest hour.");
    expect(facts.currentSnapshot.stats.alertsActive).toBe(9);
    expect(prompt).toContain("past 12 hours");
    expect(prompt).toContain("Synthesise the ARC");
  });

  it("weaves in area + previous-round-up guidance only when present", () => {
    const bare = build12hRollupPrompt([hourly({})], CURRENT);
    expect(bare).not.toContain("previousRoundUp");
    expect(bare).not.toContain("areaConditions");

    const rich = build12hRollupPrompt([hourly({})], CURRENT, {
      area: { areaWeather: [{ name: "Spain", kind: "country", hazards: ["Heat"], maxSeverity: 3, stats: [] }], placeHeadlines: [] },
      prevNarrative: "Twelve hours ago the storm was building.",
    });
    expect(rich).toContain("areaConditions");
    expect(rich).toContain("previousRoundUp");
    expect(rich).toContain("Spain");
  });
});
