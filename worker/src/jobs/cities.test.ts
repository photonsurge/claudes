/**
 * Drift guard for the admin "Cities" buttons: every cities job in the allowlist
 * must map to a real exported handler in this module, and each reseed button must
 * carry a valid GeoNames tier so the worker knows what to fetch.
 */
import type { Job } from "bullmq";
import { TRIGGERABLE_JOBS } from "@photonsurge/shared/jobs";
import { isGeonamesTier } from "@photonsurge/shared/cities/geonames";

const findMock = jest.fn();
const updateByIDMock = jest.fn();

jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: jest.fn(async () => ({
    cities: { model: { find: findMock }, updateByID: updateByIDMock },
  })),
}));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({
  sendToQueue: jest.fn(),
  QUEUE_PRIORITY: { HIGH: 1, NORMAL: 5, LOW: 10 },
}));
jest.mock("@photonsurge/shared/utill/wikipedia", () => ({
  fetchWikiSummary: jest.fn(),
  fetchWikiGallery: jest.fn(async () => []),
  fetchWikiIntro: jest.fn(async () => undefined),
}));
jest.mock("@photonsurge/shared/utill/wikidata", () => ({
  fetchCityFacts: jest.fn(async () => ({})),
}));

import * as cities from "./cities";
import { fetchWikiSummary, fetchWikiGallery, fetchWikiIntro } from "@photonsurge/shared/utill/wikipedia";
import { fetchCityFacts } from "@photonsurge/shared/utill/wikidata";

const cityJobs = TRIGGERABLE_JOBS.filter((j) => j.type === "cities");

/** Chainable mongoose-query stub matching `.find(query).sort().limit()?.lean().exec()`
 *  — `.limit()` is only called when a positive limit is passed, so `.lean()` must be
 *  reachable both directly off `.sort()` and off `.limit()`. */
function stubCandidates(rows: unknown[]) {
  const leanable = { lean: () => ({ exec: async () => rows }) };
  findMock.mockReturnValue({ sort: () => ({ ...leanable, limit: () => leanable }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  stubCandidates([]);
});

describe("cities job registry ↔ handlers", () => {
  it("exposes the seed tiers + a wiki-enrich button", () => {
    expect(cityJobs.some((j) => j.event === "enrichWiki")).toBe(true);
    expect(cityJobs.find((j) => j.id === "cities-enrich-all")?.event).toBe("enrichWikiAll");
    expect(cityJobs.find((j) => j.id === "cities-enrich-all")?.priority).toBe(10);
    expect(cityJobs.filter((j) => j.event === "seed").length).toBeGreaterThanOrEqual(2);
  });

  it("the all-cities enrichment query does not require a population field", () => {
    const query = cities.wikiEnrichQuery(0, new Date("2026-01-01"), false);
    expect(query.$or).toBeUndefined();
    expect(query.wikiFetchedAt).toBeDefined();
  });

  it("every cities job event has an exported handler", () => {
    for (const j of cityJobs) {
      expect(typeof (cities as unknown as Record<string, unknown>)[j.event]).toBe("function");
    }
  });

  it("each reseed button carries a valid GeoNames tier", () => {
    for (const j of cityJobs.filter((j) => j.event === "seed")) {
      expect(isGeonamesTier(j.data?.tier)).toBe(true);
    }
  });

  it("the cities-enrich-all button presets a real population floor, not 'everything'", () => {
    expect(TRIGGERABLE_JOBS.find((j) => j.id === "cities-enrich-all")?.data?.minPopulation).toBe(100_000);
    expect(TRIGGERABLE_JOBS.find((j) => j.id === "cities-enrich-all")?.stoppable).toBe(true);
  });
});

describe("enrichWikiAll — population floor (the 'going OTT' fix)", () => {
  it("defaults to prominent cities/capitals, not the whole collection, when no override is given", async () => {
    await cities.enrichWikiAll({ data: { data: {} } } as unknown as Job);
    const query = findMock.mock.calls[0][0];
    expect(query.$or).toBeDefined();
  });

  it("still allows an explicit minPopulation: 0 override for power users", async () => {
    await cities.enrichWikiAll({ data: { data: { minPopulation: 0 } } } as unknown as Job);
    const query = findMock.mock.calls[0][0];
    expect(query.$or).toBeUndefined();
  });
});

describe("runWikiEnrich — richer enrichment (gallery + longer intro + Wikidata facts)", () => {
  it("persists photo, gallery, a longer intro, and Wikidata facts on a match", async () => {
    stubCandidates([{ id: "c1", name: "Paris", country: "France" }]);
    (fetchWikiSummary as jest.Mock).mockResolvedValue({
      title: "Paris",
      thumb: "https://example.test/thumb.jpg",
      photo: "https://example.test/full.jpg",
      extract: "short summary",
    });
    (fetchWikiGallery as jest.Mock).mockResolvedValue(["https://example.test/g1.jpg", "https://example.test/g2.jpg"]);
    (fetchWikiIntro as jest.Mock).mockResolvedValue("a much longer multi-paragraph intro");
    (fetchCityFacts as jest.Mock).mockResolvedValue({ foundedYear: 1200, areaKm2: 105, elevationM: 35 });

    await cities.enrichWiki({ data: { data: {} } } as unknown as Job);

    expect(updateByIDMock).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        wikiPhoto: "https://example.test/full.jpg",
        wikiGallery: ["https://example.test/g1.jpg", "https://example.test/g2.jpg"],
        wikiExtract: "a much longer multi-paragraph intro",
        foundedYear: 1200,
        areaKm2: 105,
        elevationM: 35,
      }),
    );
  });

  it("falls back to the short REST summary extract when the longer intro is unavailable", async () => {
    stubCandidates([{ id: "c1", name: "Paris", country: "France" }]);
    (fetchWikiSummary as jest.Mock).mockResolvedValue({ title: "Paris", extract: "short summary" });
    (fetchWikiIntro as jest.Mock).mockResolvedValue(undefined);

    await cities.enrichWiki({ data: { data: {} } } as unknown as Job);

    expect(updateByIDMock).toHaveBeenCalledWith("c1", expect.objectContaining({ wikiExtract: "short summary" }));
  });
});
