/**
 * Drift guard for the admin "Tides" buttons: every tides job in the allowlist
 * must map to a real exported handler in this module.
 */
import * as tides from "./tides";
import { TRIGGERABLE_JOBS } from "@photonsurge/shared/jobs";

const tideJobs = TRIGGERABLE_JOBS.filter((j) => j.type === "tides");

describe("tides job registry ↔ handlers", () => {
  it("exposes a station-refresh + a snapshot button", () => {
    expect(tideJobs.some((j) => j.event === "refreshStations")).toBe(true);
    expect(tideJobs.some((j) => j.event === "snapshotTides")).toBe(true);
  });

  it("every tides job event has an exported handler", () => {
    for (const j of tideJobs) {
      expect(typeof (tides as unknown as Record<string, unknown>)[j.event]).toBe("function");
    }
  });
});
