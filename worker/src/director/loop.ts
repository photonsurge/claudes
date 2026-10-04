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

      const skipRequested = cfg.skipNonce > r.lastSkipNonce;
      const expired = !r.current || now >= r.endsAt;

      if (expired || skipRequested) {
        const { next, pool, breaking } = await pickAtBoundary(db, cfg, r);
        if (next) await performCut(r, next, { db, cfg, pool, now, skipRequested, breaking });
      } else if (now - r.lastEmit >= HEARTBEAT_MS) {
        emitState(r, now);
      }
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
