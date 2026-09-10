/**
 * The WeatherFrame archive was keep-forever while MRMS added a frame every two
 * minutes, which is what filled the blob store (docs/blob-retention-plan.md).
 * Thinning replaces "keep everything" with "keep a sample": a full-res working
 * set, then ONE frame per (model, variable) per UTC day forever, and nothing at
 * all for the zoom-gated nests past their own window.
 *
 * Selection is pure, so it is pinned here without Mongo, disk or a clock.
 */
import { planFrameThinning, runThinArchive, type ThinFrameMeta } from "./thinArchive";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** 2026-09-01T00:00:00Z, a round UTC midnight to anchor the fixtures on. */
const T0 = Date.parse("2026-09-01T00:00:00.000Z");

const frame = (id: string, model: string, variable: string, ms: number): ThinFrameMeta => ({
  id,
  model,
  variable,
  validTime: new Date(ms).toISOString(),
});

/** Only "mrms" and "hrrr" count as nests in these tests. */
const isNest = (m: string) => m === "mrms" || m === "hrrr";

const opts = (over: Partial<Parameters<typeof planFrameThinning>[1]> = {}) => ({
  fullResUntilMs: T0 + 10 * DAY,
  nestCutoffMs: T0 + 5 * DAY,
  isNest,
  keeperHour: 12,
  ...over,
});

describe("planFrameThinning", () => {
  it("never touches a frame inside the full-res window", () => {
    const frames = [
      frame("a", "gfs", "temp", T0 + 10 * DAY),
      frame("b", "gfs", "temp", T0 + 10 * DAY + HOUR),
      frame("c", "mrms", "radar", T0 + 12 * DAY),
    ];
    expect(planFrameThinning(frames, opts())).toEqual([]);
  });

  it("keeps one frame per model+variable per UTC day, nearest midday", () => {
    const frames = [
      frame("early", "gfs", "temp", T0 + 0 * HOUR),
      frame("noonish", "gfs", "temp", T0 + 13 * HOUR),
      frame("late", "gfs", "temp", T0 + 21 * HOUR),
    ];
    expect(planFrameThinning(frames, opts()).sort()).toEqual(["early", "late"]);
  });

  it("keeps a separate keeper for each day, model and variable", () => {
    const frames = [
      frame("d1a", "gfs", "temp", T0 + 1 * HOUR),
      frame("d1b", "gfs", "temp", T0 + 12 * HOUR),
      frame("d2a", "gfs", "temp", T0 + DAY + 1 * HOUR),
      frame("d2b", "gfs", "temp", T0 + DAY + 12 * HOUR),
      frame("windA", "gfs", "wind", T0 + 1 * HOUR),
      frame("windB", "gfs", "wind", T0 + 12 * HOUR),
      frame("ifsA", "ifs", "temp", T0 + 1 * HOUR),
      frame("ifsB", "ifs", "temp", T0 + 12 * HOUR),
    ];
    expect(planFrameThinning(frames, opts()).sort()).toEqual(["d1a", "d2a", "ifsA", "windA"]);
  });

  it("leaves a day that already holds exactly one frame alone", () => {
    const frames = [frame("only", "gfs", "temp", T0 + 3 * HOUR)];
    expect(planFrameThinning(frames, opts())).toEqual([]);
  });

  it("drops nest frames past the nest window but keeps them at full cadence inside it", () => {
    const frames = [
      frame("oldRadar1", "mrms", "radar", T0 + 1 * HOUR),
      frame("oldRadar2", "mrms", "radar", T0 + 1 * HOUR + 120_000),
      frame("recentRadar1", "mrms", "radar", T0 + 6 * DAY),
      frame("recentRadar2", "mrms", "radar", T0 + 6 * DAY + 120_000),
    ];
    // Both old radar frames go; both inside the nest window survive UNTHINNED,
    // because a nest is a live overlay, not a historical record.
    expect(planFrameThinning(frames, opts()).sort()).toEqual(["oldRadar1", "oldRadar2"]);
  });

  it("does not daily-thin a nest — it is all-or-nothing", () => {
    const frames = [
      frame("r1", "hrrr", "temp", T0 + 6 * DAY + 1 * HOUR),
      frame("r2", "hrrr", "temp", T0 + 6 * DAY + 12 * HOUR),
      frame("r3", "hrrr", "temp", T0 + 6 * DAY + 20 * HOUR),
    ];
    expect(planFrameThinning(frames, opts())).toEqual([]);
  });

  it("is stable: re-running over the survivors deletes nothing more", () => {
    const frames = [
      frame("a", "gfs", "temp", T0 + 2 * HOUR),
      frame("b", "gfs", "temp", T0 + 12 * HOUR),
      frame("c", "gfs", "temp", T0 + 23 * HOUR),
    ];
    const doomed = new Set(planFrameThinning(frames, opts()));
    const survivors = frames.filter((f) => !doomed.has(f.id));
    expect(planFrameThinning(survivors, opts())).toEqual([]);
  });

  it("ignores a frame with an unparseable validTime rather than guessing", () => {
    const frames = [
      { id: "bad", model: "gfs", variable: "temp", validTime: "not a date" },
      frame("good1", "gfs", "temp", T0 + 2 * HOUR),
      frame("good2", "gfs", "temp", T0 + 12 * HOUR),
    ];
    expect(planFrameThinning(frames, opts())).toEqual(["good1"]);
  });

  it("respects a shifted keeper hour", () => {
    const frames = [
      frame("dawn", "gfs", "temp", T0 + 6 * HOUR),
      frame("noon", "gfs", "temp", T0 + 12 * HOUR),
    ];
    expect(planFrameThinning(frames, opts({ keeperHour: 6 }))).toEqual(["noon"]);
  });
});

describe("runThinArchive", () => {
  const buildDb = (frames: ThinFrameMeta[]) => {
    const deleted: string[] = [];
    return {
      deleted,
      db: {
        weatherFrames: {
          variables: async () => [...new Set(frames.map((f) => f.variable))],
          listMeta: async ({ variable, to }: { variable: string; to?: Date }) =>
            frames.filter((f) => f.variable === variable && (!to || +new Date(f.validTime) <= +to)),
          deleteMany: async (ids: string[]) => {
            deleted.push(...ids);
            return { removed: ids.length };
          },
        },
      },
    };
  };

  const OLD = Date.parse("2026-08-01T00:00:00.000Z");
  const frames = [
    frame("t1", "gfs", "temp", OLD + 1 * HOUR),
    frame("t2", "gfs", "temp", OLD + 12 * HOUR),
    frame("w1", "gfs", "wind", OLD + 1 * HOUR),
    frame("w2", "gfs", "wind", OLD + 12 * HOUR),
  ];

  it("deletes nothing on a dry run but still reports the count", async () => {
    const { deleted, db } = buildDb(frames);
    const res = await runThinArchive(db, { dryRun: true, now: OLD + 30 * DAY });
    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ dryRun: true, doomed: 2, removed: 0, variables: 2 });
  });

  it("deletes the non-keepers for real when not a dry run", async () => {
    const { deleted, db } = buildDb(frames);
    const res = await runThinArchive(db, { now: OLD + 30 * DAY });
    expect(deleted.sort()).toEqual(["t1", "w1"]);
    expect(res).toMatchObject({ dryRun: false, doomed: 2, removed: 2 });
  });

  it("does nothing when every frame is still inside the full-res window", async () => {
    const { deleted, db } = buildDb(frames);
    const res = await runThinArchive(db, { now: OLD + 1 * HOUR });
    expect(deleted).toEqual([]);
    expect(res).toMatchObject({ doomed: 0, removed: 0 });
  });
});
