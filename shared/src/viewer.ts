/**
 * Viewer picks — the worker-owned layer viewers' chat requests write to
 * (music mode, palette, skip / shuffle). A viewer never edits the operator's
 * settings: /watch composes
 *
 *   operator ControlState  ←  director cut  ←  active viewer picks (unexpired)
 *
 * so a pick lapses on the wall clock with no revert logic, and /control's
 * full-state emit can never overwrite it. Map looks are NOT here — they move
 * the camera, so they go through the director command queue.
 *
 * See docs/director-programme-plan.md §3.7.
 */
import type { StreamPlatform } from "./runs";

export type ViewerSlot = "audioMode" | "theme";
export const VIEWER_SLOTS: readonly ViewerSlot[] = ["audioMode", "theme"];

export interface ViewerRequest {
  slot: ViewerSlot;
  /** An AudioMode, or a palette id. */
  value: string;
  /** What to show on air ("Deep", "Aurora"). */
  label: string;
  by: { author: string; platform: StreamPlatform | "sim"; isMod?: boolean };
  requestedAt: number;
  /** When the pick ends, once it is ACTIVE (0 while it waits in the queue). */
  until: number;
  /** The hold it was granted. */
  holdMs: number;
}

export interface ViewerState {
  sceneId: string;
  /** One live pick per slot. */
  active: Partial<Record<ViewerSlot, ViewerRequest>>;
  /** Waiting picks, first in first out, per slot. */
  queue: ViewerRequest[];
  /** Bump = every /watch moves to the next tune. */
  audioSkipEpoch: number;
  /** Bump = every /watch reseeds the arrangement with this value. */
  audioSeed: number;
  updatedAt: number;
}

/** Worker → browsers: a scene's viewer state changed. */
export const VIEWER_STATE = "viewer:state" as const;

export const emptyViewerState = (sceneId: string): ViewerState => ({
  sceneId,
  active: {},
  queue: [],
  audioSkipEpoch: 0,
  audioSeed: 0,
  updatedAt: 0,
});

/**
 * Pure: drop expired picks and promote the next waiting one per slot (its hold
 * starts now). Returns the same object when nothing changed.
 */
export function sweepViewerState(state: ViewerState, now: number): ViewerState {
  let changed = false;
  const active = { ...state.active };
  let queue = state.queue;
  for (const slot of VIEWER_SLOTS) {
    const cur = active[slot];
    if (cur && cur.until > now) continue;
    if (cur) {
      delete active[slot];
      changed = true;
    }
    const i = queue.findIndex((q) => q.slot === slot);
    if (i >= 0) {
      const next = queue[i];
      active[slot] = { ...next, until: now + next.holdMs };
      queue = queue.filter((_, j) => j !== i);
      changed = true;
    }
  }
  return changed ? { ...state, active, queue, updatedAt: now } : state;
}

export type GrantOutcome = "active" | "queued" | "full";

/**
 * Pure: put a request on air if its slot is free, else queue it (refused as
 * "full" past `maxQueued`; 0 = no cap).
 */
export function grantRequest(
  state: ViewerState,
  req: Omit<ViewerRequest, "until">,
  maxQueued: number,
  now: number,
): { state: ViewerState; outcome: GrantOutcome; position?: number } {
  const swept = sweepViewerState(state, now);
  if (!swept.active[req.slot]) {
    return {
      state: { ...swept, active: { ...swept.active, [req.slot]: { ...req, until: now + req.holdMs } }, updatedAt: now },
      outcome: "active",
    };
  }
  if (maxQueued > 0 && swept.queue.length >= maxQueued) return { state: swept, outcome: "full" };
  const queue = [...swept.queue, { ...req, until: 0 }];
  return { state: { ...swept, queue, updatedAt: now }, outcome: "queued", position: queue.filter((q) => q.slot === req.slot).length };
}

/** Pure: the picks in force at `now` (the client re-checks `until` itself). */
export function activePicks(state: ViewerState | null, now: number): Partial<Record<ViewerSlot, ViewerRequest>> {
  if (!state) return {};
  const out: Partial<Record<ViewerSlot, ViewerRequest>> = {};
  for (const slot of VIEWER_SLOTS) {
    const r = state.active[slot];
    if (r && r.until > now) out[slot] = r;
  }
  return out;
}

/** The earliest moment a pick lapses, for a client re-evaluation timer. */
export function nextViewerExpiry(state: ViewerState | null, now: number): number | null {
  const ends = Object.values(activePicks(state, now)).map((r) => r!.until);
  return ends.length ? Math.min(...ends) : null;
}

/** Clear every pick and the queue (the operator's Clear all, or a mod's `:reset`). */
export function clearViewerState(state: ViewerState, now: number): ViewerState {
  return { ...state, active: {}, queue: [], updatedAt: now };
}
