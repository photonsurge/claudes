import { TRIGGERABLE_JOBS, getTriggerableJob, jobLabel } from "./jobs";

describe("TRIGGERABLE_JOBS — allowlist integrity", () => {
  it("every job id is unique (the id is the enqueue key)", () => {
    const ids = TRIGGERABLE_JOBS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ids are url-safe kebab-case — they travel as POST params to the enqueue route", () => {
    for (const j of TRIGGERABLE_JOBS) {
      expect(j.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every job carries the full routing + display contract", () => {
    for (const j of TRIGGERABLE_JOBS) {
      // domain/type/event route the BullMQ job to worker/src/jobs/<type>.ts#<event>;
      // label/description/group drive the admin Jobs page. None may be blank.
      for (const field of ["id", "label", "description", "domain", "type", "event", "group"] as const) {
        expect(typeof j[field]).toBe("string");
        expect(j[field].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("preset data payloads survive a JSON round-trip (the admin route spreads them over the enqueue body)", () => {
    for (const j of TRIGGERABLE_JOBS) {
      if (!j.data) continue;
      expect(JSON.parse(JSON.stringify(j.data))).toEqual(j.data);
    }
  });

  it("priority, when set, is one of the three BullMQ tiers", () => {
    for (const j of TRIGGERABLE_JOBS) {
      if (j.priority !== undefined) expect([1, 5, 10]).toContain(j.priority);
    }
  });
});

describe("getTriggerableJob", () => {
  it("round-trips every listed id to its exact entry", () => {
    for (const j of TRIGGERABLE_JOBS) {
      expect(getTriggerableJob(j.id)).toBe(j);
    }
  });

  it("returns undefined for anything off the allowlist — the admin can only enqueue known jobs", () => {
    expect(getTriggerableJob("not-a-job")).toBeUndefined();
    expect(getTriggerableJob("")).toBeUndefined();
    // Exact match only: no case folding, no partials.
    expect(getTriggerableJob("Weather-Check")).toBeUndefined();
    expect(getTriggerableJob("weather")).toBeUndefined();
  });
});

describe("city seed tier picker", () => {
  it("ships all four GeoNames tiers, each targeting the one cities/seed handler with its tier preset", () => {
    const tiers: Record<string, string> = {
      "cities-seed-15k": "cities15000",
      "cities-seed-5k": "cities5000",
      "cities-seed-1k": "cities1000",
      "cities-seed-500": "cities500",
    };
    for (const [id, tier] of Object.entries(tiers)) {
      const job = getTriggerableJob(id);
      expect(job).toBeDefined();
      expect(job).toMatchObject({
        domain: "cities",
        type: "cities",
        event: "seed",
        group: "Cities",
        data: { tier },
      });
      // A reseed drops the cached Wikipedia enrichment — the description must warn.
      expect(job!.description).toMatch(/re-run enrichment/i);
    }
  });
});

describe("weather map refresh fleet", () => {
  const weatherMapJobs = TRIGGERABLE_JOBS.filter((j) => j.group === "Weather maps");

  it("every 'Weather maps' job routes to the weather domain", () => {
    for (const j of weatherMapJobs) expect(j.domain).toBe("weather");
  });

  it("the weather-typed refreshes each map to their own handler event", () => {
    const events = weatherMapJobs.filter((j) => j.type === "weather").map((j) => j.event);
    expect(events.length).toBeGreaterThan(1);
    expect(new Set(events).size).toBe(events.length);
  });
});

describe("cities-enrich-all", () => {
  it("is stoppable, runs at low priority, and presets minPopulation to 100k (guards the hardcoded-0 regression)", () => {
    const job = getTriggerableJob("cities-enrich-all");
    expect(job).toMatchObject({
      domain: "cities",
      type: "cities",
      event: "enrichWikiAll",
      priority: 10,
      stoppable: true,
      data: { minPopulation: 100_000 },
    });
  });
});

/**
 * Alerts registers a repeatable PER SOURCE, so /admin/queue showed four identical
 * `alerts.ingest` rows running at once — impossible to tell which feed was slow,
 * or whether one job was stuck in a loop. (It wasn't: the fan-out is deliberate,
 * so a slow WMO fetch can't block MeteoAlarm.) The source was in the job data all
 * along, just not in the label.
 */
describe("jobLabel", () => {
  it("qualifies a per-source job so two rows of it are distinguishable", () => {
    expect(jobLabel({ type: "alerts", event: "ingest", data: { source: "wmo" } })).toBe("alerts.ingest:wmo");
    expect(jobLabel({ type: "alerts", event: "ingest", data: { source: "meteoalarm" } })).toBe(
      "alerts.ingest:meteoalarm",
    );
  });

  it("leaves a job with no source alone", () => {
    expect(jobLabel({ type: "alerts", event: "reconcile", data: {} })).toBe("alerts.reconcile");
    expect(jobLabel({ type: "weather", event: "refreshMrms" })).toBe("weather.refreshMrms");
    expect(jobLabel({ type: "events", event: "watch", data: null })).toBe("events.watch");
  });

  it("returns null when it can't name the job, so callers keep their own fallback", () => {
    // BullMQ stores hashed repeatables with name "do" and no template — the caller
    // falls back to the scheduler id, which beats "unknown.unknown".
    expect(jobLabel(undefined)).toBeNull();
    expect(jobLabel({})).toBeNull();
    expect(jobLabel({ type: "alerts" })).toBeNull();
    expect(jobLabel({ event: "ingest" })).toBeNull();
  });
});
