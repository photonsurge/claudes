/**
 * Drift guard: the admin "Jobs" allowlist (shared/jobs.ts) exposes a "Run now"
 * button per weather-map source. Each button enqueues `weather.<event>`, so every
 * event MUST have a real handler — and the button set must track the scheduled
 * ingest fleet (sourceSchedule.ts). This test fails loudly if a source is added
 * to the fleet without a button, or a button points at a non-existent event.
 */
import { TRIGGERABLE_JOBS } from "@photonsurge/shared/jobs";
import { WEATHER_SOURCE_JOBS } from "./sourceSchedule";

const weatherButtons = TRIGGERABLE_JOBS.filter((j) => j.type === "weather");
const fleetEvents = new Set(WEATHER_SOURCE_JOBS.map((j) => j.event));

describe("weather-map trigger buttons vs the ingest fleet", () => {
  it("every weather button (besides check/clearGfs) is a real scheduled ingest event", () => {
    // `check` polls for a newer run; `clearGfs` wipes stored runs; `reingest`
    // clears-then-checks to force a rebake — none is a per-source ingest, so all
    // are exempt from the fleet cross-check.
    const NON_INGEST = new Set(["check", "clearGfs", "reingest"]);
    const orphans = weatherButtons
      .filter((j) => !NON_INGEST.has(j.event))
      .filter((j) => !fleetEvents.has(j.event));
    expect(orphans.map((j) => j.id)).toEqual([]);
  });

  it("every scheduled ingest source has a trigger button", () => {
    const buttonEvents = new Set(weatherButtons.map((j) => j.event));
    const missing = WEATHER_SOURCE_JOBS.filter((j) => !buttonEvents.has(j.event));
    expect(missing.map((j) => j.event)).toEqual([]);
  });

  it("has no duplicate job ids across the whole catalog", () => {
    const ids = TRIGGERABLE_JOBS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every job carries a group for the admin UI", () => {
    expect(TRIGGERABLE_JOBS.every((j) => typeof j.group === "string" && j.group.length > 0)).toBe(true);
  });
});
