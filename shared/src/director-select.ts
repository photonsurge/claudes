/**
 * Pure segment selection for the auto-director. The worker builds a pool of
 * scored candidates each tick (live events + curated shots); this decides which
 * one airs next. Deterministic given its rng, so it's unit-tested without a DB.
 *
 * Selection model (operator-requested):
 *  0. Priority — ahead of everything but the opener: any brand-new quake/storm/
 *     volcano nobody's seen yet this session. Breaking news doesn't wait its
 *     turn in random kind rotation. (Round-ups aren't priority — they ride the
 *     recurring `global` spin and surface through fair rotation, once each.)
 *     Only
 *     candidates the builder actually flags `breaking` are eligible here — an
 *     older event that's merely unaired-this-session (e.g. a backlog of
 *     days-old quakes right after the session starts) does NOT camp this tier
 *     and starve every other kind; it just airs later through fair rotation.
 *     A cooldown also caps priority to at most every OTHER cut, so a
 *     continuous global stream of genuinely-new alerts can't monopolize every
 *     single cut either. See `selectPriority`.
 *  1. Opener — the very first cut of a session is the `intro` spin, then the
 *     intro is retired for the rest of the session (it never recurs in
 *     rotation). The ongoing world spin is its own kind, `global`, which TOURS
 *     the same map types (temp → cloud → aurora → satellite) and airs as
 *     ordinary recurring global filler like any other kind.
 *  2. Random kind — each subsequent cut picks a KIND at random from those present
 *     in the pool (biased by the operator's per-kind weights, absent = 1),
 *     avoiding an immediate repeat of the just-aired kind.
 *  3. Fair rotation — within that kind, pick at random among the LEAST-aired
 *     items (by session count). So every region / alert / quake of a kind is
 *     shown once before any repeats; when all are level the whole set is open
 *     again ("random all"). A geographic cooldown spreads located shots so a
 *     cluster of alerts over one country doesn't air back-to-back, and each
 *     kind remembers its last few aired areas (AREA_MEMORY_CAP) so it keeps
 *     moving to fresh countries instead of ping-ponging between two.
 */
import type { Segment, SegmentKind } from "./director";

export interface Candidate {
  segment: Segment;
  /** Higher = more newsworthy. Kept for the "coming up" preview, not selection. */
  score: number;
  /**
   * Stable editorial area for variety within one kind (for example `country:KZ`
   * on a Kazakhstan weather alert). When absent, located shots fall back to a
   * coarse geographic cell derived from their camera centre.
   */
  areaKey?: string;
  /**
   * Eligible to preempt fair rotation via `selectPriority` (see PRIORITY_KINDS).
   * Defaults to true when omitted. Set false for a priority-kind candidate that's
   * merely unaired-this-session but not actually recent — e.g. a backlog of
   * days-old quakes shouldn't ALL cut the line ahead of every other kind just
   * because a fresh session hasn't shown them yet; they still air, but through
   * normal fair rotation like any other candidate.
   */
  breaking?: boolean;
}

/** World-view kinds share a single camera center, so they're exempt from the
 *  geographic cooldown (otherwise airing one would block the others). */
const GLOBAL_KINDS = new Set<SegmentKind>(["intro", "global", "ocean", "orbital"]);

/** Suppress a located shot within this many degrees of a recently-aired one. */
export const DEFAULT_GEO_COOLDOWN_DEG = 8;

/**
 * How many recently-aired areas each kind remembers (and avoids revisiting)
 * between its appearances. 3 forces a kind through four distinct areas before
 * one can recur — one-step avoidance alone let a pool dominated by a single
 * country (Kazakhstan during a bulk warning issuance) ping-pong between it and
 * whichever lone neighbour was also in the pool.
 */
export const AREA_MEMORY_CAP = 3;

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
  /** Areas each kind recently aired (oldest→newest, capped at AREA_MEMORY_CAP),
   *  so a kind keeps visiting fresh areas instead of ping-ponging between two. */
  recentAreasByKind?: ReadonlyMap<SegmentKind, readonly string[]>;
  geoCooldownDeg?: number;
  /**
   * Relative airtime multiplier per kind (DirectorConfig.kindWeights); absent
   * kind = 1. Biases the random KIND pick — fair rotation within a kind is
   * unchanged.
   */
  kindWeights?: Partial<Record<SegmentKind, number>>;
}

/**
 * Area identity used by the per-kind variety rule. Candidate builders can
 * provide a semantic key (alerts use their country); other located subjects use
 * a deliberately broad cell so a later cut of the same kind moves to a visibly
 * different part of the map. World-view kinds have no geographic identity.
 */
export function candidateAreaKey(candidate: Candidate): string | undefined {
  if (GLOBAL_KINDS.has(candidate.segment.kind)) return undefined;
  if (candidate.areaKey) return candidate.areaKey;
  return coarseGeoCell(candidate.segment.camera.center);
}

/** The deliberately broad 30°×20° cell behind candidateAreaKey's fallback.
 *  Exported so candidate builders can bucket subjects by the same identity
 *  (the storm pool's per-country cap uses it for alerts whose source encodes
 *  no country). */
export function coarseGeoCell(center: [number, number]): string | undefined {
  const [rawLng, rawLat] = center;
  if (!Number.isFinite(rawLng) || !Number.isFinite(rawLat)) return undefined;
  const lng = ((((rawLng + 180) % 360) + 360) % 360) - 180;
  const lat = Math.max(-90, Math.min(90, rawLat));
  const lngCell = Math.min(11, Math.floor((lng + 180) / 30));
  const latCell = Math.min(8, Math.floor((lat + 90) / 20));
  return `cell:${lngCell}:${latCell}`;
}

/**
 * Prefer areas this kind hasn't visited recently. When blocking the whole
 * recent window would empty the pool, relax it oldest-first — the most recent
 * area stays blocked the longest, so even a two-country pool alternates rather
 * than repeating — and only when EVERY candidate is in the just-aired area does
 * it give up and return the pool unchanged (never empty it). Exported so the
 * loop's non-binding "up next" preview filters with exactly this rule instead
 * of a drifting mirror copy.
 */
export function withoutRecentAreas(
  candidates: Candidate[],
  kind: SegmentKind,
  recentAreasByKind?: ReadonlyMap<SegmentKind, readonly string[]>,
): Candidate[] {
  const recent = recentAreasByKind?.get(kind);
  if (!recent || recent.length === 0) return candidates;
  for (let depth = recent.length; depth > 0; depth--) {
    const blocked = new Set(recent.slice(recent.length - depth));
    const elsewhere = candidates.filter((candidate) => {
      const area = candidateAreaKey(candidate);
      return area === undefined || !blocked.has(area);
    });
    if (elsewhere.length > 0) return elsewhere;
  }
  return candidates;
}

/** Great-circle-ish degree gap with longitude wrap (good enough for cooldown). */
function degApart(a: [number, number], b: [number, number]): number {
  let dLng = Math.abs(a[0] - b[0]) % 360;
  if (dLng > 180) dLng = 360 - dLng;
  return Math.hypot(dLng, a[1] - b[1]);
}

const pickRandom = <T>(arr: T[], rng: () => number): T =>
  arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/**
 * Weighted cousin of pickRandom for the kind draw: one cumulative-weight roll,
 * weight `weights[k] ?? 1`. With no weights map (or all-equal weights) this is
 * exactly uniform, so existing stubbed-rng tests keep their outcomes.
 */
function pickKindWeighted(
  kinds: SegmentKind[],
  weights: Partial<Record<SegmentKind, number>> | undefined,
  rng: () => number,
): SegmentKind {
  const w = kinds.map((k) => {
    const v = weights?.[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
  });
  const total = w.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < kinds.length; i++) {
    roll -= w[i];
    if (roll < 0) return kinds[i];
  }
  return kinds[kinds.length - 1];
}

/** Kinds eligible for the priority tier, most urgent first. Exported so the
 *  "up next" preview (worker/src/director/loop.ts) can mirror this same
 *  ordering instead of drifting out of sync with its own copy. */
export const PRIORITY_KINDS: SegmentKind[] = ["quake", "storm", "volcano"];

/**
 * Breaking-news preempt: a quake/storm/volcano nobody's seen yet this session,
 * cut to it now instead of waiting on random kind rotation. Checked before
 * `selectNext` on every cut but the opener —
 * returns null once nothing new is waiting, so the caller falls through to
 * normal fair rotation. `counts` is the same per-segment airing tally passed to
 * `selectNext`; a segment with no entry has never aired this session.
 *
 * `opts.cooldown` forces a null (no preempt) regardless of what's waiting. The
 * caller sets it when the PREVIOUS cut was itself a priority pick: across
 * NWS + Meteoalarm + WMO + GDACS combined, some alert somewhere on the planet
 * is almost always freshly onset, so without a cooldown "breaking news"
 * preempts every single cut forever and the show never reaches fair rotation
 * at all — the opposite of "rare interrupt." The cooldown guarantees at least
 * one normal cut between any two priority cuts.
 */
export function selectPriority(
  pool: Candidate[],
  counts: Map<string, number>,
  opts?: { cooldown?: boolean; recentAreasByKind?: ReadonlyMap<SegmentKind, readonly string[]> },
): Segment | null {
  if (opts?.cooldown) return null;
  for (const kind of PRIORITY_KINDS) {
    const unaired = withoutRecentAreas(
      pool.filter((c) => c.segment.kind === kind && !counts.has(c.segment.id) && c.breaking !== false),
      kind,
      opts?.recentAreasByKind,
    ).sort((a, b) => b.score - a.score);
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

  // After the opener the intro is retired for the session — it's a one-time
  // establishing shot, not recurring filler. The recurring world spin is the
  // `global` kind (identical tour), which stays eligible below. Guard against a
  // pool that somehow holds only the intro (every other kind disabled) so we
  // still return a segment rather than nothing.
  let eligible = pool.filter((c) => c.segment.kind !== "intro");
  if (eligible.length === 0) eligible = pool.slice();

  // 2. Pick a KIND at random, avoiding an immediate repeat where possible.
  const lastId = opts.history[opts.history.length - 1];
  const lastKind = lastId ? lastId.split(":")[0] : undefined;
  const kinds = [...new Set(eligible.map((c) => c.segment.kind))];
  let kindChoices = kinds.length > 1 ? kinds.filter((k) => k !== lastKind) : kinds;
  if (kindChoices.length === 0) kindChoices = kinds;
  const kind = pickKindWeighted(kindChoices, opts.kindWeights, rng);

  // 3. Within the kind: spread regions out (geo cooldown), then pick at random
  //    among the least-aired so we cycle the whole set before repeating any.
  let ofKind = eligible.filter((c) => c.segment.kind === kind);
  ofKind = withoutRecentAreas(ofKind, kind, opts.recentAreasByKind);
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
