/**
 * Pure ad picker for the auto-director's "commercial break" cadence. True
 * rotation: every ACTIVE ad airs once before any of them repeats, using the
 * durable `timesShown`/`lastShownAt` tallies (survives worker restarts, so a
 * restart can't reset the cycle and re-favor one ad). `weight` only breaks a
 * genuine tie among ads that are equally due — it no longer skews the odds of
 * an otherwise-due ad being skipped, which is what let one ad dominate.
 * Deterministic given its rng, so it's unit-tested without a DB.
 *
 * `excludeAdId` (the previous airing) is a last-resort tiebreaker so two
 * consecutive breaks don't repeat — unless it's the only active ad, in which
 * case showing it again beats skipping the break.
 */
import type { Ad } from "./types";

export function pickAdForAir(
  ads: Ad[],
  rng: () => number = Math.random,
  excludeAdId?: string,
): Ad | null {
  const active = ads.filter((a) => a.status === "active");
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  const timesShown = (a: Ad) => a.timesShown ?? 0;
  const lastShownAt = (a: Ad) => a.lastShownAt ?? -Infinity;
  const weightOf = (a: Ad) => (typeof a.weight === "number" && a.weight > 0 ? a.weight : 1);

  // Whoever has aired the fewest times is due next; ties go to whoever aired
  // longest ago (or never at all).
  const minShown = Math.min(...active.map(timesShown));
  const leastShown = active.filter((a) => timesShown(a) === minShown);
  const oldestAt = Math.min(...leastShown.map(lastShownAt));
  let due = leastShown.filter((a) => lastShownAt(a) === oldestAt);

  // Still tied (e.g. several never-shown ads) — prefer the operator's higher
  // weight, then avoid repeating the previous airing, then pick at random.
  if (due.length > 1) {
    const maxWeight = Math.max(...due.map(weightOf));
    due = due.filter((a) => weightOf(a) === maxWeight);
  }
  if (due.length > 1 && excludeAdId) {
    const withoutPrev = due.filter((a) => a.adId !== excludeAdId);
    if (withoutPrev.length > 0) due = withoutPrev;
  }
  if (due.length === 1) return due[0];
  return due[Math.min(due.length - 1, Math.floor(rng() * due.length))];
}
