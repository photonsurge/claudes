/**
 * The cut path shared by everything that puts a segment on air: the per-scene
 * runner state, the `director:state` emits, and `performCut` — the bookkeeping
 * (airing tally, geo/area memory, history, ads), the emit and the as-run log
 * for one cut. No timers and no runner map live here, so any driver (the auto
 * loop in loop.ts, or a scripted runner with its own clock) can import it
 * without side effects.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  DIRECTOR_STATE,
  DEFAULT_DIRECTOR_CONFIG,
  type DirectorConfig,
  type DirectorState,
  type Segment,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { candidateAreaKey, AREA_MEMORY_CAP, type Candidate } from "@photonsurge/shared/director-select";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { airLogCut } from "./airlog";
import { previewNext } from "./upnext";

const TAG = "director";
/** How many recent segment ids to remember for cooldown/variety. */
export const HISTORY_CAP = 30;

export interface SceneRunner {
  sceneId: string;
  seq: number;
  history: string[];
  /** Per-segment airing tally: how many times + when it last aired this session. */
  seen: Map<string, { count: number; last: number }>;
  /** [lng,lat] of recently-aired located shots, for the geographic cooldown. */
  recentCenters: [number, number][];
  /** Recent semantic/coarse areas aired by kind (oldest→newest, capped at
   *  AREA_MEMORY_CAP), for between-appearance variety. */
  recentAreasByKind: Map<SegmentKind, string[]>;
  current: Segment | null;
  startedAt: number;
  endsAt: number;
  upNext: DirectorState["upNext"];
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
  /** The open AirRun (as-run log) for this session — set on the first cut.
   *  A worker crash leaves it dangling; the next session's startRun closes it. */
  runId?: string;
}

/** Kinds that share the world-view center — excluded from the geo cooldown.
 *  `ad` has no geography (it covers the globe), so it's exempt too. */
export const GLOBAL_KINDS = new Set<SegmentKind>(["intro", "global", "ocean", "orbital", "ad"]);
/** How many recent located centers to remember for the geo cooldown. */
export const GEO_RECENT_CAP = 8;
/** Cap the per-segment tally map so a 24/7 run can't grow it unbounded. */
export const SEEN_CAP = 1000;

export const newRunner = (sceneId: string): SceneRunner => ({
  sceneId,
  seq: 0,
  history: [],
  seen: new Map(),
  recentCenters: [],
  recentAreasByKind: new Map(),
  current: null,
  startedAt: 0,
  endsAt: 0,
  upNext: [],
  pendingAd: false,
  lastCutWasPriority: false,
  lastSkipNonce: 0,
  lastEmit: 0,
});

export function emit(r: SceneRunner, now: number): void {
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

export function emitInactive(sceneId: string): void {
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

/** Everything about a cut that isn't the runner, the segment or the pool. */
export interface CutMeta {
  db: AppDb;
  cfg: DirectorConfig;
  now: number;
  /** Why the OUTGOING segment left the screen (operator skip vs. natural
   *  expiry) — recorded by the as-run log. Default false. */
  skipRequested?: boolean;
  /** The incoming pick came via the priority (breaking-news) tier. Default false. */
  pickedViaPriority?: boolean;
  /** An explicit "coming up" rail, used as given. Omitted = previewed from
   *  `pool`, or the prior rail kept when the pool is empty (ad cuts). */
  upNext?: DirectorState["upNext"];
  /** Write the cut to the as-run log (airLogCut). Default true; editor
   *  previews pass false so they don't litter /admin/runs. */
  record?: boolean;
}

/**
 * Put `next` on air: tally it, update the variety memories, advance the
 * runner, emit the `director:state` cut and record it in the as-run log.
 * `pool` is the candidate pool `next` was picked from (area memory + the
 * "coming up" preview read it); pass [] when there isn't one.
 */
export async function performCut(r: SceneRunner, next: Segment, pool: Candidate[], meta: CutMeta): Promise<void> {
  const { db, cfg, now } = meta;
  const skipRequested = meta.skipRequested ?? false;
  const pickedViaPriority = meta.pickedViaPriority ?? false;
  // Captured before the cut so we can record how long the outgoing
  // segment actually held the screen (a manual skip cuts it short).
  const prevSegment = r.current;
  const prevStartedAt = r.startedAt;
  const counts = new Map<string, number>();
  for (const [id, v] of r.seen) counts.set(id, v.count);

  r.lastCutWasPriority = pickedViaPriority;
  if (next.kind === "ad") r.pendingAd = false;
  // Anchor ALL camera motion to the cut instant so /control and /watch
  // compute it in phase — the preset's spin/orbit/push-in AND a channel's
  // idle drift (idleMotion), which is epoch-derived too. Unconditional:
  // a motionless cut on an idle-motion channel still needs a fresh epoch
  // or the drift lands mid-phase instead of easing out from the anchor.
  next.patch.spinEpoch = now;

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
  const selectedCandidate = pool.find((candidate) => candidate.segment.id === next.id);
  const selectedArea = selectedCandidate ? candidateAreaKey(selectedCandidate) : undefined;
  if (selectedArea) {
    // Move-to-front dedupe: revisiting an area (the relax fallback)
    // refreshes its recency rather than double-filling the window.
    const areas = (r.recentAreasByKind.get(next.kind) ?? []).filter((a) => a !== selectedArea);
    areas.push(selectedArea);
    while (areas.length > AREA_MEMORY_CAP) areas.shift();
    r.recentAreasByKind.set(next.kind, areas);
  }

  r.seq += 1;
  r.current = next;
  r.startedAt = now;
  r.endsAt = now + next.holdMs;
  // Ad cuts skip the candidate build, so keep the prior "coming up" rail.
  counts.set(next.id, r.timesShown);
  r.upNext = meta.upNext ?? (
    pool.length
      ? previewNext(pool, next.id, counts, r.lastCutWasPriority, r.recentAreasByKind, next.kind, r.recentCenters)
      : r.upNext
  );
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

  // As-run log: persist the cut (and close the outgoing entry) for
  // /admin/runs review. Best-effort — airLogCut never throws.
  if (meta.record ?? true) {
    await airLogCut(db, r, next, { skipRequested, breaking: pickedViaPriority, now });
  }

  log(TAG, `cut`, { sceneId: r.sceneId, seq: r.seq, kind: next.kind, id: next.id, times: r.timesShown });
}
