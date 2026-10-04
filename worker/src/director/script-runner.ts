/**
 * The script runner (docs/short-video-plan.md §3): plays a saved ShortScript on
 * a scene, clip by clip, then stops. A scene's director config with
 * `mode: "script"` and a `script.playNonce` the runner hasn't handled starts a
 * play — the same Mongo-polled trigger pattern as `skipNonce`, so the editor
 * (public) and the render job (worker) start a play the same way.
 *
 * Deliberately NOT a branch of the auto loop (loop.ts): that tick is held up by
 * slow candidate-pool builds, and a script must cut on time. This runs its own
 * 250 ms clock, polls Mongo about once a second, and cuts on an ABSOLUTE
 * schedule — clip i at `t0 + sum(earlier durations)` — so lateness never
 * accumulates and the video's length is exact to one tick.
 *
 * `step(state, now, deps)` is the whole runner with no timers; the interval at
 * the bottom is a thin shell around it (tests drive `step` directly).
 */
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig, DirectorScriptPlay, Segment } from "@photonsurge/shared/director";
import { playFor, scriptDurationMs, type ShortClip, type ShortScriptPlay } from "@photonsurge/shared/short-script";
import { log } from "@photonsurge/shared/utill/logger";
import { airLogSceneOff } from "./airlog";
import { type SceneRunner, newRunner, emit, emitInactive, performCut } from "./cut";
import { focusOf, type UpNextEntry } from "./upnext";
import { resolveClip, type ClipResolution } from "./script-resolve";

const TAG = "director:script";
/** Cut-time check cadence — in-memory only, so a cut is at most this late. */
export const SCRIPT_TICK_MS = 250;
/** How often Mongo is polled for script-mode scenes and their configs. */
export const SCRIPT_POLL_MS = 1000;
/** Re-emit the current clip at least this often so late joiners sync (as loop.ts). */
export const SCRIPT_HEARTBEAT_MS = 2500;
/** How many upcoming clips the "coming up" rail shows. */
const UP_NEXT_COUNT = 3;

/** One resolved clip on the play's schedule. */
interface ScheduledClip {
  clip: ShortClip;
  segment: Segment;
  /** Offset from the play's t0, ms. */
  startMs: number;
}

/** A script playing on one scene. */
export interface ScriptPlay {
  sceneId: string;
  scriptId: string;
  playNonce: number;
  record: boolean;
  cfg: DirectorConfig;
  t0: number;
  clips: ScheduledClip[];
  /** Index of the next clip to cut (clips.length once the last has aired). */
  next: number;
  runner: SceneRunner;
  /** What gets stamped on the script as this scene's entry in `plays`. */
  playRecord: ShortScriptPlay;
}

export interface ScriptRunnerState {
  plays: Map<string, ScriptPlay>;
  /** Last `playNonce` acted on, per scene. Absent = never seen since boot. */
  handled: Map<string, number>;
  lastPollAt: number;
}

export interface ScriptRunnerDeps {
  db: AppDb;
  resolve: (db: AppDb, cfg: DirectorConfig, clip: ShortClip, now: number) => Promise<ClipResolution>;
}

/**
 * Told whenever a play ends — finished, stopped, cut by a restart, or with
 * nothing to play — so a video render can end its run (stream/script-run.ts,
 * short-video plan §6.5 step 3). Registered at boot (index.ts) rather than
 * imported, so the runner stays free of the run pipeline. Fire-and-forget: a
 * slow or failing hook never delays a cut.
 */
export type ScriptPlayEndedHook = (sceneId: string, play: ShortScriptPlay) => unknown;
let playEndedHook: ScriptPlayEndedHook | null = null;

export function setScriptPlayEndedHook(hook: ScriptPlayEndedHook | null): void {
  playEndedHook = hook;
}

function notifyPlayEnded(sceneId: string, play: ShortScriptPlay): void {
  const hook = playEndedHook;
  if (!hook) return;
  const copy: ShortScriptPlay = { ...play, clips: [...play.clips], skipped: [...play.skipped] };
  void Promise.resolve()
    .then(() => hook(sceneId, copy))
    .catch((err) => log(TAG, `play-ended hook failed`, { sceneId, err: String(err) }));
}

export const newScriptRunnerState = (): ScriptRunnerState => ({
  plays: new Map(),
  handled: new Map(),
  lastPollAt: -Infinity,
});

/** Best-effort write of the scene's play record (its entry in the script's
 *  `plays`) — a Mongo hiccup must never stall the show. */
async function stamp(db: AppDb, scriptId: string, play: ShortScriptPlay): Promise<void> {
  try {
    await db.shortScripts.stampPlay(scriptId, { ...play });
  } catch (err) {
    log(TAG, `play stamp failed`, { scriptId, sceneId: play.sceneId, err: String(err) });
  }
}

/**
 * Hand the scene back to "off" through the normal save path (so
 * mergeDirectorConfig's rules apply) — but only if it is still in script mode
 * on the nonce we answered: an operator who started another play in the
 * meantime must not be switched off.
 */
async function setModeOff(db: AppDb, sceneId: string, playNonce: number): Promise<void> {
  try {
    const cfg = await db.getOrInitDirectorConfig(sceneId);
    if (cfg.mode !== "script" || (cfg.script?.playNonce ?? 0) !== playNonce) return;
    await db.saveDirectorConfig(sceneId, { mode: "off" });
  } catch (err) {
    log(TAG, `mode off failed`, { sceneId, err: String(err) });
  }
}

/** The "coming up" rail: the next few real clips, with focus params so /watch
 *  pre-warms their bundles. */
function upNextAfter(play: ScriptPlay, index: number): UpNextEntry[] {
  return play.clips.slice(index + 1, index + 1 + UP_NEXT_COUNT).map(({ segment }) => ({
    kind: segment.kind,
    title: segment.title,
    subtitle: segment.subtitle,
    ...focusOf(segment),
  }));
}

/** Close a play that didn't run to its end: as-run closed, play record stamped
 *  stopped. `inactive` emits the stand-down (skipped when something else is
 *  about to cut on the scene). */
async function stopPlay(state: ScriptRunnerState, play: ScriptPlay, now: number, deps: ScriptRunnerDeps, inactive: boolean): Promise<void> {
  state.plays.delete(play.sceneId);
  if (inactive) emitInactive(play.sceneId);
  await airLogSceneOff(deps.db, play.runner.runId, now);
  play.playRecord.endedAt = now;
  play.playRecord.stopped = true;
  await stamp(deps.db, play.scriptId, play.playRecord);
  notifyPlayEnded(play.sceneId, play.playRecord);
  log(TAG, `play stopped`, { sceneId: play.sceneId, scriptId: play.scriptId, playNonce: play.playNonce });
}

/** The last clip has run its course: stand down, close the as-run, scene off. */
async function finishPlay(state: ScriptRunnerState, play: ScriptPlay, now: number, deps: ScriptRunnerDeps): Promise<void> {
  state.plays.delete(play.sceneId);
  emitInactive(play.sceneId);
  await airLogSceneOff(deps.db, play.runner.runId, now);
  play.playRecord.endedAt = now;
  await stamp(deps.db, play.scriptId, play.playRecord);
  await setModeOff(deps.db, play.sceneId, play.playNonce);
  notifyPlayEnded(play.sceneId, play.playRecord);
  log(TAG, `play finished`, { sceneId: play.sceneId, scriptId: play.scriptId, playNonce: play.playNonce });
}

/**
 * Start a play: load the script, resolve every clip from `fromClip` onward up
 * front, drop the skipped ones and lay the rest out back to back from `now`.
 * Nothing to play (missing script, every clip skipped) ends at once — mode off,
 * and a play record that says why when there is a script to stamp it on.
 */
async function startPlay(
  state: ScriptRunnerState,
  sceneId: string,
  cfg: DirectorConfig,
  trigger: DirectorScriptPlay,
  now: number,
  deps: ScriptRunnerDeps,
): Promise<void> {
  const { db } = deps;
  const script = await db.shortScripts.get(trigger.scriptId);
  if (!script) {
    log(TAG, `script not found`, { sceneId, scriptId: trigger.scriptId });
    emitInactive(sceneId);
    await setModeOff(db, sceneId, trigger.playNonce);
    notifyPlayEnded(sceneId, {
      sceneId,
      playNonce: trigger.playNonce,
      startedAt: now,
      endedAt: now,
      stopped: true,
      clips: [],
      skipped: [{ id: "", reason: `script ${trigger.scriptId} not found` }],
    });
    return;
  }

  const clips: ScheduledClip[] = [];
  const skipped: ShortScriptPlay["skipped"] = [];
  let t = 0;
  for (const clip of script.clips.slice(Math.max(0, trigger.fromClip))) {
    const res = await deps.resolve(db, cfg, clip, now);
    if ("skipped" in res) {
      skipped.push({ id: clip.id, reason: res.skipped });
      continue;
    }
    clips.push({ clip, segment: res.segment, startMs: t });
    t += clip.durationMs;
  }

  const playRecord: ShortScriptPlay = {
    sceneId,
    playNonce: trigger.playNonce,
    startedAt: now,
    clips: clips.map((c) => ({ id: c.clip.id, startMs: c.startMs, durationMs: c.clip.durationMs })),
    skipped,
  };

  if (!clips.length) {
    playRecord.endedAt = now;
    await stamp(db, script.id, playRecord);
    emitInactive(sceneId);
    await setModeOff(db, sceneId, trigger.playNonce);
    notifyPlayEnded(sceneId, playRecord);
    log(TAG, `nothing to play`, { sceneId, scriptId: script.id, skipped: skipped.length });
    return;
  }

  state.plays.set(sceneId, {
    sceneId,
    scriptId: script.id,
    playNonce: trigger.playNonce,
    record: trigger.record,
    cfg,
    t0: now,
    clips,
    next: 0,
    runner: newRunner(sceneId),
    playRecord,
  });
  await stamp(db, script.id, playRecord);
  log(TAG, `play started`, { sceneId, scriptId: script.id, playNonce: trigger.playNonce, clips: clips.length, skipped: skipped.length });
}

/**
 * First sight of a script-mode scene since boot, on a nonce THIS scene's play
 * record on the script already answered: the worker restarted mid-play (or
 * after it). Don't play it again — close the record and hand the scene back.
 * Another scene's record never counts, even on an equal nonce.
 */
async function settleAfterRestart(sceneId: string, trigger: DirectorScriptPlay, now: number, deps: ScriptRunnerDeps): Promise<boolean> {
  const script = await deps.db.shortScripts.get(trigger.scriptId);
  const prior = script ? playFor(script, sceneId) : undefined;
  if (!script || !prior || prior.playNonce !== trigger.playNonce) return false;
  if (prior.endedAt == null) {
    const closed = { ...prior, endedAt: now, stopped: true };
    await stamp(deps.db, script.id, closed);
    notifyPlayEnded(sceneId, closed);
  }
  await setModeOff(deps.db, sceneId, trigger.playNonce);
  log(TAG, `play already answered before restart — not replaying`, { sceneId, scriptId: script.id, playNonce: trigger.playNonce });
  return true;
}

/** Mongo side of a step: start, restart and stop plays to match the configs. */
async function poll(state: ScriptRunnerState, now: number, deps: ScriptRunnerDeps): Promise<void> {
  const { db } = deps;
  const scenes = await db.scriptDirectorScenes();
  const inScript = new Set(scenes);

  // Scenes that left script mode mid-play. A scene switched straight to auto
  // gets no stand-down: the auto loop's first cut would race it.
  const leaving = [...state.plays.values()].filter((p) => !inScript.has(p.sceneId));
  if (leaving.length) {
    const autoSet = new Set(await db.autoDirectorScenes());
    for (const play of leaving) await stopPlay(state, play, now, deps, !autoSet.has(play.sceneId));
  }

  for (const sceneId of scenes) {
    try {
      const cfg = await db.getOrInitDirectorConfig(sceneId);
      const trigger = cfg.script;
      const play = state.plays.get(sceneId);
      if (play) play.cfg = cfg;
      if (!trigger) {
        // Script mode with nothing to play — hand the scene back.
        if (!play) await db.saveDirectorConfig(sceneId, { mode: "off" });
        continue;
      }
      const handled = state.handled.get(sceneId);
      if (handled === trigger.playNonce) {
        // Already answered and no longer playing, yet still in script mode
        // (a mode-off write that failed) — retry handing it back.
        if (!play) await setModeOff(db, sceneId, trigger.playNonce);
        continue;
      }
      state.handled.set(sceneId, trigger.playNonce);
      if (handled === undefined && !play && (await settleAfterRestart(sceneId, trigger, now, deps))) continue;
      // A new nonce while playing restarts from the new point; the old play
      // is closed as stopped, with no stand-down (the new first cut follows).
      if (play) await stopPlay(state, play, now, deps, false);
      await startPlay(state, sceneId, cfg, trigger, now, deps);
    } catch (err) {
      log(TAG, `scene poll failed`, { sceneId, err: String(err) });
    }
  }
}

/** In-memory side of a step: cut whatever is due, heartbeat, finish. */
async function advance(state: ScriptRunnerState, now: number, deps: ScriptRunnerDeps): Promise<void> {
  for (const play of [...state.plays.values()]) {
    try {
      if (now >= play.t0 + scriptDurationMs(play.clips.map((c) => c.clip))) {
        await finishPlay(state, play, now, deps);
        continue;
      }
      // The latest clip whose start has passed. A stall longer than a whole
      // clip skips straight past it rather than flashing it on for no time.
      let due = -1;
      for (let i = play.next; i < play.clips.length && now >= play.t0 + play.clips[i].startMs; i++) due = i;
      if (due >= 0) {
        const sc = play.clips[due];
        const hadRun = play.runner.runId;
        // Cut at the SCHEDULED instant, not the tick that noticed it: startedAt,
        // endsAt and spinEpoch stay on the absolute grid, so endsAt is exactly
        // the next clip's start and lateness never accumulates.
        await performCut(play.runner, sc.segment, [], {
          db: deps.db,
          cfg: play.cfg,
          now: play.t0 + sc.startMs,
          upNext: upNextAfter(play, due),
          record: play.record,
        });
        play.next = due + 1;
        // The as-run run opens on the first recorded cut — note it on the record.
        if (play.runner.runId && play.runner.runId !== hadRun) {
          play.playRecord.runId = play.runner.runId;
          await stamp(deps.db, play.scriptId, play.playRecord);
        }
      } else if (play.runner.current && now - play.runner.lastEmit >= SCRIPT_HEARTBEAT_MS) {
        emit(play.runner, now);
      }
    } catch (err) {
      log(TAG, `advance failed`, { sceneId: play.sceneId, err: String(err) });
    }
  }
}

/**
 * One runner step: poll Mongo when a poll is due, then cut / heartbeat /
 * finish from memory. Never throws.
 */
export async function step(state: ScriptRunnerState, now: number, deps: ScriptRunnerDeps): Promise<void> {
  if (now - state.lastPollAt >= SCRIPT_POLL_MS) {
    state.lastPollAt = now;
    try {
      await poll(state, now, deps);
    } catch (err) {
      log(TAG, `poll failed`, String(err));
    }
  }
  await advance(state, now, deps);
}

let state = newScriptRunnerState();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return; // a slow poll must never overlap the next tick
  ticking = true;
  try {
    const db = await getAppDb();
    await step(state, Date.now(), { db, resolve: resolveClip });
  } catch (err) {
    log(TAG, `tick failed`, String(err));
  } finally {
    ticking = false;
  }
}

/** Start the script runner. Idempotent. */
export function startScriptRunner(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), SCRIPT_TICK_MS);
  log(TAG, `started`, { tickMs: SCRIPT_TICK_MS, pollMs: SCRIPT_POLL_MS });
}

/** Stop the script runner. Idempotent. A play in flight is left unstamped;
 *  the next boot's restart guard closes it as stopped. */
export function stopScriptRunner(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state = newScriptRunnerState();
}
