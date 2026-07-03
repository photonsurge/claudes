/**
 * Drift guard for the admin "Cities" buttons: every cities job in the allowlist
 * must map to a real exported handler in this module, and each reseed button must
 * carry a valid GeoNames tier so the worker knows what to fetch.
 */
import * as cities from "./cities";
import { TRIGGERABLE_JOBS } from "@photonsurge/shared/jobs";
import { isGeonamesTier } from "@photonsurge/shared/cities/geonames";

const cityJobs = TRIGGERABLE_JOBS.filter((j) => j.type === "cities");

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
});
