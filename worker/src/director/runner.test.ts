jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";
import { emitWorkerEvent } from "../socket";
import { HISTORY_CAP, countsOf, newRunner, performCut, previewNext, type CutDeps, type SceneRunner } from "./runner";

const seg = (id: string, center: [number, number] = [0, 0], over: Partial<Segment> = {}): Segment => ({
  id,
  kind: id.split(":")[0] as SegmentKind,
  title: id,
  camera: { center, zoom: 4 },
  patch: {},
  holdMs: 12_000,
  ...over,
});
const cand = (s: Segment, over: Partial<Candidate> = {}): Candidate => ({ segment: s, score: 1, ...over });

function fakeDb() {
  return {
    ads: { markShown: jest.fn(async () => undefined), recordImpression: jest.fn(async () => undefined) },
  };
}

function deps(): CutDeps & { emit: jest.Mock; airLogCut: jest.Mock } {
  return { emit: jest.fn(), airLogCut: jest.fn(async () => undefined) } as any;
}

const config = (patch: Record<string, unknown> = {}): DirectorConfig =>
  mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, patch as Partial<DirectorConfig>);

async function cut(
  r: SceneRunner,
  next: Segment,
  opts: { cfg?: DirectorConfig; pool?: Candidate[]; now?: number; skip?: boolean; breaking?: boolean; db?: ReturnType<typeof fakeDb>; d?: CutDeps } = {},
) {
  const d = opts.d ?? deps();
  await performCut(
    r,
    next,
    {
      db: (opts.db ?? fakeDb()) as unknown as AppDb,
      cfg: opts.cfg ?? config(),
      pool: opts.pool ?? [cand(next)],
      now: opts.now ?? 1_000,
      skipRequested: opts.skip ?? false,
      breaking: opts.breaking ?? false,
    },
    d,
  );
  return d;
}

describe("performCut", () => {
  it("puts the segment on air with the cut's timing", async () => {
    const r = newRunner("s1");
    const next = seg("quake:q1");
    await cut(r, next, { now: 5_000, cfg: config({ transitionSeconds: 2.5 }) });
    expect(r.current).toBe(next);
    expect(r.seq).toBe(1);
    expect(r.startedAt).toBe(5_000);
    expect(r.endsAt).toBe(5_000 + 12_000);
    expect(next.patch.spinEpoch).toBe(5_000);
    expect(next.patch.cutTransitionMs).toBe(2_500);
  });

  it("tallies airings for the operator readout", async () => {
    const r = newRunner("s1");
    await cut(r, seg("quake:q1"), { now: 1_000 });
    expect([r.timesShown, r.lastShownAt]).toEqual([1, undefined]);
    await cut(r, seg("storm:s1"), { now: 2_000 });
    await cut(r, seg("quake:q1"), { now: 3_000 });
    expect([r.timesShown, r.lastShownAt]).toEqual([2, 1_000]);
    expect(countsOf(r)).toEqual(new Map([["quake:q1", 2], ["storm:s1", 1]]));
  });

  it("records the break-in flag so the next boundary applies the cooldown", async () => {
    const r = newRunner("s1");
    await cut(r, seg("quake:q1"), { breaking: true });
    expect(r.lastCutWasPriority).toBe(true);
    await cut(r, seg("country:uk"), { breaking: false });
    expect(r.lastCutWasPriority).toBe(false);
  });

  it("remembers located centres up to the channel's recentCentersCap, skipping world views", async () => {
    const r = newRunner("s1");
    const cfg = config({ rotation: { recentCentersCap: 2 } });
    await cut(r, seg("quake:a", [10, 0]), { cfg });
    await cut(r, seg("global:world", [0, 0]), { cfg });
    await cut(r, seg("quake:b", [20, 0]), { cfg });
    await cut(r, seg("quake:c", [30, 0]), { cfg });
    expect(r.recentCenters).toEqual([[20, 0], [30, 0]]);
  });

  it("remembers areas per kind up to the channel's areaMemoryCap, newest last", async () => {
    const r = newRunner("s1");
    const cfg = config({ rotation: { areaMemoryCap: 2 } });
    for (const cc of ["KZ", "JP", "US", "JP"]) {
      const s = seg(`storm:${cc}`);
      await cut(r, s, { cfg, pool: [cand(s, { areaKey: `country:${cc}` })] });
    }
    expect(r.recentAreasByKind.get("storm")).toEqual(["country:US", "country:JP"]);
  });

  it("caps history", async () => {
    const r = newRunner("s1");
    for (let i = 0; i < HISTORY_CAP + 5; i++) await cut(r, seg(`quake:${i}`));
    expect(r.history).toHaveLength(HISTORY_CAP);
    expect(r.history[r.history.length - 1]).toBe(`quake:${HISTORY_CAP + 4}`);
  });

  it("acknowledges the skip nonce it acted on", async () => {
    const r = newRunner("s1");
    await cut(r, seg("quake:q1"), { cfg: config({ skipNonce: 7 }), skip: true });
    expect(r.lastSkipNonce).toBe(7);
  });

  it("books an ad's airing and the outgoing ad's real time on screen", async () => {
    const r = newRunner("s1");
    const db = fakeDb();
    const ad = seg("ad:a1", [0, 0], { ad: { adId: "a1", title: "Ad", mediaType: "image", mediaUrl: "/m" } as any });
    r.pendingAd = true;
    await cut(r, ad, { db, now: 10_000, pool: [] });
    expect(r.pendingAd).toBe(false);
    expect(r.lastAdId).toBe("a1");
    expect(db.ads.markShown).toHaveBeenCalledWith("a1", new Date(10_000));
    await cut(r, seg("quake:q1"), { db, now: 13_500 });
    expect(db.ads.recordImpression).toHaveBeenCalledWith("a1", 3_500);
  });

  it("keeps the previous up-next rail on an ad cut (no pool)", async () => {
    const r = newRunner("s1");
    r.upNext = [{ kind: "quake", title: "kept" } as any];
    await cut(r, seg("ad:a1", [0, 0], { ad: { adId: "a1" } as any }), { pool: [] });
    expect(r.upNext).toEqual([{ kind: "quake", title: "kept" }]);
  });

  it("emits and writes the as-run log with why the outgoing shot left", async () => {
    const r = newRunner("s1");
    const next = seg("quake:q1");
    const d = await cut(r, next, { now: 9_000, skip: true, breaking: true });
    expect(d.emit).toHaveBeenCalledWith(r, 9_000);
    expect(d.airLogCut).toHaveBeenCalledWith(expect.anything(), r, next, { skipRequested: true, breaking: true, now: 9_000 });
  });

  it("emits director:state through the socket by default", async () => {
    const r = newRunner("s1");
    await performCut(r, seg("quake:q1"), {
      db: fakeDb() as unknown as AppDb,
      cfg: config(),
      pool: [],
      now: 1,
      skipRequested: false,
      breaking: false,
    }, { emit: (await import("./runner")).emitState, airLogCut: jest.fn(async () => undefined) });
    expect(emitWorkerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "director:state", data: expect.objectContaining({ sceneId: "s1", seq: 1, active: true }) }),
    );
  });
});

describe("previewNext", () => {
  const rng = () => 0;

  it("leads with the break-in candidate when the tier is active", () => {
    const pool = [
      cand(seg("quake:new"), { score: 90, breakIn: { reason: "quake", at: 0 } }),
      cand(seg("country:uk")),
      cand(seg("storm:s1")),
    ];
    const out = previewNext(pool, "global:world", new Map(), { breakInActive: true, recentAreasByKind: new Map(), rng });
    expect(out[0].title).toBe("quake:new");
  });

  it("doesn't promise a break-in while the cooldown (or a disabled tier) holds it back", () => {
    const pool = [cand(seg("quake:new"), { breakIn: { reason: "quake", at: 0 } })];
    const out = previewNext(pool, "x", new Map(), { breakInActive: false, recentAreasByKind: new Map(), rng });
    // The quake still appears, but only as an ordinary kind sample.
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("quake");
  });

  it("excludes the segment just cut and the kind that just aired, at most three entries", () => {
    const pool = ["quake:a", "storm:b", "volcano:c", "flight:d", "ship:e"].map((id) => cand(seg(id)));
    const out = previewNext(pool, "quake:a", new Map(), { breakInActive: false, recentAreasByKind: new Map(), lastKind: "quake", rng });
    expect(out).toHaveLength(3);
    expect(out.some((e) => e.kind === "quake")).toBe(false);
  });
});
