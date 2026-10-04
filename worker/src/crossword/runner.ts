/**
 * The crossword host (docs/crossword-mode-plan.md §4.4): one runner per
 * crossword scene whose config is enabled. It lays out the next puzzle, puts
 * one clue in the spotlight at a time, leaks hint letters, fills the word
 * itself when the clue time runs out, and finishes the puzzle at the ceiling,
 * so a puzzle always ends even with nobody watching.
 *
 * Like the script runner, it is NOT a branch of the director loop: it runs its
 * own 500 ms clock and polls Mongo about once a second for scenes, configs and
 * live runs. The host plays only while the scene has a live run (or the config
 * says `playOffAir`): a go-live starts a fresh puzzle on its intro card, the
 * run ending parks the game with its state kept. Paused or parked, the clock
 * freezes and every deadline moves on by the frozen time when it thaws.
 *
 * The game is saved on every change (seq bumped, `pub` rebuilt) and reloaded
 * at boot, so a worker restart resumes mid-puzzle. Every change emits the
 * public projection (`crossword:state`); a tiny `crossword:beat` goes out every
 * 5 s. Emitted events reach every browser, so only `pub` is ever emitted — it
 * carries no unsolved answer.
 *
 * `step(state, now, deps)`, `submitAnswersTo` and `commandTo` are the whole
 * runner with no timers (tests drive them on a fake clock); the interval and
 * the `submitAnswers` / `runCommand` wrappers at the bottom are a thin shell.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  applyAnswer,
  chooseNextPuzzle,
  cleanPlayerName,
  emptyGame,
  isPuzzleComplete,
  nextHint,
  revealEntry,
  withinRate,
  CROSSWORD_BEAT,
  CROSSWORD_STATE,
  type CrosswordBeat,
  type CrosswordCommand,
  type CrosswordConfig,
  type CrosswordGame,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import { startOfUtcDay, type CrosswordSolve } from "@photonsurge/shared/crossword-records";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import {
  bumpAndProject,
  loadPuzzle,
  nextSpotlightEntry,
  openPlay,
  revealAll,
  shiftDeadlines,
  spotlightOn,
  type CrosswordDb,
} from "./state";

const TAG = "crossword:runner";
/** Phase-deadline check cadence. */
export const CROSSWORD_TICK_MS = 500;
/** How often Mongo is polled for scenes, configs and live runs. */
export const CROSSWORD_POLL_MS = 1000;
/** `crossword:beat` cadence. */
export const CROSSWORD_BEAT_MS = 5000;
/** An idle scene looks for new stock this often. */
export const CROSSWORD_IDLE_CHECK_MS = 5000;

/** One runner: a crossword scene the host is running. */
export interface SceneRuntime {
  sceneId: string;
  cfg: CrosswordConfig;
  game: CrosswordGame;
  puzzle: CrosswordPuzzle | null;
  /** Puzzles loaded by this runner, by id. */
  cache: Map<string, CrosswordPuzzle>;
  /** The scene has a run in `live`. */
  live: boolean;
  /** The live run this game was started (or resumed) for; a different one is a go-live. */
  liveRunId: string | null;
  /** A live run with chat on (best effort; the chat hookup refines it). */
  inputLive: boolean;
  /** When the clock froze (paused or parked), or null while it runs. */
  frozenAt: number | null;
  today: { name: string; points: number }[];
  /** The UTC day `today` was built for. */
  todayDay: number;
  /** Accepted guess times per player, for the rate limit. */
  rate: Map<string, number[]>;
  lastBeatAt: number;
  lastIdleCheckAt: number;
  /** Serialises the tick, answers and commands on this scene. */
  lock: Promise<unknown>;
}

export interface CrosswordRunnerState {
  scenes: Map<string, SceneRuntime>;
  lastPollAt: number;
}

export interface CrosswordRunnerDeps {
  db: CrosswordDb;
  /** Worker → every browser. Only ever handed a `pub` or a beat. */
  emit: (type: string, data: unknown) => void;
}

/** One chat message as an answer (the chat hookup and the Desk's simulator). */
export interface CrosswordChatAnswer {
  /** `youtube:<authorChannelId>` or `sim:<name>`. */
  playerId: string;
  /** Raw display name; cleaned here before it airs. */
  name: string;
  text: string;
  /** When the viewer typed it (the message's publish time). */
  typedAt: number;
  /** From the Desk's simulator. */
  sim?: boolean;
}

export interface SubmitResult {
  running: boolean;
  /** Entry ids taken by this batch. */
  solved: string[];
}

export const newCrosswordRunnerState = (): CrosswordRunnerState => ({ scenes: new Map(), lastPollAt: -Infinity });

/** Run `fn` after whatever is already running on this scene. */
function locked<T>(rt: SceneRuntime, fn: () => Promise<T>): Promise<T> {
  const run = rt.lock.then(fn);
  rt.lock = run.catch(() => undefined);
  return run;
}

const hostPlays = (rt: SceneRuntime) => rt.live || rt.cfg.playOffAir;
const isFrozen = (rt: SceneRuntime) => rt.game.paused || !hostPlays(rt);
/** The game's clock: frozen at `frozenAt`, else `now` (a Desk command while paused sets deadlines on the frozen clock). */
const clockOf = (rt: SceneRuntime, now: number) => rt.frozenAt ?? now;

/**
 * Freeze or thaw the clock to match pause / park. A thaw moves every deadline
 * on by the frozen time; returns true when the game changed.
 */
function syncFreeze(rt: SceneRuntime, now: number): boolean {
  const frozen = isFrozen(rt);
  if (frozen && rt.frozenAt == null) rt.frozenAt = now;
  else if (!frozen && rt.frozenAt != null) {
    rt.game = shiftDeadlines(rt.game, now - rt.frozenAt);
    rt.frozenAt = null;
    return true;
  }
  return false;
}

/** Save and emit: seq bumped, `pub` rebuilt. A failed save is logged; the show goes on. */
async function commit(rt: SceneRuntime, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  rt.game = bumpAndProject(rt.puzzle, rt.game, { now, today: rt.today, inputLive: rt.inputLive });
  try {
    await deps.db.crosswordGames.save(rt.game);
  } catch (err) {
    log(TAG, `save failed`, { sceneId: rt.sceneId, err: String(err) });
  }
  deps.emit(CROSSWORD_STATE, rt.game.pub);
}

/** Rebuild the today board (after solves, at load, at the UTC day's turn). */
async function refreshToday(rt: SceneRuntime, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  const since = startOfUtcDay(now);
  try {
    const hiddenIds = await deps.db.crosswordPlayers.hiddenIds();
    const rows = await deps.db.crosswordSolves.board({ sceneId: rt.sceneId, since, hiddenIds, limit: 10 });
    rt.today = rows.map((r) => ({ name: r.name, points: r.points }));
    rt.todayDay = since;
  } catch (err) {
    log(TAG, `today board failed`, { sceneId: rt.sceneId, err: String(err) });
  }
}

/** Stamp `endedAt` on the scene's open play of the current puzzle. Best effort. */
async function endCurrentPlay(rt: SceneRuntime, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  const p = rt.puzzle;
  if (!p) return;
  const play = openPlay(p, rt.sceneId);
  if (!play) return;
  play.endedAt = now;
  try {
    await deps.db.crosswordPuzzles.endPlay(p.id, rt.sceneId, play.startedAt, now);
  } catch (err) {
    log(TAG, `endPlay failed`, { sceneId: rt.sceneId, puzzleId: p.id, err: String(err) });
  }
}

/** Clear the board for a new puzzle (or none). */
const resetBoard = (g: CrosswordGame): CrosswordGame => ({
  ...g,
  phaseEndsAt: 0,
  puzzleStartedAt: 0,
  spotlight: null,
  hints: [],
  solved: {},
  scores: {},
  feed: [],
});

/**
 * Put the next puzzle on its intro card, or go `idle` with no stock. The
 * no-repeat rule is `chooseNextPuzzle`'s over the ready list. Commits when the
 * game changed.
 */
async function startNext(rt: SceneRuntime, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  rt.lastIdleCheckAt = now;
  const ready = await deps.db.crosswordPuzzles.list({ status: "ready" });
  const next = chooseNextPuzzle(ready, rt.sceneId, rt.cfg.noRepeatPuzzles);
  if (!next) {
    if (rt.game.phase === "idle" && !rt.game.puzzleId) return;
    rt.puzzle = null;
    rt.game = { ...resetBoard(rt.game), phase: "idle", puzzleId: "" };
    log(TAG, `no stock — idle`, { sceneId: rt.sceneId });
    await commit(rt, now, deps);
    return;
  }
  try {
    await deps.db.crosswordPuzzles.startPlay(next.id, rt.sceneId, now);
  } catch (err) {
    log(TAG, `startPlay failed`, { sceneId: rt.sceneId, puzzleId: next.id, err: String(err) });
  }
  next.plays = [...next.plays, { sceneId: rt.sceneId, startedAt: now }];
  rt.cache = new Map([[next.id, next]]);
  rt.puzzle = next;
  rt.game = {
    ...resetBoard(rt.game),
    puzzleId: next.id,
    puzzleNo: rt.game.puzzleNo + 1,
    phase: "intro",
    phaseEndsAt: now + rt.cfg.introS * 1000,
  };
  log(TAG, `puzzle ${rt.game.puzzleNo}`, { sceneId: rt.sceneId, puzzleId: next.id, title: next.title });
  await commit(rt, now, deps);
}

const toFinale = (rt: SceneRuntime, now: number) => {
  rt.game = { ...rt.game, phase: "finale", phaseEndsAt: now + rt.cfg.finaleS * 1000, spotlight: null };
};

/** Spotlight the next word, or go to the finale when none is open. */
function moveSpotlight(rt: SceneRuntime, now: number, skip?: string): void {
  const entry = rt.puzzle ? nextSpotlightEntry(rt.puzzle, rt.game, skip) : null;
  if (!entry) toFinale(rt, now);
  else rt.game = { ...rt.game, spotlight: spotlightOn(entry.id, now, rt.cfg) };
}

/** One `playing` decision: the ceiling, a held word moving on, a reveal, or a hint. */
async function stepPlaying(rt: SceneRuntime, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  const puzzle = rt.puzzle!;
  const g = rt.game;
  if (now >= g.phaseEndsAt) {
    rt.game = revealAll(puzzle, g, now);
    toFinale(rt, now);
    log(TAG, `ceiling`, { sceneId: rt.sceneId, puzzleId: puzzle.id });
    return commit(rt, now, deps);
  }
  const spot = g.spotlight;
  if (!spot) {
    moveSpotlight(rt, now);
    return commit(rt, now, deps);
  }
  if (g.solved[spot.entryId]) {
    // Holding a solved word (a viewer's beat or the host's reveal).
    if (now < spot.endsAt) return;
    if (isPuzzleComplete(puzzle, g)) toFinale(rt, now);
    else moveSpotlight(rt, now);
    return commit(rt, now, deps);
  }
  if (now >= spot.endsAt) {
    const entry = puzzle.entries.find((e) => e.id === spot.entryId);
    if (!entry) {
      moveSpotlight(rt, now);
      return commit(rt, now, deps);
    }
    rt.game = { ...revealEntry(g, entry, now), spotlight: { ...spot, endsAt: now + rt.cfg.revealHoldS * 1000 } };
    return commit(rt, now, deps);
  }
  const hint = nextHint(puzzle, g, now, rt.cfg);
  if (hint) {
    rt.game = { ...g, hints: [...g.hints, { ...hint, at: now }] };
    return commit(rt, now, deps);
  }
}

/** In-memory side of a step for one scene: run the phase clock, beat. */
async function advance(rt: SceneRuntime, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  if (!isFrozen(rt)) {
    const g = rt.game;
    if (g.phase !== "idle" && !rt.puzzle) {
      // The puzzle went missing under the game (deleted): move on.
      await startNext(rt, now, deps);
    } else if (g.phase === "idle") {
      if (now - rt.lastIdleCheckAt >= CROSSWORD_IDLE_CHECK_MS) await startNext(rt, now, deps);
    } else if (g.phase === "intro") {
      if (now >= g.phaseEndsAt) {
        rt.game = { ...g, phase: "playing", puzzleStartedAt: now, phaseEndsAt: now + rt.cfg.ceilingMin * 60_000 };
        moveSpotlight(rt, now);
        await commit(rt, now, deps);
      }
    } else if (g.phase === "playing") {
      await stepPlaying(rt, now, deps);
    } else if (g.phase === "finale" && now >= g.phaseEndsAt) {
      await endCurrentPlay(rt, now, deps);
      await startNext(rt, now, deps);
    }
  }
  if (now - rt.lastBeatAt >= CROSSWORD_BEAT_MS) {
    rt.lastBeatAt = now;
    const beat: CrosswordBeat = { sceneId: rt.sceneId, seq: rt.game.seq, serverNow: now };
    deps.emit(CROSSWORD_BEAT, beat);
  }
}

/**
 * First sight of an enabled scene: reload its stored game. A stored game that
 * is mid-puzzle under the same live run resumes (a go-live after the last save
 * starts fresh instead); a paused or parked one stays frozen from its last save.
 */
async function loadScene(
  sceneId: string,
  cfg: CrosswordConfig,
  run: { id: string; startAt?: number | null } | null,
  inputLive: boolean,
  now: number,
  deps: CrosswordRunnerDeps,
): Promise<SceneRuntime> {
  const stored = await deps.db.crosswordGames.get(sceneId);
  const game = stored ?? emptyGame(sceneId, now);
  const cache = new Map<string, CrosswordPuzzle>();
  const puzzle = await loadPuzzle(deps.db, cache, game.puzzleId);
  const savedAt = game.pub?.serverNow ?? now;
  const resumes = !!run && game.phase !== "idle" && run.startAt != null && run.startAt <= savedAt;
  const rt: SceneRuntime = {
    sceneId,
    cfg,
    game,
    puzzle,
    cache,
    live: !!run,
    liveRunId: resumes ? run!.id : null,
    inputLive,
    frozenAt: null,
    today: [],
    todayDay: 0,
    rate: new Map(),
    lastBeatAt: -Infinity,
    lastIdleCheckAt: -Infinity,
    lock: Promise.resolve(),
  };
  if (isFrozen(rt) && game.phase !== "idle") rt.frozenAt = savedAt;
  await refreshToday(rt, now, deps);
  log(TAG, `runner loaded`, { sceneId, phase: game.phase, puzzleNo: game.puzzleNo, resumed: !!stored });
  return rt;
}

/** Mongo side of a step for one scene: config, live run, go-live, park, thaw. */
async function pollScene(state: CrosswordRunnerState, sceneId: string, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  const cfg = await deps.db.getOrInitCrosswordConfig(sceneId);
  const existing = state.scenes.get(sceneId);
  if (!cfg.enabled) {
    if (existing) {
      state.scenes.delete(sceneId);
      log(TAG, `runner stopped (disabled)`, { sceneId });
    }
    return;
  }
  const active = await deps.db.activeRunForScene(sceneId);
  const run = active && active.status === "live" ? active : null;
  const inputLive = !!run && !!run.chat?.enabled;

  if (!existing) {
    const rt = await loadScene(sceneId, cfg, run, inputLive, now, deps);
    state.scenes.set(sceneId, rt);
    await locked(rt, () => afterPoll(rt, run, inputLive, now, deps));
    return;
  }
  existing.cfg = cfg;
  await locked(existing, () => afterPoll(existing, run, inputLive, now, deps));
}

async function afterPoll(
  rt: SceneRuntime,
  run: { id: string } | null,
  inputLive: boolean,
  now: number,
  deps: CrosswordRunnerDeps,
): Promise<void> {
  let changed = false;
  rt.live = !!run;
  rt.inputLive = inputLive;
  if (run && run.id !== rt.liveRunId) {
    // Go-live: a fresh puzzle on its intro card, whatever was parked.
    rt.liveRunId = run.id;
    rt.frozenAt = null;
    rt.game = { ...rt.game, paused: false };
    log(TAG, `go-live — fresh puzzle`, { sceneId: rt.sceneId, runId: run.id });
    await endCurrentPlay(rt, now, deps);
    await startNext(rt, now, deps);
  } else if (!run) {
    rt.liveRunId = null;
  }
  if (syncFreeze(rt, now)) changed = true;
  if (startOfUtcDay(now) !== rt.todayDay) {
    await refreshToday(rt, now, deps);
    changed = true;
  }
  if (changed || !!rt.game.pub?.inputLive !== rt.inputLive) await commit(rt, now, deps);
}

/** Poll every crossword scene; drop runners whose scene is gone. */
async function poll(state: CrosswordRunnerState, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  const scenes = await deps.db.crosswordScenes();
  const listed = new Set(scenes);
  for (const id of [...state.scenes.keys()]) {
    if (!listed.has(id)) {
      state.scenes.delete(id);
      log(TAG, `runner stopped (scene gone)`, { sceneId: id });
    }
  }
  for (const sceneId of scenes) {
    try {
      await pollScene(state, sceneId, now, deps);
    } catch (err) {
      log(TAG, `scene poll failed`, { sceneId, err: String(err) });
    }
  }
}

/**
 * One runner step: poll Mongo when a poll is due, then run each scene's phase
 * clock from memory. Never throws.
 */
export async function step(state: CrosswordRunnerState, now: number, deps: CrosswordRunnerDeps): Promise<void> {
  if (now - state.lastPollAt >= CROSSWORD_POLL_MS) {
    state.lastPollAt = now;
    try {
      await poll(state, now, deps);
    } catch (err) {
      log(TAG, `poll failed`, String(err));
    }
  }
  for (const rt of [...state.scenes.values()]) {
    try {
      await locked(rt, () => advance(rt, now, deps));
    } catch (err) {
      log(TAG, `advance failed`, { sceneId: rt.sceneId, err: String(err) });
    }
  }
}

/**
 * Answers from chat (or the simulator) for one scene, applied earliest typed
 * first. Over-rate guesses and hidden players are ignored, names are cleaned
 * for air, a taken word goes to the solve log. Nothing is taken while the
 * game is frozen (paused or parked) or between puzzles.
 */
export async function submitAnswersTo(
  state: CrosswordRunnerState,
  sceneId: string,
  msgs: CrosswordChatAnswer[],
  now: number,
  deps: CrosswordRunnerDeps,
): Promise<SubmitResult> {
  const rt = state.scenes.get(sceneId);
  if (!rt) return { running: false, solved: [] };
  return locked(rt, async () => {
    const solved: string[] = [];
    const puzzle = rt.puzzle;
    if (!puzzle || isFrozen(rt) || (rt.game.phase !== "playing" && rt.game.phase !== "finale")) {
      return { running: true, solved };
    }
    const cfg = rt.cfg;
    for (const m of [...msgs].sort((a, b) => a.typedAt - b.typedAt)) {
      const history = (rt.rate.get(m.playerId) ?? []).filter((t) => t > m.typedAt - cfg.rateWindowS * 1000);
      if (!withinRate(history, m.typedAt, cfg.rateMax, cfg.rateWindowS)) continue;
      rt.rate.set(m.playerId, [...history, m.typedAt]);
      const name = cleanPlayerName(m.name, m.playerId, cfg.blocklist);
      const player = await deps.db.crosswordPlayers.touch(m.playerId, name, now);
      if (player.hidden) continue;
      const res = applyAnswer(puzzle, rt.game, { playerId: m.playerId, name, text: m.text, typedAt: m.typedAt }, cfg, now);
      if (res.kind === "none") continue;
      let game = res.game;
      if (res.kind === "solved" && game.spotlight?.entryId === res.entryId) {
        // A viewer took the spotlight word: a short beat, then the next clue.
        game = { ...game, spotlight: { ...game.spotlight, endsAt: now + cfg.solveBeatS * 1000 } };
      }
      rt.game = game;
      solved.push(res.entryId);
      const s = game.solved[res.entryId];
      const solve: CrosswordSolve = {
        id: `${sceneId}:${game.puzzleNo}:${res.entryId}`,
        sceneId,
        puzzleId: puzzle.id,
        entryId: res.entryId,
        playerId: m.playerId,
        name,
        points: res.points,
        at: s.at,
        ...(res.kind === "late" ? { late: true } : {}),
        ...(m.sim ? { sim: true } : {}),
      };
      try {
        await deps.db.crosswordSolves.append(solve);
      } catch (err) {
        log(TAG, `solve log failed`, { sceneId, entryId: res.entryId, err: String(err) });
      }
      log(TAG, `${res.kind}`, { sceneId, entryId: res.entryId, playerId: m.playerId, points: res.points, sim: !!m.sim });
    }
    if (solved.length) {
      await refreshToday(rt, now, deps);
      await commit(rt, now, deps);
    }
    return { running: true, solved };
  });
}

/**
 * A Desk command. pause / resume freeze and thaw the clock; skipClue moves the
 * spotlight on and leaves the word open; reveal has the host fill the
 * spotlight word; nextPuzzle finishes the puzzle now (the host fills the rest)
 * and goes to the finale — from the finale or idle it moves straight on.
 * Returns false when there is no runner for the scene.
 */
export async function commandTo(
  state: CrosswordRunnerState,
  sceneId: string,
  command: CrosswordCommand,
  now: number,
  deps: CrosswordRunnerDeps,
): Promise<boolean> {
  const rt = state.scenes.get(sceneId);
  if (!rt) return false;
  await locked(rt, async () => {
    const g = rt.game;
    const clock = clockOf(rt, now);
    switch (command) {
      case "pause":
        if (g.paused) return;
        rt.game = { ...g, paused: true };
        syncFreeze(rt, now);
        break;
      case "resume":
        if (!g.paused) return;
        rt.game = { ...g, paused: false };
        syncFreeze(rt, now);
        break;
      case "skipClue": {
        if (g.phase !== "playing" || !rt.puzzle) return;
        const cur = g.spotlight?.entryId;
        moveSpotlight(rt, clock, cur && !g.solved[cur] ? cur : undefined);
        break;
      }
      case "reveal": {
        const spot = g.spotlight;
        const entry = spot && rt.puzzle?.entries.find((e) => e.id === spot.entryId);
        if (g.phase !== "playing" || !spot || !entry || g.solved[entry.id]) return;
        rt.game = { ...revealEntry(g, entry, clock), spotlight: { ...spot, endsAt: clock + rt.cfg.revealHoldS * 1000 } };
        break;
      }
      case "nextPuzzle":
        if (g.phase === "idle") return startNext(rt, now, deps);
        if (g.phase === "finale") {
          rt.game = { ...g, phaseEndsAt: clock };
        } else {
          if (rt.puzzle) rt.game = revealAll(rt.puzzle, g, clock);
          toFinale(rt, clock);
        }
        break;
    }
    log(TAG, `command ${command}`, { sceneId });
    await commit(rt, now, deps);
  });
  return true;
}

// ---------------------------------------------------------------------------
// The shell: one in-process runner, its timer, and the entry points other
// worker code calls (the inject job, the chat hookup).
// ---------------------------------------------------------------------------

let state = newCrosswordRunnerState();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/** The live deps: the app db and the worker → socket relay. */
export async function crosswordDeps(): Promise<CrosswordRunnerDeps> {
  const db = await getAppDb();
  return { db, emit: (type, data) => emitWorkerEvent({ type, data }) };
}

/** The in-process runner state (the inject job drives it directly). */
export const crosswordRunnerState = () => state;

/** Answers for a scene from chat; see `submitAnswersTo`. */
export async function submitAnswers(sceneId: string, msgs: CrosswordChatAnswer[]): Promise<SubmitResult> {
  return submitAnswersTo(state, sceneId, msgs, Date.now(), await crosswordDeps());
}

/** A Desk command for a scene; see `commandTo`. */
export async function runCommand(sceneId: string, command: CrosswordCommand): Promise<boolean> {
  return commandTo(state, sceneId, command, Date.now(), await crosswordDeps());
}

async function tick(): Promise<void> {
  if (ticking) return; // a slow poll must never overlap the next tick
  ticking = true;
  try {
    await step(state, Date.now(), await crosswordDeps());
  } catch (err) {
    log(TAG, `tick failed`, String(err));
  } finally {
    ticking = false;
  }
}

/** Start the crossword host. Idempotent. */
export function startCrosswordRunner(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), CROSSWORD_TICK_MS);
  log(TAG, `started`, { tickMs: CROSSWORD_TICK_MS, pollMs: CROSSWORD_POLL_MS });
}

/** Stop the crossword host. Idempotent. Every change is already saved. */
export function stopCrosswordRunner(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state = newCrosswordRunnerState();
}
