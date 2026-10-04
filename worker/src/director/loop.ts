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
import { type Segment } from "@photonsurge/shared/director";
import { selectNext, selectPriority, type Candidate } from "@photonsurge/shared/director-select";
import { log } from "@photonsurge/shared/utill/logger";
import { buildCandidates, buildAdSegment } from "./candidates";
import { airLogSceneOff } from "./airlog";
import { type SceneRunner, newRunner, emit, emitInactive, performCut } from "./cut";

const TAG = "director";
const TICK_MS = 1000;
/** Re-emit the current segment at least this often so late joiners sync. */
const HEARTBEAT_MS = 2500;

const runners = new Map<string, SceneRunner>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

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

      const skipRequested = cfg.skipNonce > r.lastSkipNonce;
      const expired = !r.current || now >= r.endsAt;

      if (expired || skipRequested) {
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
          await performCut(r, next, pool, { db, cfg, now, skipRequested, pickedViaPriority });
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
