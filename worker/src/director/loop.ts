/**
 * The auto-director loop. One state machine per scene that has the director in
 * "auto" mode: each tick it checks whether the current shot has expired (or the
 * operator bumped the skip nonce), and if so picks the next segment from the
 * scored candidate pool and puts it on air via `performCut` (runner.ts). Between
 * cuts it emits a heartbeat (same seq) so a freshly-loaded /watch can join
 * mid-segment.
 *
 * State is in-memory and per-scene; it rebuilds itself from Mongo on restart
 * (the first tick just starts a fresh show). The worker is the single writer.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { DIRECTOR_STATE, type DirectorConfig, type DirectorState, type Segment } from "@photonsurge/shared/director";
import { selectNext, selectPriority, type Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { buildCandidates, buildAdSegment } from "./candidates";
import { airLogSceneOff } from "./airlog";
import { countsOf, emitState, newRunner, performCut, type SceneRunner } from "./runner";
import { arbitrate, describeOp, isControlOp, type DirectorCommand } from "@photonsurge/shared/director-commands";
import { applyControl, holdPaused, resolveTarget, withHold } from "./commands";

const TAG = "director";
const TICK_MS = 1000;
/** Re-emit the current segment at least this often so late joiners sync. */
const HEARTBEAT_MS = 2500;

const runners = new Map<string, SceneRunner>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function emitInactive(sceneId: string): void {
  const state: DirectorState = {
    sceneId,
    seq: 0,
    active: false,
    segment: null,
    startedAt: 0,
    endsAt: 0,
    upNext: [],
  };
  emitWorkerEvent({ type: DIRECTOR_STATE, data: state });
}

/**
 * Pick what airs at a shot boundary: a due ad break (unless breaking news
 * defers it), else the break-in tier, else fair rotation. Returns the pick, the
 * pool it came from (empty for an ad) and whether it came via the break-in tier.
 */
export async function pickAtBoundary(
  db: AppDb,
  cfg: DirectorConfig,
  r: SceneRunner,
  build: typeof buildCandidates = buildCandidates,
  buildAd: typeof buildAdSegment = buildAdSegment,
): Promise<{ next: Segment | null; pool: Candidate[]; breaking: boolean }> {
  // Commercial-break cadence: when ads are enabled, force a full-frame ad
  // interstitial every Nth shot (never on the opener). Falls through to a
  // normal cut if there's no active ad to air.
  const adDue =
    cfg.kinds.ad &&
    cfg.adEveryNShots > 0 &&
    r.seq > 0 &&
    (r.pendingAd || r.seq % cfg.adEveryNShots === 0);

  const counts = countsOf(r);
  // The previous cut having been priority itself gates this one — see
  // `selectPriority`'s cooldown option: without it, a continuous global
  // stream of genuinely-new alerts (NWS + Meteoalarm + WMO + GDACS
  // combined) can preempt every single cut forever. Never on the opener.
  const priorityOpts = {
    cooldown: r.lastCutWasPriority,
    enabled: cfg.breakIn.enabled,
    recentAreasByKind: r.recentAreasByKind,
  };
  let pool: Candidate[] = [];
  let priority: Segment | null = null;

  if (adDue) {
    // A breaking quake/storm/volcano outranks a scheduled ad break — build the
    // pool early just to check, and defer the ad by one cut rather than let it
    // stall breaking news.
    pool = await build(db, cfg, counts);
    priority = selectPriority(pool, counts, priorityOpts);
    if (priority) {
      r.pendingAd = true;
    } else {
      const ad = await buildAd(db, cfg, r.current?.camera, r.lastAdId);
      if (ad) return { next: ad, pool: [], breaking: false };
    }
  }
  if (!pool.length) pool = await build(db, cfg, counts);
  // Breaking news preempts random rotation on every cut but the very first
  // (which always opens on the intro).
  if (!priority && r.seq > 0) priority = selectPriority(pool, counts, priorityOpts);
  if (priority) return { next: priority, pool, breaking: true };
  const next = selectNext(pool, {
    history: r.history,
    recentCenters: r.recentCenters,
    recentAreasByKind: r.recentAreasByKind,
    counts,
    isFirst: r.seq === 0,
    kindWeights: cfg.kindWeights,
    geoCooldownDeg: cfg.rotation.geoCooldownDeg,
  });
  return { next, pool, breaking: false };
}

/** Side effects of one scene step, injectable for tests. */
export interface StepDeps {
  pick: typeof pickAtBoundary;
  cut: typeof performCut;
  resolve: typeof resolveTarget;
  emit: typeof emitState;
}
const STEP_DEPS: StepDeps = { pick: pickAtBoundary, cut: performCut, resolve: resolveTarget, emit: emitState };

/** How many waiting commands the operator readout lists. */
const QUEUED_READOUT = 5;

const commandMeta = (c: DirectorCommand) =>
  c.source.kind === "viewer"
    ? { source: "viewer" as const, author: c.source.author }
    : c.source.kind === "operator"
      ? { source: "operator" as const, author: c.source.user }
      : { source: "system" as const, author: c.source.job };

/**
 * One tick for one auto-mode scene: drain the command queue (expire, apply
 * control ops, take an operator cut now), keep a paused shot frozen, and at a
 * shot boundary air a queued command or the director's own pick. Emits a
 * heartbeat between cuts.
 */
export async function stepScene(
  db: AppDb,
  cfg: DirectorConfig,
  r: SceneRunner,
  now: number,
  deps: StepDeps = STEP_DEPS,
): Promise<void> {
  const skipRequested = cfg.skipNonce > r.lastSkipNonce;
  const pending = await db.directorCommands.pending(r.sceneId);
  const settled = new Set<string>();
  const settle = async (c: DirectorCommand, status: "applied" | "refused" | "expired", extra: Record<string, unknown> = {}) => {
    settled.add(c.id);
    await db.directorCommands.settle(c.id, status, { now, ...extra });
  };

  const arb = arbitrate(pending, {
    now,
    atBoundary:
      !r.current || skipRequested || (!r.paused && now >= r.endsAt) || pending.some((c) => c.cmd.op === "skip"),
  });
  for (const c of arb.expired) await settle(c, "expired", { note: "lapsed before it could air" });

  let skipByCommand = false;
  let cleared = false;
  let changed = arb.expired.length > 0;
  for (const c of arb.control) {
    if (!isControlOp(c.cmd)) continue;
    const effect = applyControl(r, c as DirectorCommand & { cmd: typeof c.cmd }, now);
    skipByCommand ||= effect.boundary;
    cleared ||= effect.clear;
    changed = true;
    await settle(c, "applied", { appliedAt: now });
  }
  if (cleared) await db.directorCommands.clearQueued(r.sceneId, now);

  /** Put a command's target on air; false when it was refused. */
  const air = async (c: DirectorCommand, boundary: boolean): Promise<boolean> => {
    if (c.cmd.op !== "cut" && c.cmd.op !== "queue") return false;
    const res = await deps.resolve(db, cfg, r, c.cmd.target, now);
    if ("refused" in res) {
      await settle(c, "refused", { note: res.refused });
      return false;
    }
    const next = withHold(res.segment, c.cmd.holdS);
    await deps.cut(r, next, {
      db,
      cfg,
      pool: [],
      now,
      skipRequested: boundary ? skipRequested || skipByCommand : true,
      breaking: false,
      command: commandMeta(c),
    });
    // A paused director stays paused — on the new shot, for its full hold.
    if (r.paused) r.paused.remainingMs = next.holdMs;
    await settle(c, "applied", {
      appliedAt: now,
      appliedSeq: r.seq,
      resolved: { id: next.id, title: next.title },
      note: `cut at seq ${r.seq}`,
    });
    return true;
  };

  const refreshQueued = () => {
    r.queued = cleared
      ? []
      : pending
          .filter((c) => !settled.has(c.id) && c.status === "queued")
          .slice(0, QUEUED_READOUT)
          .map((c) => ({ id: c.id, label: describeOp(c.cmd), source: c.source.kind }));
  };

  // The operator's Take goes on air now, whatever the director is doing.
  if (arb.cutNow && !cleared && (await air(arb.cutNow, false))) {
    refreshQueued();
    return;
  }

  const paused = holdPaused(r, now);
  const boundary = skipRequested || skipByCommand || !r.current || (!paused && now >= r.endsAt);
  refreshQueued();

  if (boundary) {
    if (arb.atBoundary && !cleared && !settled.has(arb.atBoundary.id) && (await air(arb.atBoundary, true))) {
      refreshQueued();
      return;
    }
    const { next, pool, breaking } = await deps.pick(db, cfg, r);
    if (next) {
      await deps.cut(r, next, { db, cfg, pool, now, skipRequested: skipRequested || skipByCommand, breaking });
      if (r.paused) r.paused.remainingMs = next.holdMs;
      return;
    }
  }
  if (changed || arb.cutNow || now - r.lastEmit >= HEARTBEAT_MS) deps.emit(r, now);
}

async function tick(): Promise<void> {
  if (ticking) return; // never overlap a slow candidate build with the next tick
  ticking = true;
  try {
    const db = await getAppDb();
    const now = Date.now();
    const autoScenes = await db.autoDirectorScenes();
    const autoSet = new Set(autoScenes);

    // Scenes that just left auto mode: tell watchers the director stood down.
    for (const sceneId of [...runners.keys()]) {
      if (!autoSet.has(sceneId)) {
        const closingRunId = runners.get(sceneId)?.runId;
        runners.delete(sceneId);
        emitInactive(sceneId);
        await airLogSceneOff(db, closingRunId, now);
        log(TAG, `scene left auto`, { sceneId });
      }
    }

    for (const sceneId of autoScenes) {
      const cfg = await db.getOrInitDirectorConfig(sceneId);
      let r = runners.get(sceneId);
      if (!r) {
        r = newRunner(sceneId);
        runners.set(sceneId, r);
      }

      await stepScene(db, cfg, r, now);
    }
  } catch (err) {
    log(TAG, `tick failed`, String(err));
  } finally {
    ticking = false;
  }
}

/** Start the director loop. Idempotent. */
export function startDirector(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  log(TAG, `started`, { tickMs: TICK_MS });
}

export function stopDirector(): void {
  if (timer) clearInterval(timer);
  timer = null;
  runners.clear();
}
