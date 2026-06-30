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
  type DirectorState,
  type Segment,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { selectNext, type Candidate } from "@photonsurge/shared/director-select";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";
import { buildCandidates } from "./candidates";

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
  current: Segment | null;
  startedAt: number;
  endsAt: number;
  upNext: { kind: SegmentKind; title: string }[];
  lastSkipNonce: number;
  lastEmit: number;
}

const runners = new Map<string, SceneRunner>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

const newRunner = (sceneId: string): SceneRunner => ({
  sceneId,
  seq: 0,
  history: [],
  current: null,
  startedAt: 0,
  endsAt: 0,
  upNext: [],
  lastSkipNonce: 0,
  lastEmit: 0,
});

/** Top few upcoming shots (one per kind) for a "coming up" rail. */
function previewNext(pool: Candidate[], excludeId: string): { kind: SegmentKind; title: string }[] {
  const seenKinds = new Set<SegmentKind>();
  const out: { kind: SegmentKind; title: string }[] = [];
  for (const c of [...pool].sort((a, b) => b.score - a.score)) {
    if (c.segment.id === excludeId || seenKinds.has(c.segment.kind)) continue;
    seenKinds.add(c.segment.kind);
    out.push({ kind: c.segment.kind, title: c.segment.title });
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
        const pool = await buildCandidates(db, cfg);
        const next = selectNext(pool, { history: r.history });
        if (next) {
          // Anchor any idle-spin to the cut instant so the spin phase is clean.
          if (next.patch.autoSpin) next.patch.spinEpoch = now;
          r.seq += 1;
          r.current = next;
          r.startedAt = now;
          r.endsAt = now + next.holdMs;
          r.upNext = previewNext(pool, next.id);
          r.history.push(next.id);
          if (r.history.length > HISTORY_CAP) r.history.shift();
          r.lastSkipNonce = cfg.skipNonce;
          emit(r, now);
          log(TAG, `cut`, { sceneId, seq: r.seq, kind: next.kind, id: next.id });
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
