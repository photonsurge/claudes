/**
 * The auto-director loop. One state machine per scene that has the director in
 * "auto" mode: each tick it checks whether the current shot has expired (or the
 * operator bumped the skip nonce), and if so picks the next segment from the
 * scored candidate pool and emits a `director:state` cut. Between cuts it emits
 * a heartbeat (same seq) so a freshly-loaded /watch can join mid-segment.
 *
 * State is in-memory and per-scene; it rebuilds itself from Mongo on restart
 * (the first tick just starts a fresh show). The worker is the single writer.
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  DIRECTOR_STATE,
  DEFAULT_DIRECTOR_CONFIG,
  type DirectorState,
  type Segment,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { selectNext, selectPriority, PRIORITY_KINDS, type Candidate } from "@photonsurge/shared/director-select";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { buildCandidates, buildAdSegment } from "./candidates";

const TAG = "director";
const TICK_MS = 1000;
/** Re-emit the current segment at least this often so late joiners sync. */
const HEARTBEAT_MS = 2500;
/** How many recent segment ids to remember for cooldown/variety. */
const HISTORY_CAP = 30;

interface SceneRunner {
  sceneId: string;
  seq: number;
  history: string[];
  /** Per-segment airing tally: how many times + when it last aired this session. */
  seen: Map<string, { count: number; last: number }>;
  /** [lng,lat] of recently-aired located shots, for the geographic cooldown. */
  recentCenters: [number, number][];
  current: Segment | null;
  startedAt: number;
  endsAt: number;
  upNext: { kind: SegmentKind; title: string }[];
  /** The current segment's prior-airing time + running count (operator readout). */
  lastShownAt?: number;
  timesShown?: number;
  /** adId of the last ad aired, so the next break doesn't repeat it. */
  lastAdId?: string;
  /** The last cut was itself a priority (breaking-news) pick — gates the NEXT
   *  cut's priority check so breaking news can't fire two cuts in a row (see
   *  `selectPriority`'s cooldown option). */
  lastCutWasPriority: boolean;
  /** An ad slot came due but breaking news preempted it — air it on the very
   *  next cut instead of waiting another full `adEveryNShots` cycle. */
  pendingAd: boolean;
  lastSkipNonce: number;
  lastEmit: number;
}

/** Kinds that share the world-view center — excluded from the geo cooldown.
 *  `ad` has no geography (it covers the globe), so it's exempt too. */
const GLOBAL_KINDS = new Set<SegmentKind>(["intro", "ocean", "orbital", "ad"]);
/** How many recent located centers to remember for the geo cooldown. */
const GEO_RECENT_CAP = 8;
/** Cap the per-segment tally map so a 24/7 run can't grow it unbounded. */
const SEEN_CAP = 1000;

const runners = new Map<string, SceneRunner>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

const newRunner = (sceneId: string): SceneRunner => ({
  sceneId,
  seq: 0,
  history: [],
  seen: new Map(),
  recentCenters: [],
  current: null,
  startedAt: 0,
  endsAt: 0,
  upNext: [],
  pendingAd: false,
  lastCutWasPriority: false,
  lastSkipNonce: 0,
  lastEmit: 0,
});

/**
 * Top few upcoming shots (one per kind) for a "coming up" rail. This mirrors
 * the REAL selection order rather than just sorting by newsworthiness score —
 * a pure score sort is almost always "Seismic · Severe · …" (quake/storm
 * candidates carry the highest scores) regardless of what fair rotation will
 * actually reach next, which reads as flatly wrong once cooldown/breaking
 * gating (see `selectPriority`) makes the real picks far more varied:
 *  - If the cooldown gate (see `selectPriority`) permits it, the single
 *    highest-scored still-unaired breaking candidate leads, same as the real
 *    priority tier would pick.
 *  - The remaining slots are one representative per OTHER kind, ordered by
 *    that kind's least-aired count (ascending) — the kind fair rotation is
 *    most "due" for, not the kind with the loudest headline.
 */
function previewNext(
  pool: Candidate[],
  excludeId: string,
  counts: Map<string, number>,
  cooldownActive: boolean,
): { kind: SegmentKind; title: string }[] {
  const eligible = pool.filter((c) => c.segment.id !== excludeId);
  const out: { kind: SegmentKind; title: string }[] = [];

  if (!cooldownActive) {
    const breaking = eligible
      .filter((c) => PRIORITY_KINDS.includes(c.segment.kind) && c.breaking !== false && !counts.has(c.segment.id))
      .sort((a, b) => b.score - a.score)[0];
    if (breaking) out.push({ kind: breaking.segment.kind, title: breaking.segment.title });
  }

  const seenKinds = new Set(out.map((o) => o.kind));
  const remainingKinds = [...new Set(eligible.map((c) => c.segment.kind))].filter((k) => !seenKinds.has(k));
  const minCountOf = (kind: SegmentKind) =>
    Math.min(...eligible.filter((c) => c.segment.kind === kind).map((c) => counts.get(c.segment.id) ?? 0));
  remainingKinds.sort((a, b) => minCountOf(a) - minCountOf(b));

  for (const kind of remainingKinds) {
    const top = eligible.filter((c) => c.segment.kind === kind).sort((a, b) => b.score - a.score)[0];
    if (top) out.push({ kind, title: top.segment.title });
    if (out.length >= 3) break;
  }
  return out;
}

function emit(r: SceneRunner, now: number): void {
  const state: DirectorState = {
    sceneId: r.sceneId,
    seq: r.seq,
    active: true,
    segment: r.current,
    startedAt: r.startedAt,
    endsAt: r.endsAt,
    upNext: r.upNext,
    lastShownAt: r.lastShownAt,
    timesShown: r.timesShown,
  };
  emitWorkerEvent({ type: DIRECTOR_STATE, data: state });
  r.lastEmit = now;
}

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
        runners.delete(sceneId);
        emitInactive(sceneId);
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
        // Captured before the cut so we can record how long the outgoing
        // segment actually held the screen (a manual skip cuts it short).
        const prevSegment = r.current;
        const prevStartedAt = r.startedAt;

        // Commercial-break cadence: when ads are enabled, force a full-frame ad
        // interstitial every Nth shot (never on the opener). Falls through to a
        // normal cut if there's no active ad to air.
        const adDue =
          cfg.kinds.ad &&
          cfg.adEveryNShots > 0 &&
          r.seq > 0 &&
          (r.pendingAd || r.seq % cfg.adEveryNShots === 0);

        const counts = new Map<string, number>();
        for (const [id, v] of r.seen) counts.set(id, v.count);

        // The previous cut having been priority itself gates this one — see
        // `selectPriority`'s cooldown option: without it, a continuous global
        // stream of genuinely-new alerts (NWS + Meteoalarm + WMO + GDACS
        // combined) can preempt every single cut forever.
        const cooldown = r.lastCutWasPriority;
        let pool: Candidate[] = [];
        let next: Segment | null = null;
        let priority: Segment | null = null;
        let pickedViaPriority = false;
        if (adDue) {
          // A brand-new quake/storm/round-up nobody's seen this session outranks
          // a scheduled ad break — build the pool early just to check, and defer
          // the ad by one cut rather than let it stall breaking news.
          pool = await buildCandidates(db, cfg, counts);
          priority = r.seq > 0 ? selectPriority(pool, counts, { cooldown }) : null;
          if (priority) {
            r.pendingAd = true;
          } else {
            next = await buildAdSegment(db, cfg, r.current?.camera, r.lastAdId);
          }
        }
        if (!next) {
          if (!pool.length) pool = await buildCandidates(db, cfg, counts);
          // Breaking news preempts random rotation on every cut but the very
          // first (which always opens on the intro) — a fresh round-up or a
          // brand-new quake/storm airs at the next opportunity, not whenever
          // fair rotation happens to land on its kind.
          next = priority ?? (r.seq > 0 ? selectPriority(pool, counts, { cooldown }) : null);
          if (next) {
            pickedViaPriority = true;
          } else {
            next = selectNext(pool, {
              history: r.history,
              recentCenters: r.recentCenters,
              counts,
              isFirst: r.seq === 0,
            });
          }
        }
        if (next) {
          r.lastCutWasPriority = pickedViaPriority;
          if (next.kind === "ad") r.pendingAd = false;
          // Anchor any camera motion (orbit spin OR push-in zoom drift) to the
          // cut instant so /control and /watch compute it in phase from here.
          if (next.patch.autoSpin || next.patch.zoomDrift) next.patch.spinEpoch = now;

          // Fly every cut for the operator-set transition time: /watch and /control
          // read this off the merged ControlState in Globe.runFlight, so each shot
          // eases in at the same deliberate pace instead of a distance-scaled one.
          next.patch.cutTransitionMs = Math.round(
            (cfg.transitionSeconds ?? DEFAULT_DIRECTOR_CONFIG.transitionSeconds) * 1000,
          );

          // Tally this airing for the operator readout (last shown + count).
          const prior = r.seen.get(next.id);
          r.lastShownAt = prior?.last;
          r.timesShown = (prior?.count ?? 0) + 1;
          r.seen.set(next.id, { count: r.timesShown, last: now });
          if (r.seen.size > SEEN_CAP) r.seen.delete(r.seen.keys().next().value as string);

          // Remember located centers so the geo cooldown spreads regions out.
          if (!GLOBAL_KINDS.has(next.kind)) {
            r.recentCenters.push(next.camera.center);
            if (r.recentCenters.length > GEO_RECENT_CAP) r.recentCenters.shift();
          }

          r.seq += 1;
          r.current = next;
          r.startedAt = now;
          r.endsAt = now + next.holdMs;
          // Ad cuts skip the candidate build, so keep the prior "coming up" rail.
          r.upNext = pool.length ? previewNext(pool, next.id, counts, r.lastCutWasPriority) : r.upNext;
          r.history.push(next.id);
          if (r.history.length > HISTORY_CAP) r.history.shift();
          r.lastSkipNonce = cfg.skipNonce;

          // Durably record an ad airing (last shown + count) for the admin readout.
          if (next.kind === "ad" && next.ad) {
            r.lastAdId = next.ad.adId;
            await db.ads.markShown(next.ad.adId, new Date(now));
          }

          // The outgoing segment just left the screen — if it was an ad, bank
          // the real time it aired (not the nominal hold) for the admin readout.
          if (prevSegment?.kind === "ad" && prevSegment.ad) {
            await db.ads.recordImpression(prevSegment.ad.adId, now - prevStartedAt);
          }

          emit(r, now);
          log(TAG, `cut`, { sceneId, seq: r.seq, kind: next.kind, id: next.id, times: r.timesShown });
        }
      } else if (now - r.lastEmit >= HEARTBEAT_MS) {
        emit(r, now);
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
