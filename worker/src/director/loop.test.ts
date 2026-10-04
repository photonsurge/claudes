jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorCommand, DirectorOp } from "@photonsurge/shared/director-commands";
import type { FreshEvent } from "@photonsurge/shared/director-break-in";
import { pickAtBoundary, stepScene, type StepDeps } from "./loop";
import { newRunner, type SceneRunner } from "./runner";

const seg = (id: string): Segment => ({
  id,
  kind: id.split(":")[0] as SegmentKind,
  title: id,
  camera: { center: [0, 0], zoom: 4 },
  patch: {},
  holdMs: 12_000,
});
const db = {} as AppDb;
const config = (patch: Record<string, unknown> = {}): DirectorConfig =>
  mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, patch as Partial<DirectorConfig>);

const breakingQuake: Candidate = { segment: seg("quake:new"), score: 100, breakIn: { reason: "quake", at: 0 } };
const intro: Candidate = { segment: seg("intro:global"), score: 6 };
const country: Candidate = { segment: seg("country:uk"), score: 6 };

const builder = (pool: Candidate[]) => jest.fn(async () => pool);
const adBuilder = (ad: Segment | null) => jest.fn(async () => ad);

describe("pickAtBoundary", () => {
  it("opens the session on the intro, never a break-in", async () => {
    const r = newRunner("s1");
    const out = await pickAtBoundary(db, config(), r, builder([intro, country, breakingQuake]));
    expect(out.next?.id).toBe("intro:global");
    expect(out.breaking).toBe(false);
  });

  it("takes a breaking candidate after the opener, saying why on air", async () => {
    const r = { ...newRunner("s1"), seq: 3 };
    const out = await pickAtBoundary(db, config(), r, builder([country, { ...breakingQuake, segment: seg("quake:new") }]));
    expect(out).toMatchObject({ next: { id: "quake:new", breakIn: { reason: "quake", interrupted: false } }, breaking: true });
  });

  it("skips the tier when the channel turns break-ins off", async () => {
    const r = { ...newRunner("s1"), seq: 3 };
    const out = await pickAtBoundary(db, config({ breakIn: { enabled: false } }), r, builder([country, breakingQuake]));
    expect(out.breaking).toBe(false);
  });

  it("holds the tier back for one cut after a break-in", async () => {
    const r = { ...newRunner("s1"), seq: 3, lastCutWasPriority: true };
    const out = await pickAtBoundary(db, config(), r, builder([country, breakingQuake]));
    expect(out.breaking).toBe(false);
  });

  it("airs a due ad break when nothing is breaking", async () => {
    const r = { ...newRunner("s1"), seq: 6 };
    const ad = seg("ad:a1");
    const out = await pickAtBoundary(db, config({ kinds: { ad: true }, adEveryNShots: 6 }), r, builder([country]), adBuilder(ad));
    expect(out).toEqual({ next: ad, pool: [], breaking: false });
  });

  it("defers a due ad break for breaking news and remembers it is owed", async () => {
    const r = { ...newRunner("s1"), seq: 6 };
    const buildAd = adBuilder(seg("ad:a1"));
    const out = await pickAtBoundary(db, config({ kinds: { ad: true }, adEveryNShots: 6 }), r, builder([country, breakingQuake]), buildAd);
    expect(out.next?.id).toBe("quake:new");
    expect(r.pendingAd).toBe(true);
    expect(buildAd).not.toHaveBeenCalled();
  });

  it("falls through to rotation when an ad is due but none is active", async () => {
    const r = { ...newRunner("s1"), seq: 6 };
    const out = await pickAtBoundary(db, config({ kinds: { ad: true }, adEveryNShots: 6 }), r, builder([country]), adBuilder(null));
    expect(out.next?.id).toBe("country:uk");
  });
});

/** An in-memory director_commands collection with the repo's semantics. */
function memoryQueue(rows: DirectorCommand[]) {
  return {
    rows,
    pending: async (sceneId: string) => rows.filter((c) => c.sceneId === sceneId && c.status === "queued"),
    settle: async (id: string, status: DirectorCommand["status"], extra: Record<string, unknown>) => {
      const row = rows.find((c) => c.id === id && c.status === "queued");
      if (!row) return false;
      const { now: _now, ...rest } = extra;
      Object.assign(row, { status, ...rest });
      return true;
    },
    clearQueued: async (sceneId: string) => {
      let n = 0;
      for (const c of rows) if (c.sceneId === sceneId && c.status === "queued") (c.status = "dropped"), n++;
      return n;
    },
  };
}

describe("stepScene", () => {
  const NOW = 10_000_000;
  let id = 0;
  const command = (op: DirectorOp, over: Partial<DirectorCommand> = {}): DirectorCommand => ({
    id: `c${++id}`,
    sceneId: "s1",
    source: { kind: "operator", user: "op@x" },
    cmd: op,
    status: "queued",
    createdAt: NOW - 500,
    expiresAt: NOW + 600_000,
    ...over,
  });
  const onAir = (): SceneRunner => ({
    ...newRunner("s1"),
    seq: 4,
    current: seg("country:uk"),
    startedAt: NOW - 3_000,
    endsAt: NOW + 9_000,
  });
  const setup = (rows: DirectorCommand[], resolved: Segment | null = seg("quake:taken")) => {
    const queue = memoryQueue(rows);
    const fake = { directorCommands: queue } as unknown as AppDb;
    const cutCalls: { next: Segment; meta: any }[] = [];
    const deps: StepDeps = {
      pick: jest.fn(async () => ({ next: seg("storm:rotation"), pool: [], breaking: false })),
      cut: jest.fn(async (r: SceneRunner, next: Segment, meta: any) => {
        cutCalls.push({ next, meta });
        r.seq += 1;
        r.current = next;
        r.startedAt = meta.now;
        r.endsAt = meta.now + next.holdMs;
      }) as any,
      resolve: jest.fn(async () => (resolved ? { segment: resolved } : { refused: "no quake in the pool" })) as any,
      emit: jest.fn(),
      fresh: { ensureStarted: jest.fn(), since: () => [] },
    };
    return { queue, fake, deps, cutCalls };
  };

  it("does nothing mid-shot with an empty queue but heartbeat", async () => {
    const { fake, deps } = setup([]);
    const r = { ...onAir(), lastEmit: NOW - 10_000 };
    await stepScene(fake, config(), r, NOW, deps);
    expect(deps.cut).not.toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledTimes(1);
  });

  it("airs the director's own pick at a boundary", async () => {
    const { fake, deps, cutCalls } = setup([]);
    const r = { ...onAir(), endsAt: NOW - 1 };
    await stepScene(fake, config(), r, NOW, deps);
    expect(cutCalls.map((c) => c.next.id)).toEqual(["storm:rotation"]);
  });

  it("takes an operator cut now, mid-shot, and records it as a skip of the outgoing shot", async () => {
    const take = command({ op: "cut", target: { type: "segment", id: "quake:taken" }, holdS: 40 });
    const { queue, fake, deps, cutCalls } = setup([take]);
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    expect(cutCalls).toHaveLength(1);
    expect(cutCalls[0].next.holdMs).toBe(40_000);
    expect(cutCalls[0].meta).toMatchObject({ skipRequested: true, breaking: false, command: { source: "operator", author: "op@x" } });
    expect(queue.rows[0]).toMatchObject({ status: "applied", appliedSeq: 5, resolved: { id: "quake:taken", title: "quake:taken" } });
    expect(deps.pick).not.toHaveBeenCalled();
  });

  it("settles a refused cut with the reason and keeps the current shot", async () => {
    const { queue, fake, deps } = setup([command({ op: "cut", target: { type: "kind", kind: "quake" } })], null);
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    expect(deps.cut).not.toHaveBeenCalled();
    expect(queue.rows[0]).toMatchObject({ status: "refused", note: "no quake in the pool" });
    expect(r.current?.id).toBe("country:uk");
  });

  it("airs a queued command at the next boundary, not before", async () => {
    const next = command({ op: "queue", target: { type: "kind", kind: "volcano" } });
    const { queue, fake, deps, cutCalls } = setup([next], seg("volcano:v"));
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    expect(deps.cut).not.toHaveBeenCalled();
    expect(r.queued).toEqual([{ id: next.id, label: "Next: a volcano", source: "operator" }]);
    r.endsAt = NOW;
    await stepScene(fake, config(), r, NOW + 1, deps);
    expect(cutCalls.map((c) => c.next.id)).toEqual(["volcano:v"]);
    expect(queue.rows[0].status).toBe("applied");
    expect(r.queued).toEqual([]);
  });

  it("falls back to the director's pick when a queued command is refused", async () => {
    const { queue, fake, deps, cutCalls } = setup([command({ op: "queue", target: { type: "kind", kind: "ship" } })], null);
    await stepScene(fake, config(), { ...onAir(), endsAt: NOW }, NOW, deps);
    expect(queue.rows[0].status).toBe("refused");
    expect(cutCalls.map((c) => c.next.id)).toEqual(["storm:rotation"]);
  });

  it("a skip command cuts at once and is logged as a skip", async () => {
    const { queue, fake, deps, cutCalls } = setup([command({ op: "skip" })]);
    await stepScene(fake, config(), onAir(), NOW, deps);
    expect(cutCalls).toHaveLength(1);
    expect(cutCalls[0].meta.skipRequested).toBe(true);
    expect(queue.rows[0].status).toBe("applied");
  });

  it("a hold extends the shot and is emitted straight away", async () => {
    const { fake, deps } = setup([command({ op: "hold", extendS: 30 })]);
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    expect(r.endsAt).toBe(NOW + 39_000);
    expect(deps.emit).toHaveBeenCalled();
  });

  it("pause freezes the shot past its end; no cut until resume", async () => {
    const { queue, fake, deps } = setup([command({ op: "pause" })]);
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    await stepScene(fake, config(), r, NOW + 60_000, deps);
    expect(deps.cut).not.toHaveBeenCalled();
    expect(r.endsAt).toBe(NOW + 60_000 + 9_000);
    queue.rows.push(command({ op: "resume" }));
    await stepScene(fake, config(), r, NOW + 61_000, deps);
    expect(r.paused).toBeUndefined();
    await stepScene(fake, config(), r, NOW + 61_000 + 9_000, deps);
    expect(deps.cut).toHaveBeenCalledTimes(1);
  });

  it("an operator Take still lands while paused, and the new shot stays frozen", async () => {
    const { queue, fake, deps, cutCalls } = setup([command({ op: "pause" })]);
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    queue.rows.push(command({ op: "cut", target: { type: "segment", id: "quake:taken" } }));
    await stepScene(fake, config(), r, NOW + 1_000, deps);
    expect(cutCalls.map((c) => c.next.id)).toEqual(["quake:taken"]);
    expect(r.paused?.remainingMs).toBe(12_000);
  });

  it("clear drops every other queued command", async () => {
    const rows = [command({ op: "queue", target: { type: "kind", kind: "quake" } }), command({ op: "clear" })];
    const { queue, fake, deps } = setup(rows);
    const r = onAir();
    await stepScene(fake, config(), r, NOW, deps);
    expect(queue.rows.map((c) => c.status)).toEqual(["dropped", "applied"]);
    expect(r.queued).toEqual([]);
  });

  it("expires a stale command without acting on it", async () => {
    const { queue, fake, deps } = setup([command({ op: "skip" }, { expiresAt: NOW - 1 })]);
    await stepScene(fake, config(), onAir(), NOW, deps);
    expect(queue.rows[0]).toMatchObject({ status: "expired", note: "lapsed before it could air" });
    expect(deps.cut).not.toHaveBeenCalled();
  });

  it("credits a viewer's cut to the viewer", async () => {
    const v = command(
      { op: "queue", target: { type: "kind", kind: "quake" } },
      { source: { kind: "viewer", platform: "youtube", author: "ann" } },
    );
    const { fake, deps, cutCalls } = setup([v]);
    await stepScene(fake, config(), { ...onAir(), endsAt: NOW }, NOW, deps);
    expect(cutCalls[0].meta.command).toEqual({ source: "viewer", author: "ann" });
  });

  describe("viewer requests", () => {
    const ann = { kind: "viewer" as const, platform: "youtube" as const, author: "ann" };
    const ask = (op: "cut" | "queue", viewer: DirectorCommand["viewer"], over: Partial<DirectorCommand> = {}) =>
      command({ op, target: { type: "place", query: "japan" } }, { source: ann, viewer, ...over });
    const paced = { everyS: 60, immediate: false, allowCities: false };

    it("waits for the shot change, then airs stamped with who asked", async () => {
      const { queue, fake, deps, cutCalls } = setup([ask("queue", paced)]);
      const r = onAir();
      await stepScene(fake, config(), r, NOW, deps);
      expect(cutCalls).toHaveLength(0);
      r.endsAt = NOW;
      await stepScene(fake, config(), r, NOW, deps);
      expect(cutCalls[0].next).toMatchObject({ id: "quake:taken", requestedBy: { author: "ann", platform: "youtube" } });
      expect(r.lastViewerCutAt).toBe(NOW);
      expect(queue.rows[0].status).toBe("applied");
    });

    it("never stamps the resolved pool member itself", async () => {
      const resolved = seg("quake:taken");
      const { fake, deps } = setup([ask("queue", paced)], resolved);
      await stepScene(fake, config(), { ...onAir(), endsAt: NOW }, NOW, deps);
      expect(resolved.requestedBy).toBeUndefined();
    });

    it("keeps the channel's gap between viewer cuts, rotating meanwhile", async () => {
      const { queue, fake, deps, cutCalls } = setup([ask("queue", paced)]);
      const r = { ...onAir(), endsAt: NOW, lastViewerCutAt: NOW - 30_000 };
      await stepScene(fake, config(), r, NOW, deps);
      expect(cutCalls.map((c) => c.next.id)).toEqual(["storm:rotation"]);
      expect(queue.rows[0].status).toBe("queued");
      r.endsAt = NOW + 30_000;
      await stepScene(fake, config(), r, NOW + 30_000, deps);
      expect(cutCalls[1].next.requestedBy?.author).toBe("ann");
    });

    it("passes the channel's city rule to the resolver (operators always get cities)", async () => {
      const { fake, deps } = setup([ask("queue", { ...paced, allowCities: true })]);
      await stepScene(fake, config(), { ...onAir(), endsAt: NOW }, NOW, deps);
      expect((deps.resolve as jest.Mock).mock.calls[0][6]).toEqual({ allowCities: true });
      const second = setup([ask("queue", paced)]);
      await stepScene(second.fake, config(), { ...onAir(), endsAt: NOW }, NOW, second.deps);
      expect((second.deps.resolve as jest.Mock).mock.calls[0][6]).toEqual({ allowCities: false });
      const op = setup([command({ op: "queue", target: { type: "place", query: "paris" } })]);
      await stepScene(op.fake, config(), { ...onAir(), endsAt: NOW }, NOW, op.deps);
      expect((op.deps.resolve as jest.Mock).mock.calls[0][6]).toEqual({ allowCities: true });
    });

    it("an immediate channel cuts mid-shot — but never into an ad or a paused shot", async () => {
      const fast = { ...paced, immediate: true };
      const a = setup([ask("cut", fast)]);
      await stepScene(a.fake, config(), onAir(), NOW, a.deps);
      expect(a.cutCalls[0].meta.skipRequested).toBe(true);
      expect(a.cutCalls[0].next.requestedBy?.author).toBe("ann");

      const b = setup([ask("cut", fast)]);
      await stepScene(b.fake, config(), { ...onAir(), current: seg("ad:a1") }, NOW, b.deps);
      expect(b.cutCalls).toHaveLength(0);

      const c = setup([ask("cut", fast)]);
      await stepScene(c.fake, config(), { ...onAir(), paused: { since: NOW - 1, remainingMs: 5_000 } } as SceneRunner, NOW, c.deps);
      expect(c.cutCalls).toHaveLength(0);
    });

    it("a viewer cut on a next-shot channel still waits for the boundary", async () => {
      const { fake, deps, cutCalls } = setup([ask("cut", paced)]);
      await stepScene(fake, config(), onAir(), NOW, deps);
      expect(cutCalls).toHaveLength(0);
    });

    it("an operator's queued request goes before a viewer's at the same shot change", async () => {
      const v = ask("queue", { ...paced, everyS: 0 }, { createdAt: NOW - 900 });
      const o = command({ op: "queue", target: { type: "segment", id: "storm:op" } });
      const { queue, fake, deps, cutCalls } = setup([v, o]);
      await stepScene(fake, config(), { ...onAir(), endsAt: NOW }, NOW, deps);
      expect(cutCalls[0].meta.command.source).toBe("operator");
      expect(queue.rows.find((c) => c.id === v.id)!.status).toBe("queued");
    });

    it("a refused viewer request falls through to rotation with its reason logged", async () => {
      const { queue, fake, deps, cutCalls } = setup([ask("queue", paced)], null);
      await stepScene(fake, config(), { ...onAir(), endsAt: NOW }, NOW, deps);
      expect(queue.rows[0]).toMatchObject({ status: "refused", note: "no quake in the pool" });
      expect(cutCalls.map((c) => c.next.id)).toEqual(["storm:rotation"]);
    });
  });
});

describe("stepScene — break-ins", () => {
  const NOW = 20_000_000;
  const immediate = (over: Record<string, unknown> = {}) =>
    config({ breakIn: { interrupt: "immediate", guardSeconds: 6, cooldownSeconds: 120, clusterMin: 3, ...over } });
  let n = 0;
  const fresh = (over: Partial<FreshEvent> = {}): FreshEvent => {
    const id = `storm:nws:b${++n}`;
    return { reason: "storm", at: NOW - 30_000, severityRank: 4, segmentId: id, key: id, score: 98, title: id, ...over };
  };
  const onAir = (): SceneRunner => ({
    ...newRunner("s1"),
    seq: 4,
    runId: "run-1",
    current: seg("country:uk"),
    startedAt: NOW - 20_000,
    endsAt: NOW + 30_000,
  });
  const setup = (ring: FreshEvent[]) => {
    const cutCalls: { next: Segment; meta: any }[] = [];
    const fake = {
      directorCommands: memoryQueue([]),
      airLog: { addQueueDrops: jest.fn(async () => undefined) },
    } as unknown as AppDb;
    const deps: StepDeps = {
      pick: jest.fn(async () => ({ next: seg("ocean:rotation"), pool: [], breaking: false })),
      cut: jest.fn(async (r: SceneRunner, next: Segment, meta: any) => {
        cutCalls.push({ next, meta });
        r.seq += 1;
        r.current = next;
        r.startedAt = meta.now;
        r.endsAt = meta.now + next.holdMs;
        r.lastCutWasPriority = meta.breaking;
        if (next.breakIn) r.lastBreakInAt = meta.now;
        r.seen.set(next.id, { count: 1, last: meta.now });
      }) as any,
      resolve: jest.fn(async (_db: unknown, _cfg: unknown, _r: unknown, t: any) => ({ segment: seg(t.id ?? `${t.kind}:picked`) })) as any,
      emit: jest.fn(),
      fresh: { ensureStarted: jest.fn(), since: () => ring },
    };
    return { fake, deps, cutCalls };
  };

  it("leaves the watch alone in boundary mode", async () => {
    const { fake, deps } = setup([fresh()]);
    await stepScene(fake, config(), onAir(), NOW, deps);
    expect(deps.fresh.ensureStarted).not.toHaveBeenCalled();
    expect(deps.cut).not.toHaveBeenCalled();
  });

  it("interrupts the running shot for a qualifying fresh event, with the INCOMING pre-roll", async () => {
    const ev = fresh();
    const { fake, deps, cutCalls } = setup([ev]);
    const r = onAir();
    await stepScene(fake, immediate(), r, NOW, deps);
    expect(deps.fresh.ensureStarted).toHaveBeenCalled();
    expect(cutCalls).toHaveLength(1);
    expect(cutCalls[0].next).toMatchObject({ id: ev.segmentId, breakIn: { reason: "storm", interrupted: true }, incomingMs: 4000 });
    expect(cutCalls[0].meta).toMatchObject({ breaking: true, skipRequested: true });
    expect(r.handled.has(ev.key)).toBe(true);
    expect(r.pending).toEqual([]);
  });

  it("queues a burst below the group size and drains it, never dropping one", async () => {
    const a = fresh({ score: 99 });
    const b = fresh({ score: 98 });
    const { fake, deps, cutCalls } = setup([a, b]);
    const r = onAir();
    await stepScene(fake, immediate(), r, NOW, deps);
    expect(cutCalls.map((c) => c.next.id)).toEqual([a.segmentId]);
    expect(r.pending.map((p) => p.key)).toEqual([b.key]);
    // Mid-shot, inside the cooldown: no second interrupt.
    await stepScene(fake, immediate(), r, NOW + 10_000, deps);
    expect(cutCalls).toHaveLength(1);
    // One normal cut first (the priority cooldown), then the next shot change drains it.
    r.endsAt = NOW + 20_000;
    await stepScene(fake, immediate(), r, NOW + 20_000, deps);
    expect(cutCalls.map((c) => c.next.id)).toEqual([a.segmentId, "ocean:rotation"]);
    r.endsAt = NOW + 40_000;
    await stepScene(fake, immediate(), r, NOW + 40_000, deps);
    expect(cutCalls[2].next).toMatchObject({ id: b.segmentId, breakIn: { interrupted: false } });
    expect(r.pending).toEqual([]);
  });

  it("airs a burst of the group size as one cut naming them all", async () => {
    const burst = [fresh(), fresh(), fresh()];
    const { fake, deps, cutCalls } = setup(burst);
    await stepScene(fake, immediate(), onAir(), NOW, deps);
    expect(cutCalls).toHaveLength(1);
    expect(cutCalls[0].next.breakIn?.items).toHaveLength(3);
    expect(cutCalls[0].next.title).toBe("3 NEW EXTREME WARNINGS");
  });

  it("doesn't break in while paused", async () => {
    const { fake, deps } = setup([fresh()]);
    const r = { ...onAir(), paused: { since: NOW - 1, remainingMs: 5_000 } };
    await stepScene(fake, immediate(), r, NOW, deps);
    expect(deps.cut).not.toHaveBeenCalled();
  });

  it("records events that leave the queue without airing", async () => {
    const { fake, deps } = setup([]);
    const r = onAir();
    r.pending = [{ ...fresh({ at: NOW - 30 * 60_000 }), queuedAt: NOW - 30 * 60_000 }];
    const key = r.pending[0].key;
    await stepScene(fake, immediate(), r, NOW, deps);
    expect(r.pending).toEqual([]);
    expect(r.handled.has(key)).toBe(true);
    expect((fake.airLog as any).addQueueDrops).toHaveBeenCalledWith("run-1", 1);
  });

  it("an operator's queued request beats a break-in at the shot change; a viewer's waits behind it", async () => {
    const ev = fresh();
    const { fake, deps, cutCalls } = setup([ev]);
    const viewer = {
      id: "v1",
      sceneId: "s1",
      source: { kind: "viewer" as const, platform: "youtube" as const, author: "ann" },
      cmd: { op: "queue" as const, target: { type: "kind" as const, kind: "volcano" as const } },
      status: "queued" as const,
      createdAt: NOW - 1,
      expiresAt: NOW + 600_000,
    };
    (fake as any).directorCommands = memoryQueue([viewer]);
    const r = { ...onAir(), startedAt: NOW - 1_000, endsAt: NOW };
    await stepScene(fake, immediate(), r, NOW, deps);
    expect(cutCalls[0].next.id).toBe(ev.segmentId);

    const op = { ...viewer, id: "o1", source: { kind: "operator" as const, user: "op" } };
    const second = setup([fresh()]);
    (second.fake as any).directorCommands = memoryQueue([op]);
    await stepScene(second.fake, immediate(), { ...onAir(), endsAt: NOW }, NOW, second.deps);
    expect(second.cutCalls[0].meta.command).toEqual({ source: "operator", author: "op" });
  });

  it("a boundary-mode channel drains only round-ups from the queue, at a shot change", async () => {
    const roundup: FreshEvent = { reason: "roundup", at: NOW - 60_000, placeKind: "world", segmentId: "global:w1", key: "roundup:w1", score: 8, title: "World round-up" };
    const quake: FreshEvent = { reason: "quake", at: NOW - 60_000, mag: 7, segmentId: "quake:q", key: "quake:q", score: 110, title: "M7" };
    const { fake, deps, cutCalls } = setup([roundup, quake]);
    const boundary = config({ breakIn: { reasons: { quake: true, storm: true, volcano: true, roundup: true }, worldRoundup: true } });
    const r = onAir();
    await stepScene(fake, boundary, r, NOW, deps);
    expect(deps.fresh.ensureStarted).toHaveBeenCalled();
    expect(cutCalls).toHaveLength(0); // never interrupts
    r.endsAt = NOW;
    await stepScene(fake, boundary, r, NOW, deps);
    expect(cutCalls.map((c) => c.next.id)).toEqual(["global:w1"]);
  });
});
