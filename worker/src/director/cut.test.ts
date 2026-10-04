jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import { emitWorkerEvent } from "../socket";
import { performCut, newRunner, GEO_RECENT_CAP, HISTORY_CAP, type CutMeta } from "./cut";
import { DEFAULT_DIRECTOR_CONFIG, DIRECTOR_STATE, type DirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import { AREA_MEMORY_CAP, type Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";

const emitted = emitWorkerEvent as jest.Mock;

/** Minimal fake DB facade exposing just what performCut (and airLogCut) touch. */
function fakeDb() {
  return {
    ads: {
      markShown: jest.fn(async () => undefined),
      recordImpression: jest.fn(async () => undefined),
    },
    airLog: {
      startRun: jest.fn(async () => "run1"),
      recordCut: jest.fn(async () => undefined),
    },
  };
}

const cfg = (over: Partial<DirectorConfig> = {}): DirectorConfig => ({ ...DEFAULT_DIRECTOR_CONFIG, ...over });

const seg = (kind: SegmentKind, subject: string, over: Partial<Segment> = {}): Segment => ({
  id: `${kind}:${subject}`,
  kind,
  title: subject,
  camera: { center: [10, 20], zoom: 4 },
  patch: {},
  holdMs: 30_000,
  ...over,
});

const meta = (db: ReturnType<typeof fakeDb>, now: number, over: Partial<CutMeta> = {}): CutMeta => ({
  db: db as unknown as AppDb,
  cfg: cfg(),
  now,
  ...over,
});

beforeEach(() => emitted.mockClear());

describe("performCut", () => {
  it("advances seq, times the shot from holdMs and emits the cut", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    const next = seg("quake", "q1", { holdMs: 45_000 });
    await performCut(r, next, [], meta(db, 1_000));
    expect(r.seq).toBe(1);
    expect(r.current).toBe(next);
    expect(r.startedAt).toBe(1_000);
    expect(r.endsAt).toBe(46_000);
    expect(r.lastEmit).toBe(1_000);
    expect(emitted).toHaveBeenCalledTimes(1);
    const { type, data } = emitted.mock.calls[0][0];
    expect(type).toBe(DIRECTOR_STATE);
    expect(data).toMatchObject({ sceneId: "main", seq: 1, active: true, segment: next, startedAt: 1_000, endsAt: 46_000, timesShown: 1 });

    await performCut(r, seg("storm", "a1"), [], meta(db, 2_000));
    expect(r.seq).toBe(2);
  });

  it("stamps spinEpoch and the operator's cutTransitionMs on the patch", async () => {
    const db = fakeDb();
    const next = seg("quake", "q1");
    await performCut(newRunner("main"), next, [], meta(db, 5_000, { cfg: cfg({ transitionSeconds: 2.5 }) }));
    expect(next.patch.spinEpoch).toBe(5_000);
    expect(next.patch.cutTransitionMs).toBe(2_500);

    const dflt = seg("quake", "q2");
    await performCut(newRunner("main"), dflt, [], meta(db, 5_000, { cfg: cfg({ transitionSeconds: undefined as unknown as number }) }));
    expect(dflt.patch.cutTransitionMs).toBe(Math.round(DEFAULT_DIRECTOR_CONFIG.transitionSeconds * 1000));
  });

  it("tallies timesShown + lastShownAt across repeat airings", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    await performCut(r, seg("quake", "q1"), [], meta(db, 1_000));
    expect(r.timesShown).toBe(1);
    expect(r.lastShownAt).toBeUndefined();
    await performCut(r, seg("storm", "a1"), [], meta(db, 2_000));
    await performCut(r, seg("quake", "q1"), [], meta(db, 3_000));
    expect(r.timesShown).toBe(2);
    expect(r.lastShownAt).toBe(1_000);
    expect(r.seen.get("quake:q1")).toEqual({ count: 2, last: 3_000 });
  });

  it("remembers located centers (capped) but skips the global kinds", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    for (const kind of ["intro", "global", "ocean", "orbital"] as SegmentKind[]) {
      await performCut(r, seg(kind, "world"), [], meta(db, 1_000));
    }
    expect(r.recentCenters).toEqual([]);
    for (let i = 0; i < GEO_RECENT_CAP + 2; i++) {
      await performCut(r, seg("quake", `q${i}`, { camera: { center: [i, 0], zoom: 5 } }), [], meta(db, 1_000));
    }
    expect(r.recentCenters).toHaveLength(GEO_RECENT_CAP);
    expect(r.recentCenters[0]).toEqual([2, 0]);
    expect(r.recentCenters[GEO_RECENT_CAP - 1]).toEqual([GEO_RECENT_CAP + 1, 0]);
  });

  it("records the aired area per kind — move-to-front on a revisit, capped", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    const cand = (subject: string, areaKey: string): Candidate => ({ score: 50, segment: seg("storm", subject), areaKey });
    const pool = ["a", "b", "c", "d"].map((k) => cand(k, `country:${k}`));
    const cutTo = (subject: string) => performCut(r, pool.find((c) => c.segment.id === `storm:${subject}`)!.segment, pool, meta(db, 1_000));

    await cutTo("a");
    await cutTo("b");
    await cutTo("a"); // revisit refreshes recency rather than double-filling
    expect(r.recentAreasByKind.get("storm")).toEqual(["country:b", "country:a"]);

    await cutTo("c");
    await cutTo("d");
    expect(r.recentAreasByKind.get("storm")).toHaveLength(AREA_MEMORY_CAP);
    expect(r.recentAreasByKind.get("storm")).toEqual(["country:a", "country:c", "country:d"].slice(-AREA_MEMORY_CAP));

    // A segment not in the pool has no area to remember.
    await performCut(r, seg("quake", "q1"), [], meta(db, 1_000));
    expect(r.recentAreasByKind.has("quake")).toBe(false);
  });

  it("caps the history at HISTORY_CAP, oldest out first", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    for (let i = 0; i < HISTORY_CAP + 3; i++) await performCut(r, seg("quake", `q${i}`), [], meta(db, 1_000));
    expect(r.history).toHaveLength(HISTORY_CAP);
    expect(r.history[0]).toBe("quake:q3");
    expect(r.history[HISTORY_CAP - 1]).toBe(`quake:q${HISTORY_CAP + 2}`);
  });

  it("marks an ad shown on an ad cut and banks the outgoing ad's real airtime", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    r.pendingAd = true;
    const ad = seg("ad", "ad1", { ad: { adId: "ad1", title: "Ad", mediaType: "image", mediaUrl: "/x.png" } as Segment["ad"] });
    await performCut(r, ad, [], meta(db, 10_000));
    expect(db.ads.markShown).toHaveBeenCalledWith("ad1", new Date(10_000));
    expect(r.lastAdId).toBe("ad1");
    expect(r.pendingAd).toBe(false);
    expect(db.ads.recordImpression).not.toHaveBeenCalled();

    await performCut(r, seg("quake", "q1"), [], meta(db, 17_500));
    expect(db.ads.recordImpression).toHaveBeenCalledWith("ad1", 7_500);
    expect(db.ads.markShown).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit upNext as given, ignoring the pool", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    const pool: Candidate[] = [
      { score: 6, segment: seg("country", "fr") },
      { score: 6, segment: seg("quake", "q1") },
    ];
    const upNext = [{ kind: "region" as SegmentKind, title: "Europe", center: [10, 50] as [number, number], zoom: 3, subject: "europe" }];
    await performCut(r, seg("quake", "q1"), pool, meta(db, 1_000, { upNext }));
    expect(r.upNext).toBe(upNext);
    expect(emitted.mock.calls[0][0].data.upNext).toBe(upNext);
  });

  it("previews upNext from the pool by default, and keeps the prior rail when the pool is empty", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    const pool: Candidate[] = [
      { score: 6, segment: seg("country", "fr") },
      { score: 6, segment: seg("quake", "q1") },
    ];
    await performCut(r, seg("quake", "q1"), pool, meta(db, 1_000));
    expect(r.upNext.map((u) => u.title)).toEqual(["fr"]);
    const prior = r.upNext;
    await performCut(r, seg("ad", "ad1"), [], meta(db, 2_000));
    expect(r.upNext).toBe(prior);
  });

  it("writes the as-run log by default (skip + priority reasons carried through)", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    await performCut(r, seg("quake", "q1"), [], meta(db, 1_000, { skipRequested: true, pickedViaPriority: true, cfg: cfg({ skipNonce: 4 }) }));
    expect(db.airLog.startRun).toHaveBeenCalledWith("main", new Date(1_000));
    expect(db.airLog.recordCut).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run1", seq: 1, segmentId: "quake:q1", breaking: true, timesShown: 1 }),
      "skipped",
    );
    expect(r.runId).toBe("run1");
    expect(r.lastCutWasPriority).toBe(true);
    expect(r.lastSkipNonce).toBe(4);
  });

  it("skips the as-run log when record is false, but still cuts and emits", async () => {
    const db = fakeDb();
    const r = newRunner("main");
    await performCut(r, seg("quake", "q1"), [], meta(db, 1_000, { record: false }));
    expect(db.airLog.startRun).not.toHaveBeenCalled();
    expect(db.airLog.recordCut).not.toHaveBeenCalled();
    expect(r.runId).toBeUndefined();
    expect(r.seq).toBe(1);
    expect(emitted).toHaveBeenCalledTimes(1);
  });
});
