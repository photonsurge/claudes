import { generateNarrative, buildPrompt, summaryTrend } from "./openrouter";
import type { AggregateResult } from "./aggregate";

const AGG: AggregateResult = {
  windowStart: "2026-07-01T11:00:00.000Z",
  windowEnd: "2026-07-01T12:00:00.000Z",
  stats: {
    alertsActive: 3,
    alertsBySeverity: { "4": 1, "2": 2 },
    alertsByHazard: { cyclone: 1, flood: 2 },
    alertsBySource: { gdacs: 1, wmo: 2 },
    quakeCount: 1,
    quakeMaxMag: 6.5,
    cyclones: 1,
    tracksNotable: 0,
    volcanoCount: 0,
    volcanoErupting: 0,
  },
  hotspots: [{ label: "East Asia", lng: 140, lat: 38, count: 2, maxSeverity: 4, hazards: ["cyclone"], kinds: ["alert"] }],
  topEvents: [{ kind: "quake", refId: "q1", title: "M6.5 — Off Japan", severity: 4, source: "usgs" }],
  sources: ["gdacs", "usgs", "wmo"],
};

describe("buildPrompt", () => {
  it("embeds the deterministic facts as JSON", () => {
    const prompt = buildPrompt(AGG, "hourly");
    expect(prompt).toContain("the past hour");
    expect(prompt).toContain('"alertsActive": 3');
    expect(prompt).toContain("East Asia");
  });

  it("embeds the trend when given one", () => {
    const prompt = buildPrompt(AGG, "hourly", { alertsActiveDelta: 5, quakeCountDelta: -1 });
    expect(prompt).toContain("trendSincePreviousRoundUp");
    expect(prompt).toContain('"alertsActiveDelta": 5');
  });

  it("feeds the previous narrative back for continuity when given one", () => {
    const cold = buildPrompt(AGG, "hourly");
    expect(cold).toContain("There is no previous round-up");
    const warm = buildPrompt(AGG, "hourly", null, { prevNarrative: "Last hour a cyclone formed off Japan." });
    expect(warm).toContain("previousRoundUp");
    expect(warm).toContain("Last hour a cyclone formed off Japan");
    expect(warm).toContain("what has CHANGED");
  });

  it("weaves area context in only when it carries signal", () => {
    const bare = buildPrompt(AGG, "hourly", null, { area: { areaWeather: [], placeHeadlines: [] } });
    expect(bare).not.toContain("areaConditions");
    const rich = buildPrompt(AGG, "hourly", null, {
      area: { areaWeather: [{ name: "Spain", kind: "country", hazards: ["Heat"], maxSeverity: 3, stats: [] }], placeHeadlines: [] },
    });
    expect(rich).toContain("areaConditions");
    expect(rich).toContain("Spain");
  });
});

describe("summaryTrend", () => {
  it("returns null with no prior round-up", () => {
    expect(summaryTrend(AGG.stats, null)).toBeNull();
  });

  it("diffs alertsActive/quakeCount against the previous round-up", () => {
    const prev = { ...AGG.stats, alertsActive: 1, quakeCount: 3 };
    expect(summaryTrend(AGG.stats, prev)).toEqual({ alertsActiveDelta: 2, quakeCountDelta: -2 });
  });
});

describe("generateNarrative", () => {
  const OLD = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = OLD;
    jest.restoreAllMocks();
  });

  it("skips when no API key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await generateNarrative(AGG, "hourly");
    expect(res.status).toBe("skipped");
    expect(res.narrative).toBe("");
  });

  it("returns an error on a non-2xx response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }) as unknown as typeof fetch;
    const res = await generateNarrative(AGG, "hourly");
    expect(res.status).toBe("error");
    expect(res.error).toContain("429");
  });

  it("parses the completion content + usage on success", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "openai/gpt-4o-mini",
        choices: [{ message: { content: "A cyclone threatens East Asia." } }],
        usage: { prompt_tokens: 120, completion_tokens: 45 },
      }),
    }) as unknown as typeof fetch;
    const res = await generateNarrative(AGG, "hourly");
    expect(res.status).toBe("ok");
    expect(res.narrative).toBe("A cyclone threatens East Asia.");
    expect(res.model).toBe("openai/gpt-4o-mini");
    expect(res.completionTokens).toBe(45);
  });

  it("flags an empty completion as an error", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    }) as unknown as typeof fetch;
    const res = await generateNarrative(AGG, "hourly");
    expect(res.status).toBe("error");
  });
});
