/**
 * Pure ad picker for the auto-director's "commercial break" cadence. Chooses one
 * ACTIVE ad at random, weighted by each ad's `weight` (the operator's rotation
 * dial — higher shows more often). Deterministic given its rng, so it's
 * unit-tested without a DB. `lastShownAt` is intentionally NOT used here — weight
 * drives frequency; the timestamp is a display-only readout.
 *
 * `excludeAdId` (the previous airing) is filtered out of the pool first, so two
 * consecutive breaks never repeat the same ad — unless it's the only active one,
 * in which case showing it again beats skipping the break.
 */
import type { Ad } from "./types";

export function pickAdForAir(
  ads: Ad[],
  rng: () => number = Math.random,
  excludeAdId?: string,
): Ad | null {
  const activeAll = ads.filter((a) => a.status === "active");
  if (activeAll.length === 0) return null;

  const active =
    excludeAdId && activeAll.length > 1
      ? activeAll.filter((a) => a.adId !== excludeAdId)
      : activeAll;

  const weights = active.map((a) => (typeof a.weight === "number" && a.weight > 0 ? a.weight : 0));
  const total = weights.reduce((s, w) => s + w, 0);

  // All zero-weight (or all weights absent) → uniform random among active ads.
  if (total <= 0) {
    return active[Math.min(active.length - 1, Math.floor(rng() * active.length))];
  }

  let roll = rng() * total;
  for (let i = 0; i < active.length; i++) {
    roll -= weights[i];
    if (roll < 0) return active[i];
  }
  return active[active.length - 1];
}
