/**
 * Scheduling clock for the audio bed — "A Tale of Two Clocks" with two twists
 * for a page whose main thread stalls (a director cut freezes /watch for
 * 250–400 ms): a long lookahead so the audio thread always has music queued,
 * and a resync rule that DROPS the steps we missed instead of firing them late
 * and bunched — a stall costs a beat of silence, never a beat out of time.
 * The tick itself comes from a Web Worker so background-tab timer throttling
 * can't starve it; plain setInterval is the fallback.
 */

/** How far ahead of the audio clock steps are queued, seconds. */
export const LOOKAHEAD_S = 1.2;
/** Ticker period, ms. Coarse is fine: the lookahead does the real work. */
export const TICK_MS = 100;
/** Once behind by more than this, skip ahead rather than fire late. */
export const LATE_SLACK_S = 0.05;

export interface GridPos {
  /** 16th-note step counter (bar = 16). */
  step: number;
  /** Audio-clock time the step is due, seconds. */
  time: number;
}

/**
 * Where scheduling resumes. In the normal case the next step is still in the
 * future and nothing changes. If the clock overran it by more than the slack,
 * jump to the first step after now + slack, advancing the step counter by the
 * same amount so bars, chords and fills stay on the grid.
 */
export function resyncGrid(pos: GridPos, now: number, stepS: number, slack = LATE_SLACK_S): GridPos & { dropped: number } {
  if (pos.time >= now - slack) return { ...pos, dropped: 0 };
  const missed = Math.ceil((now + slack - pos.time) / stepS);
  return { step: pos.step + missed, time: pos.time + missed * stepS, dropped: missed };
}

/**
 * Start a ticker that calls `onTick` every `ms`, from a Worker when possible.
 * Returns the stop function.
 */
export function startTicker(onTick: () => void, ms = TICK_MS): () => void {
  if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL?.createObjectURL === "function") {
    try {
      const src = `let t=null;onmessage=e=>{clearInterval(t);if(e.data==="start")t=setInterval(()=>postMessage(0),${ms})};`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const w = new Worker(url);
      w.onmessage = () => onTick();
      w.postMessage("start");
      return () => {
        w.postMessage("stop");
        w.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      /* CSP or no worker support: fall through to a DOM timer */
    }
  }
  const id = setInterval(onTick, ms);
  return () => clearInterval(id);
}
