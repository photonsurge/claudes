jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorCommand, DirectorOp } from "@photonsurge/shared/director-commands";
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

  it("takes a breaking candidate after the opener", async () => {
    const r = { ...newRunner("s1"), seq: 3 };
    const out = await pickAtBoundary(db, config(), r, builder([country, breakingQuake]));
    expect(out).toMatchObject({ next: { id: "quake:new" }, breaking: true });
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
});
