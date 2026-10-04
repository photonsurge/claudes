jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

import { emitWorkerEvent } from "../socket";
import { step, newScriptRunnerState, SCRIPT_HEARTBEAT_MS, type ScriptRunnerDeps } from "./script-runner";
import {
  DEFAULT_DIRECTOR_CONFIG,
  mergeDirectorConfig,
  type DirectorConfig,
  type DirectorState,
  type Segment,
} from "@photonsurge/shared/director";
import { playFor, type ShortClip, type ShortScript, type ShortScriptPlay } from "@photonsurge/shared/short-script";
import type { AppDb } from "@photonsurge/shared/db/index";

const emitted = emitWorkerEvent as jest.Mock;
/** Every director:state the runner emitted, in order. */
const states = (): DirectorState[] => emitted.mock.calls.map((c) => c[0].data);
/** The cuts among them — active states minus heartbeats (a repeat of the state before). */
const cuts = () =>
  states().filter((s, i, all) => s.active && !(i > 0 && all[i - 1].seq === s.seq && all[i - 1].startedAt === s.startedAt));
const lastState = () => states()[states().length - 1];

const T0 = 1_000_000;
const SCENE = "shorts-preview";

const clip = (id: string, durationMs: number, target = `quake:${id}`): ShortClip => ({ id, target, durationMs, label: { title: id } });

const script = (clips: ShortClip[], over: Partial<ShortScript> = {}): ShortScript => ({
  id: "s1",
  template: "lineup",
  scope: { type: "globe" },
  include: { alerts: true, quakes: true, volcanoes: true },
  title: "Test short",
  clips,
  status: "ready",
  ...over,
});

/**
 * Stateful fake: director configs per scene (saved through mergeDirectorConfig
 * like the real save path), scripts with their per-scene play records, the as-run log.
 */
function fakeDb(opts: { scripts?: ShortScript[]; configs?: Record<string, Partial<DirectorConfig>> } = {}) {
  const configs = new Map<string, DirectorConfig>();
  for (const [id, c] of Object.entries(opts.configs ?? {})) configs.set(id, mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, c));
  const scripts = new Map((opts.scripts ?? []).map((s) => [s.id, s]));
  const stamps: ShortScriptPlay[] = [];
  let runs = 0;
  const db = {
    scriptDirectorScenes: jest.fn(async () => [...configs].filter(([, c]) => c.mode === "script").map(([id]) => id)),
    autoDirectorScenes: jest.fn(async () => [...configs].filter(([, c]) => c.mode === "auto").map(([id]) => id)),
    getOrInitDirectorConfig: jest.fn(async (id: string) => configs.get(id) ?? DEFAULT_DIRECTOR_CONFIG),
    saveDirectorConfig: jest.fn(async (id: string, patch: Partial<DirectorConfig>) => {
      const merged = mergeDirectorConfig(configs.get(id) ?? DEFAULT_DIRECTOR_CONFIG, patch);
      configs.set(id, merged);
      return merged;
    }),
    shortScripts: {
      get: jest.fn(async (id: string) => scripts.get(id) ?? null),
      // As the repo: replace this scene's entry, leave the others alone.
      stampPlay: jest.fn(async (id: string, play: ShortScriptPlay) => {
        const s = scripts.get(id);
        if (!s) return false;
        const copy: ShortScriptPlay = JSON.parse(JSON.stringify(play));
        s.plays = [...(s.plays ?? []).filter((p) => p.sceneId !== copy.sceneId), copy];
        stamps.push(copy);
        return true;
      }),
    },
    airLog: {
      startRun: jest.fn(async () => `run${++runs}`),
      recordCut: jest.fn(async () => undefined),
      endRun: jest.fn(async () => undefined),
    },
    ads: { markShown: jest.fn(), recordImpression: jest.fn() },
  };
  /** The script's play record for `sceneId` (default the test scene). */
  const rec = (scriptId = "s1", sceneId = SCENE) => playFor(scripts.get(scriptId)!, sceneId);
  return { db, configs, scripts, stamps, rec, appDb: db as unknown as AppDb };
}

/** Resolver stand-in: `quake:dead*` targets are skipped, everything else builds. */
const resolve: ScriptRunnerDeps["resolve"] = jest.fn(async (_db, _cfg, c: ShortClip) => {
  if (c.target.includes("dead")) return { skipped: "quake is older than the live window" };
  const seg: Segment = {
    id: c.target,
    kind: "quake",
    title: `T ${c.id}`,
    camera: { center: [Number(c.id.replace(/\D/g, "")) || 0, 10], zoom: 5 },
    patch: {},
    holdMs: c.durationMs,
  };
  return { segment: seg };
});

const play = (scriptId: string, playNonce: number, over: Partial<{ fromClip: number; record: boolean }> = {}) => ({
  mode: "script" as const,
  script: { scriptId, fromClip: over.fromClip ?? 0, playNonce, record: over.record ?? true },
});

function harness(fake: ReturnType<typeof fakeDb>) {
  const state = newScriptRunnerState();
  const deps: ScriptRunnerDeps = { db: fake.appDb, resolve };
  return { state, at: (now: number) => step(state, now, deps) };
}

beforeEach(() => {
  emitted.mockClear();
  (resolve as jest.Mock).mockClear();
});

const THREE = [clip("a1", 10_000), clip("a2", 5_000), clip("a3", 8_000)];

describe("script runner — schedule", () => {
  it("starts on the trigger, resolves every clip up front and cuts the first at t0", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(cuts()).toHaveLength(1);
    expect(lastState()).toMatchObject({ sceneId: SCENE, seq: 1, active: true, startedAt: T0, endsAt: T0 + 10_000 });
    expect(lastState().segment?.id).toBe("quake:a1");
  });

  it("cuts on an absolute schedule — a late tick does not push later cuts back", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await at(T0 + 9_750); // not yet due
    expect(cuts()).toHaveLength(1);
    await at(T0 + 10_400); // 400 ms late
    expect(cuts()).toHaveLength(2);
    // Stamped on the grid, not at the late tick.
    expect(lastState()).toMatchObject({ seq: 2, startedAt: T0 + 10_000, endsAt: T0 + 15_000 });
    await at(T0 + 15_000); // clip 3 exactly on time despite clip 2 being noticed late
    expect(lastState()).toMatchObject({ seq: 3, startedAt: T0 + 15_000, endsAt: T0 + 23_000 });
  });

  it("stamps spinEpoch on the schedule grid", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await at(T0 + 10_200);
    expect(lastState().segment?.patch.spinEpoch).toBe(T0 + 10_000);
  });

  it("starts from fromClip", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1, { fromClip: 1 }) } });
    const { at } = harness(fake);
    await at(T0);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(lastState().segment?.id).toBe("quake:a2");
    expect(fake.stamps[0].clips).toEqual([
      { id: "a2", startMs: 0, durationMs: 5_000 },
      { id: "a3", startMs: 5_000, durationMs: 8_000 },
    ]);
  });

  it("drops skipped clips and closes the gap", async () => {
    const clips = [clip("a1", 10_000), clip("dead1", 7_000, "quake:dead1"), clip("a3", 8_000)];
    const fake = fakeDb({ scripts: [script(clips)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await at(T0 + 10_000);
    expect(lastState().segment?.id).toBe("quake:a3");
    expect(lastState()).toMatchObject({ startedAt: T0 + 10_000, endsAt: T0 + 18_000 });
    expect(fake.stamps[0]).toMatchObject({
      sceneId: SCENE,
      playNonce: 1,
      startedAt: T0,
      clips: [
        { id: "a1", startMs: 0, durationMs: 10_000 },
        { id: "a3", startMs: 10_000, durationMs: 8_000 },
      ],
      skipped: [{ id: "dead1", reason: "quake is older than the live window" }],
    });
  });

  it("passes an explicit upNext: the next three real clips with focus params", async () => {
    const clips = [clip("a1", 1_000), clip("dead", 1_000, "quake:dead"), clip("a2", 1_000), clip("a3", 1_000), clip("a4", 1_000), clip("a5", 1_000)];
    const fake = fakeDb({ scripts: [script(clips)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    expect(lastState().upNext).toEqual([
      { kind: "quake", title: "T a2", subtitle: undefined, center: [2, 10], zoom: 5, subject: "a2" },
      { kind: "quake", title: "T a3", subtitle: undefined, center: [3, 10], zoom: 5, subject: "a3" },
      { kind: "quake", title: "T a4", subtitle: undefined, center: [4, 10], zoom: 5, subject: "a4" },
    ]);
    await at(T0 + 3_000); // a4 (the 4th real clip) is on: only a5 left to come
    expect(lastState().segment?.id).toBe("quake:a4");
    expect(lastState().upNext.map((u) => u.subject)).toEqual(["a5"]);
  });

  it("heartbeats the current clip every 2.5 s between cuts", async () => {
    const fake = fakeDb({ scripts: [script([clip("a1", 20_000)])], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await at(T0 + 2_000);
    expect(states()).toHaveLength(1);
    await at(T0 + SCRIPT_HEARTBEAT_MS);
    expect(states()).toHaveLength(2);
    expect(states()[1]).toMatchObject({ seq: 1, active: true, startedAt: T0 });
    await at(T0 + SCRIPT_HEARTBEAT_MS + 1_000);
    expect(states()).toHaveLength(2);
  });
});

describe("script runner — end of script", () => {
  it("emits inactive, closes the as-run run, sets mode off and stamps endedAt", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { state, at } = harness(fake);
    await at(T0);
    await at(T0 + 10_000);
    await at(T0 + 15_000);
    await at(T0 + 22_900);
    expect(fake.configs.get(SCENE)!.mode).toBe("script");
    await at(T0 + 23_000);
    expect(lastState()).toMatchObject({ sceneId: SCENE, active: false });
    expect(fake.db.airLog.endRun).toHaveBeenCalledWith("run1", new Date(T0 + 23_000));
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
    expect(fake.rec()).toMatchObject({ playNonce: 1, startedAt: T0, endedAt: T0 + 23_000, runId: "run1" });
    expect(fake.rec()!.stopped).toBeUndefined();
    expect(state.plays.size).toBe(0);
    // Nothing replays on later polls.
    await at(T0 + 30_000);
    expect(cuts()).toHaveLength(3);
  });

  it("records every cut under one as-run run when record is on", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await at(T0 + 10_000);
    expect(fake.db.airLog.startRun).toHaveBeenCalledTimes(1);
    expect(fake.db.airLog.recordCut).toHaveBeenCalledTimes(2);
    expect(fake.rec()!.runId).toBe("run1");
  });

  it("writes no as-run when record is false", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1, { record: false }) } });
    const { at } = harness(fake);
    for (const t of [0, 10_000, 15_000, 23_000]) await at(T0 + t);
    expect(cuts()).toHaveLength(3);
    expect(fake.db.airLog.startRun).not.toHaveBeenCalled();
    expect(fake.db.airLog.recordCut).not.toHaveBeenCalled();
    expect(fake.db.airLog.endRun).not.toHaveBeenCalled();
    expect(fake.rec()!.runId).toBeUndefined();
    expect(fake.rec()!.endedAt).toBe(T0 + 23_000);
  });

  it("doesn't switch off a scene the operator re-triggered meanwhile", async () => {
    const fake = fakeDb({ scripts: [script([clip("a1", 1_500)])], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await at(T0 + 1_000); // last poll before the end
    // Re-triggered after that poll; the end (T0+1.5s) lands before the next poll.
    await fake.db.saveDirectorConfig(SCENE, { script: { scriptId: "s1", fromClip: 0, playNonce: 2, record: true } });
    await at(T0 + 1_500);
    expect(lastState()).toMatchObject({ active: false });
    expect(fake.configs.get(SCENE)!.mode).toBe("script");
    await at(T0 + 2_000); // ...and the next poll starts the new play
    expect(lastState()).toMatchObject({ active: true, startedAt: T0 + 2_000 });
  });
});

describe("script runner — stop and restart", () => {
  it("stops mid-play when the scene leaves script mode", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { state, at } = harness(fake);
    await at(T0);
    await fake.db.saveDirectorConfig(SCENE, { mode: "off" });
    await at(T0 + 4_000);
    expect(lastState()).toMatchObject({ sceneId: SCENE, active: false });
    expect(fake.db.airLog.endRun).toHaveBeenCalledWith("run1", new Date(T0 + 4_000));
    expect(fake.rec()).toMatchObject({ endedAt: T0 + 4_000, stopped: true });
    expect(state.plays.size).toBe(0);
    await at(T0 + 10_000);
    expect(cuts()).toHaveLength(1);
  });

  it("emits no stand-down when the scene leaves straight for auto", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await fake.db.saveDirectorConfig(SCENE, { mode: "auto" });
    await at(T0 + 4_000);
    expect(states().some((s) => !s.active)).toBe(false);
    expect(fake.rec()).toMatchObject({ stopped: true });
  });

  it("restarts from the new fromClip on a higher nonce, stamping the old play stopped", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    await at(T0);
    await fake.db.saveDirectorConfig(SCENE, { script: { scriptId: "s1", fromClip: 2, playNonce: 2, record: true } });
    await at(T0 + 3_000);
    // The stopped stamp of play 1, then play 2's start.
    expect(fake.stamps.find((s) => s.playNonce === 1 && s.stopped)).toMatchObject({ endedAt: T0 + 3_000 });
    expect(fake.db.airLog.endRun).toHaveBeenCalledWith("run1", new Date(T0 + 3_000));
    expect(states().some((s) => !s.active)).toBe(false); // no stand-down between plays
    expect(lastState()).toMatchObject({ active: true, startedAt: T0 + 3_000, endsAt: T0 + 11_000 });
    expect(lastState().segment?.id).toBe("quake:a3");
    expect(fake.rec()).toMatchObject({ playNonce: 2, startedAt: T0 + 3_000, runId: "run2" });
    await at(T0 + 11_000);
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
  });
});

describe("script runner — nothing to play and restarts", () => {
  it("a script whose every clip is skipped ends at once, saying why", async () => {
    const clips = [clip("dead1", 5_000, "quake:dead1"), clip("dead2", 5_000, "quake:dead2")];
    const fake = fakeDb({ scripts: [script(clips)], configs: { [SCENE]: play("s1", 1) } });
    const { state, at } = harness(fake);
    await at(T0);
    expect(cuts()).toHaveLength(0);
    expect(lastState()).toMatchObject({ active: false });
    expect(fake.rec()).toEqual({
      sceneId: SCENE,
      playNonce: 1,
      startedAt: T0,
      endedAt: T0,
      clips: [],
      skipped: [
        { id: "dead1", reason: "quake is older than the live window" },
        { id: "dead2", reason: "quake is older than the live window" },
      ],
    });
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
    expect(state.plays.size).toBe(0);
  });

  it("a missing script sets the scene off without throwing", async () => {
    const fake = fakeDb({ configs: { [SCENE]: play("nope", 1) } });
    const { at } = harness(fake);
    await expect(at(T0)).resolves.toBeUndefined();
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
    expect(cuts()).toHaveLength(0);
  });

  it("a fromClip past the end is nothing to play", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1, { fromClip: 9 }) } });
    const { at } = harness(fake);
    await at(T0);
    expect(fake.rec()).toMatchObject({ endedAt: T0, clips: [], skipped: [] });
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
  });

  it("after a worker restart, does not replay a nonce its own play record already answered — closes it as stopped", async () => {
    const prior: ShortScriptPlay = { sceneId: SCENE, playNonce: 4, startedAt: T0 - 5_000, clips: [{ id: "a1", startMs: 0, durationMs: 10_000 }], skipped: [] };
    const fake = fakeDb({ scripts: [script(THREE, { plays: [prior] })], configs: { [SCENE]: play("s1", 4) } });
    const { at } = harness(fake);
    await at(T0);
    expect(resolve).not.toHaveBeenCalled();
    expect(cuts()).toHaveLength(0);
    expect(fake.rec()).toMatchObject({ playNonce: 4, startedAt: T0 - 5_000, endedAt: T0, stopped: true });
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
  });

  it("after a restart, a finished play is left as it was", async () => {
    const prior: ShortScriptPlay = { sceneId: SCENE, playNonce: 4, startedAt: T0 - 50_000, endedAt: T0 - 20_000, clips: [], skipped: [] };
    const fake = fakeDb({ scripts: [script(THREE, { plays: [prior] })], configs: { [SCENE]: play("s1", 4) } });
    const { at } = harness(fake);
    await at(T0);
    expect(fake.db.shortScripts.stampPlay).not.toHaveBeenCalled();
    expect(fake.configs.get(SCENE)!.mode).toBe("off");
  });

  it("after a restart, a NEW nonce plays normally", async () => {
    const prior: ShortScriptPlay = { sceneId: SCENE, playNonce: 4, startedAt: T0 - 50_000, endedAt: T0 - 20_000, clips: [], skipped: [] };
    const fake = fakeDb({ scripts: [script(THREE, { plays: [prior] })], configs: { [SCENE]: play("s1", 5) } });
    const { at } = harness(fake);
    await at(T0);
    expect(cuts()).toHaveLength(1);
  });

  it("never throws out of a step when Mongo fails", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    fake.db.scriptDirectorScenes.mockRejectedValueOnce(new Error("mongo down"));
    const { at } = harness(fake);
    await expect(at(T0)).resolves.toBeUndefined();
    await at(T0 + 1_000); // next poll recovers
    expect(cuts()).toHaveLength(1);
  });

  it("polls Mongo about once a second, not every tick", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1) } });
    const { at } = harness(fake);
    for (const t of [0, 250, 500, 750]) await at(T0 + t);
    expect(fake.db.scriptDirectorScenes).toHaveBeenCalledTimes(1);
    await at(T0 + 1_000);
    expect(fake.db.scriptDirectorScenes).toHaveBeenCalledTimes(2);
  });
});

describe("script runner — one play record per scene", () => {
  const OTHER = "shorts";

  it("two scenes playing the same script keep separate records", async () => {
    const fake = fakeDb({ scripts: [script(THREE)], configs: { [SCENE]: play("s1", 1, { record: false }), [OTHER]: play("s1", 2) } });
    const { at } = harness(fake);
    await at(T0);
    await fake.db.saveDirectorConfig(SCENE, { mode: "off" });
    await at(T0 + 1_000);
    expect(fake.rec("s1", SCENE)).toMatchObject({ sceneId: SCENE, playNonce: 1, endedAt: T0 + 1_000, stopped: true });
    // The render scene's play is untouched by the preview stopping.
    expect(fake.rec("s1", OTHER)).toMatchObject({ sceneId: OTHER, playNonce: 2, startedAt: T0, runId: "run1" });
    expect(fake.rec("s1", OTHER)!.endedAt).toBeUndefined();
    expect(fake.scripts.get("s1")!.plays).toHaveLength(2);
  });

  it("after a restart, another scene's record on the same nonce doesn't block this scene's play", async () => {
    const other: ShortScriptPlay = { sceneId: OTHER, playNonce: 4, startedAt: T0 - 5_000, clips: [], skipped: [] };
    const fake = fakeDb({ scripts: [script(THREE, { plays: [other] })], configs: { [SCENE]: play("s1", 4) } });
    const { at } = harness(fake);
    await at(T0);
    expect(cuts()).toHaveLength(1);
    expect(fake.rec("s1", OTHER)).toEqual(other);
    expect(fake.rec()).toMatchObject({ playNonce: 4, startedAt: T0 });
  });

  it("nothing to play still stamps this scene's record", async () => {
    const fake = fakeDb({ scripts: [script([clip("dead1", 5_000, "quake:dead1")])], configs: { [OTHER]: play("s1", 3) } });
    const { at } = harness(fake);
    await at(T0);
    expect(fake.rec("s1", OTHER)).toMatchObject({ sceneId: OTHER, playNonce: 3, endedAt: T0, clips: [] });
    expect(fake.rec("s1", SCENE)).toBeUndefined();
  });
});
