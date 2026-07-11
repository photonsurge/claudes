import { buildPlacePrompt, generatePlaceNarrative, parsePlaceNarrative } from "./openrouter";
import type { iPlaceRoundupInputs } from "@photonsurge/shared/db/place-roundup-model";

const INPUTS: iPlaceRoundupInputs = {
  topCities: [
    { name: "London", cc: "gb", lat: 51.5, lng: -0.1, population: 8900000, isCapital: true, temp: 18, wind: 4, rain: 1, hi: 21, lo: 12 },
    { name: "Manchester", cc: "gb", lat: 53.5, lng: -2.2, population: 550000, temp: 16, wind: 6 },
  ],
  area: { stats: [{ variable: "temp", units: "°C", mean: 17, min: 11, max: 23 }], hazards: [] },
  alerts: [{ event: "Rain", severityRank: 2, hazard: "flood" }],
  volcanoes: [],
  tideGauges: [{ name: "Newlyn", latest: 2.3, distanceKm: 40 }],
  seismoStations: [],
};

const PLACE = { kind: "country" as const, name: "United Kingdom" };

describe("buildPlacePrompt", () => {
  it("embeds the place, cities and the capital instruction", () => {
    const prompt = buildPlacePrompt(PLACE, INPUTS);
    expect(prompt).toContain("United Kingdom");
    expect(prompt).toContain('"London"');
    expect(prompt).toContain("capital");
    expect(prompt).toContain("first update"); // no-prev branch
    expect(prompt).not.toContain("previousRoundUp");
  });

  it("includes the previous round-up and asks for continuity when given one", () => {
    const prev = {
      narrative: "Yesterday London basked under clear skies.",
      generatedAt: new Date("2026-07-01T00:00:00.000Z"),
      inputs: { ...INPUTS, alerts: [] },
    };
    const prompt = buildPlacePrompt(PLACE, INPUTS, prev as any);
    expect(prompt).toContain("previousRoundUp");
    expect(prompt).toContain("Yesterday London basked under clear skies.");
    expect(prompt).toContain("CHANGED since");
    expect(prompt).toContain('"alertsThen": 0');
  });

  it("treats a prev with empty narrative as no prev", () => {
    const prompt = buildPlacePrompt(PLACE, INPUTS, { narrative: "", generatedAt: new Date(), inputs: INPUTS } as any);
    expect(prompt).not.toContain("previousRoundUp");
    expect(prompt).toContain("first update");
  });

  it("asks for the four JSON sections", () => {
    const prompt = buildPlacePrompt(PLACE, INPUTS);
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"stateOfPlay"');
    expect(prompt).toContain('"cities"');
    expect(prompt).toContain('"advice"');
    expect(prompt).toContain("single country");
  });

  it("frames a region across its constituent countries", () => {
    const region = { kind: "region" as const, name: "Western Europe" };
    const prompt = buildPlacePrompt(region, { ...INPUTS, countries: ["United Kingdom", "France"] });
    expect(prompt).toContain("REGION spanning several countries");
    expect(prompt).toContain("United Kingdom, France");
  });
});

describe("parsePlaceNarrative", () => {
  it("splits a JSON object into the four sections", () => {
    const raw = JSON.stringify({
      summary: "Unsettled across the UK.",
      stateOfPlay: "Rain sweeps in from the west.",
      cities: [
        { name: "London", outlook: "Showers easing overnight, 12–18°C." },
        { name: "Manchester", outlook: "Wet and breezy." },
        { name: "Nowhere" }, // dropped — no outlook
      ],
      advice: "Carry a brolly; no weather warnings in force.",
    });
    const out = parsePlaceNarrative(raw);
    expect(out.summary).toBe("Unsettled across the UK.");
    expect(out.stateOfPlay).toBe("Rain sweeps in from the west.");
    expect(out.advice).toContain("brolly");
    expect(out.cityOutlook).toHaveLength(2);
    expect(out.cityOutlook[0]).toEqual({ name: "London", outlook: "Showers easing overnight, 12–18°C." });
    // narrative is composed from summary + state of play + advice for legacy consumers.
    expect(out.narrative).toContain("Unsettled across the UK.");
    expect(out.narrative).toContain("brolly");
  });

  it("tolerates a fenced JSON block", () => {
    const out = parsePlaceNarrative("```json\n{\"summary\":\"Calm.\",\"advice\":\"Enjoy it.\"}\n```");
    expect(out.summary).toBe("Calm.");
    expect(out.advice).toBe("Enjoy it.");
  });

  it("falls back to state-of-play when the reply is plain prose", () => {
    const out = parsePlaceNarrative("Just a paragraph, no JSON here.");
    expect(out.stateOfPlay).toBe("Just a paragraph, no JSON here.");
    expect(out.narrative).toBe("Just a paragraph, no JSON here.");
    expect(out.cityOutlook).toEqual([]);
  });

  it("returns empty sections for empty content", () => {
    const out = parsePlaceNarrative("");
    expect(out).toEqual({ summary: "", stateOfPlay: "", cityOutlook: [], advice: "", narrative: "" });
  });
});

describe("generatePlaceNarrative", () => {
  const OLD = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = OLD;
    jest.restoreAllMocks();
  });

  it("skips when no API key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await generatePlaceNarrative(PLACE, INPUTS);
    expect(res.status).toBe("skipped");
    expect(res.narrative).toBe("");
  });

  it("parses the completion content on success", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "openai/gpt-4o-mini",
        choices: [{ message: { content: "Wet across the UK today." } }],
        usage: { prompt_tokens: 200, completion_tokens: 60 },
      }),
    }) as unknown as typeof fetch;
    const res = await generatePlaceNarrative(PLACE, INPUTS);
    expect(res.status).toBe("ok");
    expect(res.narrative).toBe("Wet across the UK today.");
    expect(res.completionTokens).toBe(60);
  });

  it("returns the parsed sections on a JSON completion", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "openai/gpt-4o-mini",
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Bright and dry.",
                stateOfPlay: "High pressure holds.",
                cities: [{ name: "London", outlook: "Sunny, 21°C." }],
                advice: "Great day out; no alerts.",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 90 },
      }),
    }) as unknown as typeof fetch;
    const res = await generatePlaceNarrative(PLACE, INPUTS);
    expect(res.status).toBe("ok");
    expect(res.summary).toBe("Bright and dry.");
    expect(res.cityOutlook).toEqual([{ name: "London", outlook: "Sunny, 21°C." }]);
    expect(res.advice).toBe("Great day out; no alerts.");
  });
});
