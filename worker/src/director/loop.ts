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
  focusSubjectOf,
} from "@photonsurge/shared/director";
import {
  selectNext,
  selectPriority,
  candidateAreaKey,
  withoutRecentAreas,
  AREA_MEMORY_CAP,
  PRIORITY_KINDS,
  type Candidate,
} from "@photonsurge/shared/director-select";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { buildCandidates, buildAdSegment } from "./candidates";
import { airLogCut, airLogSceneOff } from "./airlog";

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
const GLOBAL_KINDS = new Set<SegmentKind>(["intro", "global", "ocean", "orbital", "ad"]);
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

/** Fisher–Yates shuffle — used to sample kinds the same unbiased way `selectNext`
 *  actually picks one (uniformly at random), instead of inventing a fake
 *  "readiness order" that mostly ties at 0 and silently freezes to insertion
 *  order (see previewNext's doc comment for why that was wrong). */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random pick among a kind's least-aired candidates — mirrors `selectNext`'s
 *  own fair-rotation tie-break exactly (not "highest score"). */
function pickLeastAired(cands: Candidate[], counts: Map<string, number>): Candidate {
  const countOf = (id: string) => counts.get(id) ?? 0;
  const minCount = Math.min(...cands.map((c) => countOf(c.segment.id)));
  const atMin = cands.filter((c) => countOf(c.segment.id) === minCount);
  return atMin[Math.floor(Math.random() * atMin.length)];
}

/**
 * Top few upcoming shots (one per kind) for a "coming up" rail — a best-guess
 * hint, not a promise (see the banner's UP NEXT ticker). `selectNext` picks the NEXT kind
 * UNIFORMLY AT RANDOM among those present (excluding the just-aired kind) —
 * there's no "readiness order" to predict, so this samples the same way
 * rather than inventing one. An earlier version sorted kinds by least-aired
 * count, but that mostly ties at 0 and silently freezes to a fixed order
 * (whichever kind happens to build first), so "up next" would show the same
 * couple of kinds forever regardless of what actually aired next — reads as
 * flatly wrong once you watch it not budge cut after cut.
 *  - If the cooldown gate (see `selectPriority`) permits it, the single
 *    highest-scored still-unaired breaking candidate leads, same as the real
 *    priority tier would pick.
 *  - The remaining slots are a random sample of OTHER kinds (excluding the
 *    kind that just aired, same as the real avoid-immediate-repeat rule),
 *    each showing a random pick among ITS least-aired candidates.
 */
type UpNextEntry = DirectorState["upNext"][number];

/** Focus params from a segment so /watch can pre-warm its bundle before it airs. */
function focusOf(seg: Candidate["segment"]): Pick<UpNextEntry, "center" | "zoom" | "subject"> {
  return {
    center: seg.camera.center,
    zoom: seg.camera.zoom,
    // Everything after the kind — a storm's "<source>:<identifier>" and a
    // volcano's "gvp:NNN" carry colons of their own (see focusSubjectOf).
    subject: focusSubjectOf(seg.id),
  };
}

function previewNext(
  pool: Candidate[],
  excludeId: string,
  counts: Map<string, number>,
  cooldownActive: boolean,
  recentAreasByKind: ReadonlyMap<SegmentKind, readonly string[]>,
  lastKind?: SegmentKind,
  recentCenters: [number, number][] = [],
): UpNextEntry[] {
  const eligible = pool.filter((c) => c.segment.id !== excludeId);
  const out: UpNextEntry[] = [];

  if (!cooldownActive) {
    let breaking: Candidate | undefined;
    for (const kind of PRIORITY_KINDS) {
      const ofKind = withoutRecentAreas(
        eligible.filter((c) => c.segment.kind === kind && c.breaking !== false && !counts.has(c.segment.id)),
        kind,
        recentAreasByKind,
      ).sort((a, b) => b.score - a.score);
      if (ofKind.length) {
        breaking = ofKind[0];
        break;
      }
    }
    if (breaking) out.push({ kind: breaking.segment.kind, title: breaking.segment.title, subtitle: breaking.segment.subtitle, ...focusOf(breaking.segment) });
  }

  const seenKinds = new Set(out.map((o) => o.kind));
  let remainingKinds = [...new Set(eligible.map((c) => c.segment.kind))].filter((k) => !seenKinds.has(k));
  if (lastKind && remainingKinds.length > 1) remainingKinds = remainingKinds.filter((k) => k !== lastKind);

  for (const kind of shuffled(remainingKinds)) {
    const ofKind = eligible.filter((c) => c.segment.kind === kind);
    const cands = withoutRecentAreas(
      ofKind,
      kind,
      recentAreasByKind,
    );
    const pick = (kind === "country" || kind === "region")
      ? selectNext(ofKind, { history: [], counts, recentCenters, recentAreasByKind })!
      : pickLeastAired(cands, counts).segment;
    out.push({ kind, title: pick.title, subtitle: pick.subtitle, ...focusOf(pick) });
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
          // A brand-new quake/storm/volcano nobody's seen this session outranks
          // a scheduled ad break — build the pool early just to check, and defer
          // the ad by one cut rather than let it stall breaking news.
          pool = await buildCandidates(db, cfg, counts);
          priority = r.seq > 0
            ? selectPriority(pool, counts, { cooldown, recentAreasByKind: r.recentAreasByKind })
            : null;
          if (priority) {
            r.pendingAd = true;
          } else {
            next = await buildAdSegment(db, cfg, r.current?.camera, r.lastAdId);
          }
        }
        if (!next) {
          if (!pool.length) pool = await buildCandidates(db, cfg, counts);
          // Breaking news preempts random rotation on every cut but the very
          // first (which always opens on the intro) — a brand-new quake/storm/
          // volcano airs at the next opportunity, not whenever fair rotation
          // happens to land on its kind.
          next = priority ?? (
            r.seq > 0
              ? selectPriority(pool, counts, { cooldown, recentAreasByKind: r.recentAreasByKind })
              : null
          );
          if (next) {
            pickedViaPriority = true;
          } else {
            next = selectNext(pool, {
              history: r.history,
              recentCenters: r.recentCenters,
              recentAreasByKind: r.recentAreasByKind,
              counts,
              isFirst: r.seq === 0,
              kindWeights: cfg.kindWeights,
            });
          }
        }
        if (next) {
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
          r.upNext = pool.length
            ? previewNext(pool, next.id, counts, r.lastCutWasPriority, r.recentAreasByKind, next.kind, r.recentCenters)
            : r.upNext;
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
          await airLogCut(db, r, next, { skipRequested, breaking: pickedViaPriority, now });

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
