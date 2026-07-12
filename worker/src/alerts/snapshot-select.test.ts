import { alertSnapshotBbox, selectSnapshotTargets, hourSlotOf } from "./snapshot-select";
import type { AlertGeometry, iAlertModel } from "@photonsurge/shared/db/alert-model";

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
});

describe("hourSlotOf", () => {
  it("buckets to the UTC hour", () => {
    expect(hourSlotOf(new Date("2026-07-12T15:42:03Z"))).toBe("2026-07-12T15");
  });
});
