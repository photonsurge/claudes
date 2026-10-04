/**
 * The viewer-pick sweep: every few seconds, lapse expired music / palette
 * picks and promote the next waiting one, then emit the new state. In-process
 * (like the director loop) and restart-safe — everything it needs is in the
 * viewer-state docs. Clients also re-check `until` themselves, so the sweep
 * only has to be prompt about PROMOTING the next pick.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { getAppDb } from "@photonsurge/shared/db/index";
import { VIEWER_STATE, sweepViewerState, type ViewerState } from "@photonsurge/shared/viewer";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "../socket";

const TAG = "viewer-sweep";
export const VIEWER_SWEEP_MS = 5000;

/** One pass: returns the scenes whose state changed. */
export async function sweepViewers(
  db: Pick<AppDb, "viewerState">,
  now: number,
  emit: (state: ViewerState) => void = (state) => emitWorkerEvent({ type: VIEWER_STATE, data: state }),
): Promise<string[]> {
  const changed: string[] = [];
  for (const state of await db.viewerState.withPicks()) {
    const next = sweepViewerState(state, now);
    if (next === state) continue;
    await db.viewerState.save(next);
    emit(next);
    changed.push(state.sceneId);
  }
  return changed;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the sweep. Idempotent. */
export function startViewerSweep(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweepViewers(await getAppDb(), Date.now());
    } catch (err) {
      log(TAG, "sweep failed", String(err));
    } finally {
      running = false;
    }
  }, VIEWER_SWEEP_MS);
}

export function stopViewerSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
