"use client";

/**
 * RUN PACING — the one convention both on-air decks use to decide when to turn
 * the page.
 *
 * Neither deck sets a dwell any more. Each asks the card that is on air "have
 * you finished showing yourself?" and turns over when the answer is yes, `runs`
 * times. A RUN is the card's content presented once, end to end:
 *
 *   • bottom-left (SlideDeck)      one full top→bottom scroll pass of the body
 *                                  (AutoScroll), or — when the body fits — the
 *                                  time it takes to READ it at the channel's
 *                                  reading pace;
 *   • top-right (WorldReportDeck)  one LAP of the slide's ACTIVE FEED marquee,
 *                                  every row shown once (WorldFeed).
 *
 * Before this, each deck ran a `setInterval` that knew nothing about its cards,
 * so a dense slide was cut mid-scroll while a sparse one sat in dead air — and
 * on the right the mismatch was structural: a 20-row feed stepping a row every
 * ~3 s needs a full minute to come round, but the slide flipped at 6 s, so rows
 * 3–20 were never seen by anyone on any channel.
 *
 * The moving part inside a card CLAIMS the clock on mount (`claim()`), which
 * tells the deck not to fall back to its own timer for that slide, and calls
 * `done()` once it has completed `runs` runs. Everything is clamped between a
 * floor (`slideHoldMs` / `reportHoldMs`) and a safety ceiling, so a card that
 * never reports — one with no moving part, or one whose data never arrives —
 * behaves exactly as it did before.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

export interface RunPacing {
  /** Complete runs through the card before the deck advances. */
  runs: number;
  /** Called by the card's moving part on mount: "I own this slide's clock."
   *  Returns the release for the effect's cleanup. */
  claim: () => () => void;
  /** Called once `runs` runs are complete. Later calls for the same slide are
   *  ignored by the deck. */
  done: () => void;
}

/** Null off-deck (a standalone card) — then nothing claims and nothing reports. */
export const RunPacingContext = createContext<RunPacing | null>(null);

export function useRunPacing(): RunPacing | null {
  return useContext(RunPacingContext);
}

/**
 * Claim the slide's run clock for the lifetime of the calling component and get
 * back the run count to aim at, plus the reporter. `active` false (an off-air
 * slide kept mounted) claims nothing and reports nothing.
 */
export function useRunClaim(active = true): { runs: number; done: () => void } {
  const pacing = useRunPacing();
  useEffect(() => {
    if (!pacing || !active) return;
    return pacing.claim();
  }, [pacing, active]);
  const done = useCallback(() => {
    if (active) pacing?.done();
  }, [pacing, active]);
  return { runs: pacing?.runs ?? Infinity, done };
}

/**
 * The deck side. Drives a page index that advances when the on-air card reports
 * its runs done — never before `floorMs`, never after `ceilingMs`.
 *
 * `key` identifies the current page: changing it (a new slide, or a new segment
 * on the left) starts a fresh clock and makes any late report from the previous
 * page a no-op, so a director cut can't hand the incoming slide a stale advance.
 */
export function useRunClock({
  key,
  floorMs,
  ceilingMs,
  runs,
  enabled = true,
  onAdvance,
}: {
  key: string;
  floorMs: number;
  ceilingMs: number;
  runs: number;
  /** False for a single-card deck — nothing to advance to. */
  enabled?: boolean;
  onAdvance: () => void;
}): RunPacing {
  // All of the clock lives in a ref: a run report arrives from inside a rAF
  // loop, and anything that cost a React commit per frame would put a render on
  // every /watch frame (docs/watch-perf-plan.md).
  const st = useRef({ key, startedAt: 0, fired: false, claims: 0, advance: onAdvance });
  st.current.advance = onAdvance;
  if (st.current.key !== key) {
    // A fresh page starts a fresh clock; the old page's claims are released by
    // their own effect cleanups, which clamp at zero.
    st.current = { key, startedAt: 0, fired: false, claims: 0, advance: onAdvance };
  }

  /** Advance, once, and only if the page that scheduled it is still on air — a
   *  director cut must not hand the incoming slide the outgoing one's advance. */
  const fireFor = useCallback((k: string) => {
    const s = st.current;
    if (s.key !== k || s.fired) return;
    s.fired = true;
    s.advance();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const k = key;
    st.current.startedAt = Date.now();
    st.current.fired = false;
    // Floor: also the whole clock for a page nothing claimed — no moving part,
    // or data that never landed. Such a page holds exactly the dwell it used to,
    // which is what makes this safe to drop into a live deck.
    const floorT = setTimeout(() => {
      if (st.current.claims === 0) fireFor(k);
    }, floorMs);
    // Ceiling: a claimed page whose runs never complete (a marquee waiting on a
    // feed that never arrives) can't wedge the deck.
    const ceilT = setTimeout(() => fireFor(k), Math.max(floorMs, ceilingMs));
    return () => {
      clearTimeout(floorT);
      clearTimeout(ceilT);
    };
  }, [key, floorMs, ceilingMs, enabled, fireFor]);

  const claim = useCallback(() => {
    st.current.claims += 1;
    return () => {
      st.current.claims = Math.max(0, st.current.claims - 1);
    };
  }, []);

  const done = useCallback(() => {
    const s = st.current;
    if (s.fired) return;
    const k = s.key;
    const waited = Date.now() - s.startedAt;
    // Finished early (a one-line card at a fast pace) — serve out the floor
    // rather than flashing past. The key check makes the deferred call a no-op
    // if the deck has moved on in the meantime.
    if (waited >= floorMs) fireFor(k);
    else setTimeout(() => fireFor(k), floorMs - waited);
  }, [floorMs, fireFor]);

  // Stable identity: this object is the context value every mounted slide reads,
  // and a fresh one per render would re-run each claimer's effect (and churn the
  // claim count) on every commit of the deck.
  return useMemo(() => ({ runs: Math.max(1, runs), claim, done }), [runs, claim, done]);
}
