/**
 * Pure segment selection for the auto-director. The worker builds a pool of
 * scored candidates each tick (live events + curated tour shots); this decides
 * which one airs next. Deterministic and side-effect-free so it's unit-tested
 * without a DB or socket.
 *
 * Rules, in order:
 *  1. Cooldown — never re-air a segment id seen in the recent history window.
 *  2. Variety  — prefer a different kind than the segment that just aired.
 *  3. Score    — highest score wins; ties break by id for stability.
 *  4. Fallback — if cooldown leaves nothing, relax it rather than air dead time.
 */
import type { Segment } from "./director";

export interface Candidate {
  segment: Segment;
  /** Higher = more newsworthy. Tour/filler sit low; live events rank above. */
  score: number;
}

/** How many recent segment ids to keep on cooldown. */
export const DEFAULT_COOLDOWN = 6;

export interface SelectOpts {
  /** Recent segment ids, oldest→newest. The last entry is what's on air now. */
  history: string[];
  cooldown?: number;
}

const byScoreThenId = (a: Candidate, b: Candidate): number =>
  b.score - a.score || (a.segment.id < b.segment.id ? -1 : a.segment.id > b.segment.id ? 1 : 0);

/**
 * Choose the next segment from a scored pool. Returns null only when the pool is
 * empty (the worker guarantees tour candidates, so in practice it never is).
 */
export function selectNext(pool: Candidate[], opts: SelectOpts): Segment | null {
  if (pool.length === 0) return null;

  const cooldown = opts.cooldown ?? DEFAULT_COOLDOWN;
  const recent = new Set(opts.history.slice(-cooldown));
  // Segment ids are `${kind}:${subject}`, so the just-aired kind comes straight
  // from the last history id — that segment is no longer in the pool to look up.
  const lastId = opts.history[opts.history.length - 1];
  const lastKind = lastId ? lastId.split(":")[0] : undefined;

  // 1. Drop anything still cooling down. If that empties the pool, relax it so
  //    the channel keeps moving rather than airing the same shot twice.
  let eligible = pool.filter((c) => !recent.has(c.segment.id));
  if (eligible.length === 0) eligible = pool.slice();

  // 2. Prefer a different kind than what just aired (avoids 3 quakes in a row).
  const fresh = lastKind ? eligible.filter((c) => c.segment.kind !== lastKind) : eligible;
  const ranked = (fresh.length > 0 ? fresh : eligible).slice().sort(byScoreThenId);

  return ranked[0]?.segment ?? null;
}
