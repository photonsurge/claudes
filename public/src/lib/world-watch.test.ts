/**
 * scopeReportInputs — the per-channel report content filter that drops excluded
 * KINDS (alert/quake/volcano) and, for alerts, excluded HAZARDS, before the grid
 * summary and feed are built. Pure; the alert hazard classifier is injected.
 */
import { scopeReportInputs } from "./world-watch";

type A = { id: string; hazard: string };
const alerts: A[] = [
  { id: "a1", hazard: "rain" },
  { id: "a2", hazard: "fire" },
  { id: "a3", hazard: "flood" },
];
const quakes = [{ id: "q1" }];
const volcanoes = [{ id: "v1" }];
const hazardOf = (a: A) => a.hazard;

describe("scopeReportInputs", () => {
  it("passes everything through with no filter", () => {
    const out = scopeReportInputs(alerts, quakes, volcanoes, { hazardOf });
    expect(out.alerts).toHaveLength(3);
    expect(out.quakes).toHaveLength(1);
    expect(out.volcanoes).toHaveLength(1);
  });

  it("a seismic channel drops alerts entirely (keeps quakes + volcanoes)", () => {
    const out = scopeReportInputs(alerts, quakes, volcanoes, { kindsOff: ["alert"], hazardOf });
    expect(out.alerts).toEqual([]);
    expect(out.quakes).toHaveLength(1);
    expect(out.volcanoes).toHaveLength(1);
  });

  it("a weather channel drops quakes + volcanoes", () => {
    const out = scopeReportInputs(alerts, quakes, volcanoes, { kindsOff: ["quake", "volcano"], hazardOf });
    expect(out.alerts).toHaveLength(3);
    expect(out.quakes).toEqual([]);
    expect(out.volcanoes).toEqual([]);
  });

  it("filters alerts by hazard (a no-fire channel drops fire alerts)", () => {
    const out = scopeReportInputs(alerts, quakes, volcanoes, { hazardsOff: ["fire"], hazardOf });
    expect(out.alerts.map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("skips hazard filtering when the alert kind is already off", () => {
    const out = scopeReportInputs(alerts, quakes, volcanoes, {
      kindsOff: ["alert"],
      hazardsOff: ["fire"],
      hazardOf,
    });
    expect(out.alerts).toEqual([]);
  });
});
