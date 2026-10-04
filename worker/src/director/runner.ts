/**
 * Per-scene director state and the ONE way a cut happens (`performCut`).
 *
 * Every path that puts a segment on air — rotation at a shot boundary, the
 * break-in tier, and (later) immediate break-ins and operator/viewer commands —
 * goes through `performCut`, so the bookkeeping (airing tally, geo cooldown,
 * area memory, history, "up next", ad accounting, emit, as-run log) can never
 * drift between them. Split out of loop.ts so it is unit-testable without the
 * timer or a live Mongo.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  DEFAULT_DIRECTOR_CONFIG,
  DIRECTOR_STATE,
  focusSubjectOf,
  type DirectorConfig,
  type DirectorState,
  type Segment,
  type SegmentKind,
} from "@photonsurge/shared/director";
import {
  breakInCandidate,
  candidateAreaKey,
  selectNext,
  withoutRecentAreas,
  type Candidate,
} from "@photonsurge/shared/director-select";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { airLogCut } from "./airlog";
import { previewNext } from "./upnext";

export { previewNext } from "./upnext";
import type { PendingBreakIn } from "@photonsurge/shared/director-break-in";

const TAG = "director";
/** How many recent segment ids to remember for cooldown/variety. */
export const HISTORY_CAP = 30;
/** Cap the per-segment tally map so a 24/7 run can't grow it unbounded. */
export const SEEN_CAP = 1000;

/** Kinds that share the world-view center — excluded from the geo cooldown.
 *  `ad` has no geography (it covers the globe), so it's exempt too. */
const GLOBAL_KINDS = new Set<SegmentKind>(["intro", "global", "ocean", "orbital", "ad"]);

export interface SceneRunner {
  sceneId: string;
  seq: number;
  history: string[];
  /** Per-segment airing tally: how many times + when it last aired this session. */
  seen: Map<string, { count: number; last: number }>;
  /** [lng,lat] of recently-aired located shots, for the geographic cooldown. */
  recentCenters: [number, number][];
  /** Recent semantic/coarse areas aired by kind (oldest→newest, capped at the
   *  channel's `rotation.areaMemoryCap`), for between-appearance variety. */
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
  /** Set while a Pause command freezes the current shot: the time it had left
   *  is banked and handed back on resume (see commands.ts). */
  paused?: { since: number; until?: number; remainingMs: number };
  /** The first few commands waiting in the queue, for the operator readout. */
  queued: NonNullable<DirectorState["queued"]>;
  /** Breaking events waiting their turn (immediate mode) — never collapsed to one. */
  pending: PendingBreakIn[];
  /** Break-in keys already dealt with (aired, grouped, aged out, dropped). */
  handled: Set<string>;
  lastBreakInAt: number;
  lastRoundupBreakInAt: number;
  /** When a viewer's request last aired — the channel's `everyS` pacing. */
  lastViewerCutAt: number;
}

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
  queued: [],
  pending: [],
  handled: new Set(),
  lastBreakInAt: 0,
  lastRoundupBreakInAt: 0,
  lastViewerCutAt: 0,
});

/** Remember break-in keys as dealt with, capped like the airing tally. */
export function markHandled(r: SceneRunner, keys: Iterable<string>): void {
  for (const k of keys) {
    r.handled.add(k);
    if (r.handled.size > SEEN_CAP) r.handled.delete(r.handled.values().next().value as string);
  }
}

/** Per-segment airing counts BEFORE a cut (id → times shown). */
export function countsOf(r: SceneRunner): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [id, v] of r.seen) counts.set(id, v.count);
  return counts;
}

export function emitState(r: SceneRunner, now: number): void {
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
    ...(r.paused ? { paused: { since: r.paused.since, until: r.paused.until } } : {}),
    queued: r.queued,
    breakInQueue: r.pending.slice(0, 5).map((p) => ({ reason: p.reason, title: p.title, at: p.at })),
    ...(r.lastBreakInAt ? { lastBreakInAt: r.lastBreakInAt } : {}),
  };
  emitWorkerEvent({ type: DIRECTOR_STATE, data: state });
  r.lastEmit = now;
}

/** Tell watchers the director stood down on a scene. */
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

export interface CutMeta {
  db: AppDb;
  cfg: DirectorConfig;
  /** The candidate pool the pick came from (empty for an ad cut, which keeps
   *  the previous "up next" rail). Used for the area memory and the preview. */
  pool: Candidate[];
  now: number;
  /** Why the OUTGOING segment left the screen: an operator skip vs. expiry. */
  skipRequested: boolean;
  /** The incoming pick came via the break-in (priority) tier. */
  breaking: boolean;
  /** The cut was ordered through the command queue — recorded on the as-run log. */
  command?: { source: "operator" | "viewer" | "system"; author?: string };
  /** An explicit "coming up" rail, used as given (a script knows its next
   *  clips). Omitted = previewed from `pool`, or the prior rail kept. */
  upNext?: DirectorState["upNext"];
  /** Write the cut to the as-run log. Default true; editor previews pass
   *  false so they don't litter /admin/runs. */
  record?: boolean;
}

/** Side effects, injectable for tests. */
export interface CutDeps {
  emit: (r: SceneRunner, now: number) => void;
  airLogCut: typeof airLogCut;
}

const DEFAULT_DEPS: CutDeps = { emit: emitState, airLogCut };

/**
 * Put `next` on air: stamp the cut's timing, update every piece of runner
 * bookkeeping, account for ads, emit `director:state` and write the as-run log.
 * Mutates `next` (spinEpoch / cutTransitionMs) and `r`.
 */
export async function performCut(
  r: SceneRunner,
  next: Segment,
  meta: CutMeta,
  deps: CutDeps = DEFAULT_DEPS,
): Promise<void> {
  const { db, cfg, pool, now } = meta;
  // Captured before the cut so we can record how long the outgoing segment
  // actually held the screen (a manual skip cuts it short).
  const prevSegment = r.current;
  const prevStartedAt = r.startedAt;

  r.lastCutWasPriority = meta.breaking;
  if (next.breakIn) {
    if (next.breakIn.reason === "roundup") r.lastRoundupBreakInAt = now;
    else r.lastBreakInAt = now;
  }
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
    while (r.recentCenters.length > cfg.rotation.recentCentersCap) r.recentCenters.shift();
  }
  const selectedCandidate = pool.find((candidate) => candidate.segment.id === next.id);
  const selectedArea = selectedCandidate ? candidateAreaKey(selectedCandidate) : undefined;
  if (selectedArea) {
    // Move-to-front dedupe: revisiting an area (the relax fallback) refreshes
    // its recency rather than double-filling the window.
    const areas = (r.recentAreasByKind.get(next.kind) ?? []).filter((a) => a !== selectedArea);
    areas.push(selectedArea);
    while (areas.length > cfg.rotation.areaMemoryCap) areas.shift();
    r.recentAreasByKind.set(next.kind, areas);
  }

  r.seq += 1;
  r.current = next;
  r.startedAt = now;
  r.endsAt = now + next.holdMs;
  // Ad cuts skip the candidate build, so keep the prior "coming up" rail.
  const counts = countsOf(r);
  r.upNext = meta.upNext ?? (pool.length
    ? previewNext(pool, next.id, counts, {
        breakInActive: cfg.breakIn.enabled && !r.lastCutWasPriority,
        recentAreasByKind: r.recentAreasByKind,
        lastKind: next.kind,
        recentCenters: r.recentCenters,
        geoCooldownDeg: cfg.rotation.geoCooldownDeg,
      })
    : r.upNext);
  r.history.push(next.id);
  if (r.history.length > HISTORY_CAP) r.history.shift();
  r.lastSkipNonce = cfg.skipNonce;

  // Durably record an ad airing (last shown + count) for the admin readout.
  if (next.kind === "ad" && next.ad) {
    r.lastAdId = next.ad.adId;
    await db.ads.markShown(next.ad.adId, new Date(now));
  }

  // The outgoing segment just left the screen — if it was an ad, bank the
  // real time it aired (not the nominal hold) for the admin readout.
  if (prevSegment?.kind === "ad" && prevSegment.ad) {
    await db.ads.recordImpression(prevSegment.ad.adId, now - prevStartedAt);
  }

  deps.emit(r, now);

  // As-run log: persist the cut (and close the outgoing entry) for
  // /admin/runs review. Best-effort — airLogCut never throws.
  if (meta.record ?? true) {
    await deps.airLogCut(db, r, next, {
      skipRequested: meta.skipRequested,
      breaking: meta.breaking,
      now,
      ...(meta.command ? { command: meta.command } : {}),
    });
  }

  log(TAG, `cut`, { sceneId: r.sceneId, seq: r.seq, kind: next.kind, id: next.id, times: r.timesShown });
}
