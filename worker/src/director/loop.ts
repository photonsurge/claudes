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
import { buildCandidates, buildAdSegment } from "./candidates";
import { airLogSceneOff } from "./airlog";
import { countsOf, emitInactive, emitState, newRunner, performCut, type SceneRunner } from "./runner";
import { arbitrate, describeOp, isControlOp, type DirectorCommand } from "@photonsurge/shared/director-commands";
import { applyControl, holdPaused, resolveTarget, withHold } from "./commands";
import { reconcilePending, selectBreakIn } from "@photonsurge/shared/director-break-in";
import { breakInView, buildBreakInSegment, stampIncoming } from "./breakin";
import { freshEvents, type FreshEventWatch } from "./fresh";
import { markHandled } from "./runner";

const TAG = "director";
const TICK_MS = 1000;
/** Re-emit the current segment at least this often so late joiners sync. */
const HEARTBEAT_MS = 2500;

const runners = new Map<string, SceneRunner>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

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
  if (priority) {
    // Say on air WHY it jumped the queue (same treatment as an interrupt).
    const reason = pool.find((c) => c.segment.id === priority!.id)?.breakIn?.reason;
    if (reason) priority.breakIn = { reason, interrupted: false };
    return { next: priority, pool, breaking: true };
  }
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
  fresh: Pick<FreshEventWatch, "ensureStarted" | "since">;
}
const STEP_DEPS: StepDeps = {
  pick: pickAtBoundary,
  cut: performCut,
  resolve: resolveTarget,
  emit: emitState,
  fresh: freshEvents,
};

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
  let changed = arb.expired.length > 0 as boolean;
  for (const c of arb.control) {
    if (!isControlOp(c.cmd)) continue;
    const effect = applyControl(r, c as DirectorCommand & { cmd: typeof c.cmd }, now);
    skipByCommand ||= effect.boundary;
    cleared ||= effect.clear;
    changed = true;
    await settle(c, "applied", { appliedAt: now });
  }
  if (cleared) await db.directorCommands.clearQueued(r.sceneId, now);

  /** Every cut goes through here: INCOMING stamp, the cut, and a paused
   *  director staying paused on the new shot for its full hold. */
  const cut = async (next: Segment, meta: { pool: Candidate[]; skipRequested: boolean; breaking: boolean; command?: ReturnType<typeof commandMeta> }) => {
    stampIncoming(next, cfg);
    await deps.cut(r, next, { db, cfg, now, ...meta });
    if (r.paused) r.paused.remainingMs = next.holdMs;
  };

  /** Put a command's target on air; false when it was refused. */
  const air = async (c: DirectorCommand, boundary: boolean): Promise<boolean> => {
    if (c.cmd.op !== "cut" && c.cmd.op !== "queue") return false;
    const res = await deps.resolve(db, cfg, r, c.cmd.target, now, undefined, {
      allowCities: c.source.kind === "viewer" ? !!c.viewer?.allowCities : true,
    });
    if ("refused" in res) {
      await settle(c, "refused", { note: res.refused });
      return false;
    }
    let next = withHold(res.segment, c.cmd.holdS);
    if (c.source.kind === "viewer") {
      next = { ...next, requestedBy: { author: c.source.author, platform: c.source.platform } };
      r.lastViewerCutAt = now;
    }
    await cut(next, {
      pool: [],
      skipRequested: boundary ? skipRequested || skipByCommand : true,
      breaking: false,
      command: commandMeta(c),
    });
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

  // Break-ins (immediate mode): keep the channel's queue of fresh events up to
  // date every tick, whether or not anything airs, so a burst that lands during
  // a long shot is all still waiting when the shot ends.
  const immediate = cfg.breakIn.enabled && cfg.breakIn.interrupt === "immediate";
  // Boundary-mode channels keep the candidate pool's priority tier for events;
  // the queue only carries their round-ups (which the pool can't stamp).
  const watching = immediate || (cfg.breakIn.enabled && cfg.breakIn.reasons.roundup);
  if (watching) {
    deps.fresh.ensureStarted(db);
    const view = breakInView(r, cfg, now);
    const { pending: queue, aged, dropped } = reconcilePending(r.pending, deps.fresh.since(), cfg.breakIn, view);
    r.pending = queue;
    const gone = [...aged, ...dropped];
    if (gone.length) {
      markHandled(r, gone.map((p) => p.key));
      log(TAG, "break-in queue drop", { sceneId: r.sceneId, aged: aged.map((p) => p.key), dropped: dropped.map((p) => p.key) });
      if (r.runId) await db.airLog.addQueueDrops(r.runId, gone.length).catch(() => undefined);
      changed = true;
    }
  }

  /** Put a break-in pick on air; false when nothing could be built. */
  const breakIn = async (atBoundary: boolean): Promise<boolean> => {
    if (!watching || paused || (!immediate && !atBoundary)) return false;
    // At a shot change the usual one-normal-cut cooldown still applies, so a
    // burst drains every other cut instead of monopolising the channel.
    if (atBoundary && r.lastCutWasPriority) return false;
    const queue = immediate ? r.pending : r.pending.filter((p) => p.reason === "roundup");
    const pick = selectBreakIn(queue, cfg.breakIn, breakInView(r, cfg, now), { atBoundary });
    if (!pick) return false;
    const seg = await buildBreakInSegment(db, cfg, r, pick, now, { interrupted: !atBoundary, resolve: deps.resolve });
    // Only what aired (or failed to build) leaves the queue.
    markHandled(r, pick.items.map((p) => p.key));
    r.pending = r.pending.filter((p) => !r.handled.has(p.key));
    if (!seg) return false;
    await cut(seg, { pool: [], skipRequested: true, breaking: true });
    return true;
  };

  // Interrupt the running shot for breaking news.
  if (!boundary && (await breakIn(false))) return;

  // A viewer's request, when the channel's pacing allows another one. Never
  // mid-ad, never while paused, and mid-shot only for an "immediate" channel.
  const viewer = arb.viewerNext && !cleared && !settled.has(arb.viewerNext.id) ? arb.viewerNext : null;
  const viewerDue = (c: DirectorCommand) =>
    !paused && now - r.lastViewerCutAt >= (c.viewer?.everyS ?? 0) * 1000;
  if (
    !boundary &&
    viewer &&
    viewer.cmd.op === "cut" &&
    viewer.viewer?.immediate &&
    r.current?.kind !== "ad" &&
    viewerDue(viewer) &&
    (await air(viewer, false))
  ) {
    refreshQueued();
    return;
  }

  if (boundary) {
    // operator > break-in > viewer > rotation.
    const queued = arb.atBoundary && !cleared && !settled.has(arb.atBoundary.id) ? arb.atBoundary : null;
    if (queued && (await air(queued, true))) {
      refreshQueued();
      return;
    }
    if (await breakIn(true)) return;
    if (viewer && viewerDue(viewer) && (await air(viewer, true))) {
      refreshQueued();
      return;
    }
    const { next, pool, breaking } = await deps.pick(db, cfg, r);
    if (next) {
      await cut(next, { pool, skipRequested: skipRequested || skipByCommand, breaking });
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

    // Scenes that just left auto mode: tell watchers the director stood down —
    // unless the scene went straight to a script, whose first cut (script-
    // runner.ts) this stand-down could otherwise land after.
    const leaving = [...runners.keys()].filter((sceneId) => !autoSet.has(sceneId));
    const scriptSet = leaving.length ? new Set(await db.scriptDirectorScenes()) : new Set<string>();
    for (const sceneId of leaving) {
      const closingRunId = runners.get(sceneId)?.runId;
      runners.delete(sceneId);
      if (!scriptSet.has(sceneId)) emitInactive(sceneId);
      await airLogSceneOff(db, closingRunId, now);
      log(TAG, `scene left auto`, { sceneId });
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
