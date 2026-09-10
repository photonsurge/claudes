/**
 * Alert imagery had NO retention at all: `pruneOlderThan` was written and
 * correct, and nothing ever called it. Combined with the hourly compare job
 * re-storing a byte-identical side-by-side, that filled 74 GB
 * (docs/blob-retention-plan.md §2A/§2B).
 *
 * These pin the sampling rule, including the one thing that must survive
 * everything: a keepsake still for an alert that actually went to air.
 */
import {
  planSnapshotThinning,
  runAlertSnapshotRetention,
  type RetainSnapMeta,
} from "./snapshot-retention";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");

const snap = (
  id: string,
  ms: number,
  over: Partial<RetainSnapMeta> = {},
): RetainSnapMeta => ({
  id,
  source: "wmo",
  identifier: "i1",
  kind: "satellite",
  layer: "truecolor",
  capturedAt: new Date(ms).toISOString(),
  ...over,
});

const opts = (over: Partial<Parameters<typeof planSnapshotThinning>[1]> = {}) => ({
  fullResUntilMs: T0 + 40 * DAY,
  hardCutoffMs: T0 + 10 * DAY,
  ...over,
});

describe("planSnapshotThinning", () => {
  it("never touches a still inside the full-res window", () => {
    const snaps = [snap("a", T0 + 40 * DAY), snap("b", T0 + 40 * DAY + HOUR)];
    expect(planSnapshotThinning(snaps, opts())).toEqual([]);
  });

  it("keeps the NEWEST still of each day, dropping the rest of that day", () => {
    const snaps = [
      snap("morning", T0 + 20 * DAY + 2 * HOUR),
      snap("midday", T0 + 20 * DAY + 12 * HOUR),
      snap("evening", T0 + 20 * DAY + 22 * HOUR),
    ];
    expect(planSnapshotThinning(snaps, opts()).sort()).toEqual(["midday", "morning"]);
  });

  it("groups per alert, kind and layer, so a day can keep several stills", () => {
    const snaps = [
      snap("satA", T0 + 20 * DAY + 2 * HOUR),
      snap("satB", T0 + 20 * DAY + 5 * HOUR),
      snap("cmpA", T0 + 20 * DAY + 2 * HOUR, { kind: "compare", layer: "satellite" }),
      snap("cmpB", T0 + 20 * DAY + 5 * HOUR, { kind: "compare", layer: "satellite" }),
      snap("otherAlert", T0 + 20 * DAY + 2 * HOUR, { identifier: "i2" }),
    ];
    // One survivor per group; `otherAlert` is alone in its own group.
    expect(planSnapshotThinning(snaps, opts()).sort()).toEqual(["cmpA", "satA"]);
  });

  it("drops everything past the hard cap", () => {
    const snaps = [snap("ancient1", T0 + 1 * DAY), snap("ancient2", T0 + 2 * DAY)];
    expect(planSnapshotThinning(snaps, opts()).sort()).toEqual(["ancient1", "ancient2"]);
  });

  it("spares the newest satellite still of an alert that aired, however old", () => {
    const snaps = [
      snap("old", T0 + 1 * DAY),
      snap("newer", T0 + 2 * DAY),
      snap("newest", T0 + 3 * DAY),
    ];
    const doomed = planSnapshotThinning(snaps, opts({ aired: new Set(["wmo:i1"]) }));
    expect(doomed.sort()).toEqual(["newer", "old"]);
    expect(doomed).not.toContain("newest");
  });

  it("gives no keepsake to an alert that never aired", () => {
    const snaps = [snap("old", T0 + 1 * DAY), snap("newest", T0 + 3 * DAY)];
    const doomed = planSnapshotThinning(snaps, opts({ aired: new Set(["wmo:somethingElse"]) }));
    expect(doomed.sort()).toEqual(["newest", "old"]);
  });

  it("keeps a keepsake per aired alert, not one overall", () => {
    const snaps = [
      snap("a-old", T0 + 1 * DAY),
      snap("a-new", T0 + 2 * DAY),
      snap("b-old", T0 + 1 * DAY, { identifier: "i2" }),
      snap("b-new", T0 + 2 * DAY, { identifier: "i2" }),
    ];
    const doomed = planSnapshotThinning(snaps, opts({ aired: new Set(["wmo:i1", "wmo:i2"]) }));
    expect(doomed.sort()).toEqual(["a-old", "b-old"]);
  });

  it("only ever keepsakes a satellite still, not a camera or compare", () => {
    const snaps = [
      snap("cam", T0 + 3 * DAY, { kind: "camera", layer: "cam-7" }),
      snap("cmp", T0 + 3 * DAY, { kind: "compare", layer: "satellite" }),
    ];
    const doomed = planSnapshotThinning(snaps, opts({ aired: new Set(["wmo:i1"]) }));
    expect(doomed.sort()).toEqual(["cam", "cmp"]);
  });

  it("is stable: re-running over the survivors deletes nothing more", () => {
    const snaps = [
      snap("d1a", T0 + 20 * DAY + 2 * HOUR),
      snap("d1b", T0 + 20 * DAY + 9 * HOUR),
      snap("d2a", T0 + 21 * DAY + 2 * HOUR),
      snap("recent", T0 + 41 * DAY),
    ];
    const doomed = new Set(planSnapshotThinning(snaps, opts()));
    const survivors = snaps.filter((s) => !doomed.has(s.id));
    expect(planSnapshotThinning(survivors, opts())).toEqual([]);
  });

  it("ignores a still with an unparseable capture time rather than guessing", () => {
    const snaps = [
      { id: "bad", source: "wmo", identifier: "i1", kind: "satellite", capturedAt: "nope" },
      snap("g1", T0 + 20 * DAY + 2 * HOUR),
      snap("g2", T0 + 20 * DAY + 9 * HOUR),
    ];
    expect(planSnapshotThinning(snaps, opts())).toEqual(["g1"]);
  });
});

describe("runAlertSnapshotRetention", () => {
  const buildDb = (snaps: RetainSnapMeta[], airedIds: string[] = []) => {
    const deleted: string[] = [];
    return {
      deleted,
      db: {
        alertSnapshots: {
          listAllMeta: async () => snaps,
          deleteMany: async (ids: string[]) => {
            deleted.push(...ids);
            return { removed: ids.length };
          },
        },
        airLog: { airedSegmentIds: async () => airedIds },
      },
    };
  };

  const NOW = T0 + 60 * DAY;
  const snaps = [
    snap("recent", NOW - 1 * HOUR),
    snap("dayA1", NOW - 10 * DAY - 2 * HOUR),
    snap("dayA2", NOW - 10 * DAY - 1 * HOUR),
    snap("ancient", NOW - 200 * DAY),
  ];

  it("deletes nothing on a dry run but still reports the count", async () => {
    const { deleted, db } = buildDb(snaps);
    const res = await runAlertSnapshotRetention(db, { dryRun: true, now: NOW });
    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ dryRun: true, scanned: 4, removed: 0 });
    expect(res.doomed).toBeGreaterThan(0);
  });

  it("deletes for real when not a dry run, sparing the recent window", async () => {
    const { deleted, db } = buildDb(snaps);
    const res = await runAlertSnapshotRetention(db, { now: NOW });
    expect(deleted).toContain("ancient");
    expect(deleted).not.toContain("recent");
    expect(res.removed).toBe(res.doomed);
  });

  it("reads the aired set from the as-run log and spares that alert's keepsake", async () => {
    const { deleted, db } = buildDb(snaps, ["storm:wmo:i1", "country:jp"]);
    const res = await runAlertSnapshotRetention(db, { now: NOW });
    expect(res.aired).toBe(1); // only the storm: entry counts
    expect(deleted).not.toContain("recent"); // newest satellite = the keepsake
    expect(deleted).toContain("ancient");
  });
});
