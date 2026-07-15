import { alertSnapshotBbox, selectSnapshotTargets, hourSlotOf, viewForAlert } from "./snapshot-select";
import type { AlertGeometry, iAlertModel } from "@photonsurge/shared/db/alert-model";

/** An alert carrying just the hazard wording the view picker reads. */
const worded = (event: string, headline = ""): iAlertModel =>
  ({ info: [{ event, headline }] }) as unknown as iAlertModel;

const box = (w: number, s: number, span = 2): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[w, s], [w + span, s], [w + span, s + span], [w, s + span], [w, s]]],
});

const alert = (geometry: AlertGeometry | null, id = "a"): iAlertModel =>
  ({
    id,
    source: "wmo",
    identifier: id,
    info: [{ area: [{ areaDesc: "", geometry, geocodes: [] }] }],
  }) as unknown as iAlertModel;

describe("viewForAlert", () => {
  it("picks the land-temperature raster for heat hazards (a true-colour heatwave is just clear sky)", () => {
    expect(viewForAlert(worded("Heat Advisory"))).toBe("landtemp");
    expect(viewForAlert(worded("Excessive Heat Warning"))).toBe("landtemp");
    expect(viewForAlert(worded("high temperature"))).toBe("landtemp"); // CMA/WMO wording
    expect(viewForAlert(worded("Extreme temperature"))).toBe("landtemp");
    expect(viewForAlert(worded("Vague d'orage", "Canicule attendue"))).toBe("landtemp"); // headline too
  });

  it("leaves visible weather on true-colour cloud imagery", () => {
    for (const ev of ["Typhoon", "Rainstorm", "Flood Warning", "Severe Thunderstorm", "Tropical Cyclone Alpha", "Wildfire smoke", "Dust storm", "Blizzard"]) {
      expect(viewForAlert(worded(ev))).toBe("truecolor");
    }
  });

  it("takes NO snapshot for hazards a satellite cannot show", () => {
    // A true-colour still of a wind advisory is a picture of nothing.
    for (const ev of ["Wind Advisory", "Gale Warning", "Air Quality Alert", "Frost Warning", "Avalanche Warning", "Lightning", "Tsunami Warning"]) {
      expect(viewForAlert(worded(ev))).toBeNull();
    }
  });

  it("keeps a storm on true-colour even when its text mentions wind", () => {
    // Visible wording wins over the blind list — otherwise the flagship case (a cyclone
    // described by its damaging winds) would silently lose its imagery.
    expect(viewForAlert(worded("Tropical Cyclone", "Damaging winds and storm surge"))).toBe("truecolor");
    expect(viewForAlert(worded("Severe Thunderstorm", "Gale-force wind gusts"))).toBe("truecolor");
  });

  it("defaults unfamiliar (e.g. non-English) wording to true-colour rather than skipping", () => {
    // WMO relays member text verbatim; an allowlist would starve foreign-worded storms.
    expect(viewForAlert(worded("Avertissement"))).toBe("truecolor");
    expect(viewForAlert(worded(""))).toBe("truecolor");
  });

  it("does not mistake incidental words for a heat hazard", () => {
    // "heating" / "wheat" must not trip the classifier — a wrong landtemp pick would swap
    // useful cloud imagery for a cloud-masked blank.
    expect(viewForAlert(worded("Wheat harvest advisory"))).toBe("truecolor");
    expect(viewForAlert(worded("District heating outage"))).toBe("truecolor");
  });
});

describe("alertSnapshotBbox", () => {
  it("pads a polygon's bbox and returns null for geocode-only alerts", () => {
    const bb = alertSnapshotBbox(alert(box(0, 0, 2)));
    expect(bb).not.toBeNull();
    // Padded outward on all sides (frac 0.3, min 1°) from [0,0,2,2].
    expect(bb![0]).toBeLessThan(0);
    expect(bb![2]).toBeGreaterThan(2);
    expect(alertSnapshotBbox(alert(null))).toBeNull();
  });
});

describe("selectSnapshotTargets", () => {
  it("drops geometry-less alerts and caps the count", () => {
    const alerts = [alert(box(0, 0), "a"), alert(null, "b"), alert(box(10, 10), "c"), alert(box(20, 20), "d")];
    const targets = selectSnapshotTargets(alerts, { max: 2 });
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.alert.id)).toEqual(["a", "c"]); // "b" (no geom) skipped, capped at 2
    targets.forEach((t) => expect(t.bbox).toHaveLength(4));
  });

  it("skips hazards satellite can't show, and resolves each survivor's view", () => {
    /** An alert carrying BOTH hazard wording and drawable geometry. */
    const hazard = (event: string, geometry: AlertGeometry, id: string): iAlertModel =>
      ({
        id,
        source: "wmo",
        identifier: id,
        info: [{ event, area: [{ areaDesc: "", geometry, geocodes: [] }] }],
      }) as unknown as iAlertModel;

    const targets = selectSnapshotTargets([
      hazard("Wind Advisory", box(0, 0), "wind"), // invisible from orbit → no snapshot
      hazard("Air Quality Alert", box(5, 5), "aqi"),
      hazard("Heat Advisory", box(10, 10), "heat"),
      hazard("Typhoon", box(20, 20), "storm"),
    ]);
    expect(targets.map((t) => t.alert.id)).toEqual(["heat", "storm"]);
    expect(targets.map((t) => t.view)).toEqual(["landtemp", "truecolor"]);
  });
});

describe("hourSlotOf", () => {
  it("buckets to the UTC hour", () => {
    expect(hourSlotOf(new Date("2026-07-12T15:42:03Z"))).toBe("2026-07-12T15");
  });
});
