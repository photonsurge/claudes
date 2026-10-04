/**
 * The script runner's view of the cut path. There is ONE cut path —
 * `performCut` in ./runner — shared by rotation, break-ins, operator / viewer
 * commands and scripted shorts, so the bookkeeping (tally, geo cooldown, area
 * memory, history, "up next", ads, emit, as-run log) can never drift between
 * them. This module keeps the scripted-shorts call shape
 * (`performCut(r, next, pool, meta)`) on top of it.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig, DirectorState, Segment } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import { DEFAULT_DIRECTOR_ROTATION } from "@photonsurge/shared/director-tuning";
import { emitState, performCut as runnerCut, type SceneRunner } from "./runner";

export { type SceneRunner, newRunner, emitInactive, HISTORY_CAP, SEEN_CAP } from "./runner";

/** The default geo-cooldown memory (`rotation.recentCentersCap`). */
export const GEO_RECENT_CAP = DEFAULT_DIRECTOR_ROTATION.recentCentersCap;

/** Re-emit the current shot (heartbeat / late joiners). */
export const emit = (r: SceneRunner, now: number): void => emitState(r, now);

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

/** Put `next` on air through the shared cut path. */
export async function performCut(r: SceneRunner, next: Segment, pool: Candidate[], meta: CutMeta): Promise<void> {
  await runnerCut(r, next, {
    db: meta.db,
    cfg: meta.cfg,
    now: meta.now,
    pool,
    skipRequested: meta.skipRequested ?? false,
    breaking: meta.pickedViaPriority ?? false,
    ...(meta.upNext ? { upNext: meta.upNext } : {}),
    ...(meta.record !== undefined ? { record: meta.record } : {}),
  });
}
