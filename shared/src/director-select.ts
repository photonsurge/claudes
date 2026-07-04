/**
 * Pure segment selection for the auto-director. The worker builds a pool of
 * scored candidates each tick (live events + curated shots); this decides which
 * one airs next. Deterministic given its rng, so it's unit-tested without a DB.
 *
 * Selection model (operator-requested):
 *  0. Priority — ahead of everything but the opener: a fresh round-up narrative
 *     (rare, and it goes stale — get it out while it's current), then any
 *     brand-new quake/storm nobody's seen yet this session. Breaking news
 *     doesn't wait its turn in random kind rotation. See `selectPriority`.
 *  1. Opener — the very first cut of a session is the intro spin. It can also
 *     recur later as ordinary global filler: the intro now TOURS map types as it
 *     spins (temp → cloud → aurora → satellite), so it's no longer the static
 *     shot that had to be shown once and retired.
 *  2. Random kind — each subsequent cut picks a KIND at random from those present
 *     in the pool, avoiding an immediate repeat of the just-aired kind.
 *  3. Fair rotation — within that kind, pick at random among the LEAST-aired
 *     items (by session count). So every region / alert / quake of a kind is
 *     shown once before any repeats; when all are level the whole set is open
 *     again ("random all"). A geographic cooldown spreads located shots so a
 *     cluster of alerts over one country doesn't air back-to-back.
 */
import type { Segment, SegmentKind } from "./director";

export interface Candidate {
  segment: Segment;
  /** Higher = more newsworthy. Kept for the "coming up" preview, not selection. */
  score: number;
}

/** World-view kinds share a single camera center, so they're exempt from the
 *  geographic cooldown (otherwise airing one would block the others). */
const GLOBAL_KINDS = new Set<SegmentKind>(["intro", "ocean", "orbital"]);

/** Suppress a located shot within this many degrees of a recently-aired one. */
export const DEFAULT_GEO_COOLDOWN_DEG = 8;

export interface SelectOpts {
  /** Recent segment ids, oldest→newest — used only to avoid same-kind-in-a-row. */
  history: string[];
  /** Injectable RNG in [0,1); defaults to Math.random. Pass a stub in tests. */
  rng?: () => number;
  /** Per-segment airing counts BEFORE this cut (id → times shown). */
  counts?: Map<string, number>;
  /** True on the first cut of a session — opens on the intro spin. */
  isFirst?: boolean;
  /** [lng,lat] centers of recently-aired located shots, for the geo cooldown. */
  recentCenters?: [number, number][];
  geoCooldownDeg?: number;
}

/** Great-circle-ish degree gap with longitude wrap (good enough for cooldown). */
function degApart(a: [number, number], b: [number, number]): number {
  let dLng = Math.abs(a[0] - b[0]) % 360;
  if (dLng > 180) dLng = 360 - dLng;
  return Math.hypot(dLng, a[1] - b[1]);
}

const pickRandom = <T>(arr: T[], rng: () => number): T =>
  arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/** Kinds eligible for the priority tier, most urgent first. */
const PRIORITY_KINDS: SegmentKind[] = ["summary", "quake", "storm"];

/**
 * Breaking-news preempt: a fresh round-up narrative, or a quake/storm alert
 * nobody's seen yet this session, cut to it now instead of waiting on random
 * kind rotation. Checked before `selectNext` on every cut but the opener —
 * returns null once nothing new is waiting, so the caller falls through to
 * normal fair rotation. `counts` is the same per-segment airing tally passed to
 * `selectNext`; a segment with no entry has never aired this session.
 */
export function selectPriority(pool: Candidate[], counts: Map<string, number>): Segment | null {
  for (const kind of PRIORITY_KINDS) {
    const unaired = pool
      .filter((c) => c.segment.kind === kind && !counts.has(c.segment.id))
      .sort((a, b) => b.score - a.score);
    if (unaired.length > 0) return unaired[0].segment;
  }
  return null;
}

/**
 * Choose the next segment from a pool. Returns null only when the pool is empty
 * (the worker guarantees filler, so in practice it never is).
 */
export function selectNext(pool: Candidate[], opts: SelectOpts): Segment | null {
  if (pool.length === 0) return null;

  const rng = opts.rng ?? Math.random;
  const counts = opts.counts ?? new Map<string, number>();
  const countOf = (id: string) => counts.get(id) ?? 0;

  // 1. Open the session on the intro spin.
  if (opts.isFirst) {
    const intro = pool.find((c) => c.segment.kind === "intro");
    if (intro) return intro.segment;
  }

  // After the opener the intro is a normal candidate — it tours map types now, so
  // it earns a place in the recurring rotation. The "avoid an immediate kind
  // repeat" rule below still keeps it from airing twice back-to-back.
  const eligible = pool.slice();

  // 2. Pick a KIND at random, avoiding an immediate repeat where possible.
  const lastId = opts.history[opts.history.length - 1];
  const lastKind = lastId ? lastId.split(":")[0] : undefined;
  const kinds = [...new Set(eligible.map((c) => c.segment.kind))];
  let kindChoices = kinds.length > 1 ? kinds.filter((k) => k !== lastKind) : kinds;
  if (kindChoices.length === 0) kindChoices = kinds;
  const kind = pickRandom(kindChoices, rng);

  // 3. Within the kind: spread regions out (geo cooldown), then pick at random
  //    among the least-aired so we cycle the whole set before repeating any.
  let ofKind = eligible.filter((c) => c.segment.kind === kind);
  const recentCenters = opts.recentCenters ?? [];
  const geoDeg = opts.geoCooldownDeg ?? DEFAULT_GEO_COOLDOWN_DEG;
  if (recentCenters.length > 0 && !GLOBAL_KINDS.has(kind)) {
    const spread = ofKind.filter(
      (c) => !recentCenters.some((rc) => degApart(c.segment.camera.center, rc) <= geoDeg),
    );
    if (spread.length > 0) ofKind = spread;
  }

  const minCount = Math.min(...ofKind.map((c) => countOf(c.segment.id)));
  const leastShown = ofKind.filter((c) => countOf(c.segment.id) === minCount);
  return pickRandom(leastShown, rng)?.segment ?? null;
}
