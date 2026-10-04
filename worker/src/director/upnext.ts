/**
 * The "coming up" rail: a best-guess preview of the next few shots, sampled from
 * the candidate pool the same way the real pick works. Pure — the cut path
 * (runner.ts#performCut) calls it after each cut.
 */
import { focusSubjectOf, type DirectorState, type SegmentKind } from "@photonsurge/shared/director";
import { breakInCandidate, selectNext, withoutRecentAreas, type Candidate } from "@photonsurge/shared/director-select";

/** Fisher–Yates shuffle — used to sample kinds the same unbiased way `selectNext`
 *  actually picks one (uniformly at random), instead of inventing a fake
 *  "readiness order" that mostly ties at 0 and silently freezes to insertion
 *  order (see previewNext's doc comment for why that was wrong). */
function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random pick among a kind's least-aired candidates — mirrors `selectNext`'s
 *  own fair-rotation tie-break exactly (not "highest score"). */
function pickLeastAired(cands: Candidate[], counts: Map<string, number>, rng: () => number): Candidate {
  const countOf = (id: string) => counts.get(id) ?? 0;
  const minCount = Math.min(...cands.map((c) => countOf(c.segment.id)));
  const atMin = cands.filter((c) => countOf(c.segment.id) === minCount);
  return atMin[Math.floor(rng() * atMin.length)];
}

export type UpNextEntry = DirectorState["upNext"][number];

/** Focus params from a segment so /watch can pre-warm its bundle before it airs. */
export function focusOf(seg: Candidate["segment"]): Pick<UpNextEntry, "center" | "zoom" | "subject"> {
  return {
    center: seg.camera.center,
    zoom: seg.camera.zoom,
    // Everything after the kind — a storm's "<source>:<identifier>" and a
    // volcano's "gvp:NNN" carry colons of their own (see focusSubjectOf).
    subject: focusSubjectOf(seg.id),
  };
}

/**
 * Top few upcoming shots (one per kind) for a "coming up" rail — a best-guess
 * hint, not a promise (see the banner's UP NEXT ticker). `selectNext` picks the
 * NEXT kind UNIFORMLY AT RANDOM among those present (excluding the just-aired
 * kind) — there's no "readiness order" to predict, so this samples the same way
 * rather than inventing one. An earlier version sorted kinds by least-aired
 * count, but that mostly ties at 0 and silently freezes to a fixed order, so
 * "up next" showed the same couple of kinds forever.
 *  - If the break-in tier is on and its cooldown permits it, the candidate the
 *    tier would take leads (`breakInCandidate`, the same rule selectPriority uses).
 *  - The remaining slots are a random sample of OTHER kinds (excluding the
 *    kind that just aired, same as the real avoid-immediate-repeat rule),
 *    each showing a random pick among ITS least-aired candidates.
 */
export function previewNext(
  pool: Candidate[],
  excludeId: string,
  counts: Map<string, number>,
  opts: {
    breakInActive: boolean;
    recentAreasByKind: ReadonlyMap<SegmentKind, readonly string[]>;
    lastKind?: SegmentKind;
    recentCenters?: [number, number][];
    geoCooldownDeg?: number;
    rng?: () => number;
  },
): UpNextEntry[] {
  const rng = opts.rng ?? Math.random;
  const eligible = pool.filter((c) => c.segment.id !== excludeId);
  const out: UpNextEntry[] = [];

  if (opts.breakInActive) {
    const breaking = breakInCandidate(eligible, counts, opts.recentAreasByKind);
    if (breaking) {
      out.push({ kind: breaking.segment.kind, title: breaking.segment.title, subtitle: breaking.segment.subtitle, ...focusOf(breaking.segment) });
    }
  }

  const seenKinds = new Set(out.map((o) => o.kind));
  let remainingKinds = [...new Set(eligible.map((c) => c.segment.kind))].filter((k) => !seenKinds.has(k));
  if (opts.lastKind && remainingKinds.length > 1) remainingKinds = remainingKinds.filter((k) => k !== opts.lastKind);

  for (const kind of shuffled(remainingKinds, rng)) {
    const ofKind = eligible.filter((c) => c.segment.kind === kind);
    const cands = withoutRecentAreas(ofKind, kind, opts.recentAreasByKind);
    const pick = (kind === "country" || kind === "region")
      ? selectNext(ofKind, {
          history: [],
          counts,
          recentCenters: opts.recentCenters ?? [],
          recentAreasByKind: opts.recentAreasByKind,
          geoCooldownDeg: opts.geoCooldownDeg,
          rng,
        })!
      : pickLeastAired(cands, counts, rng).segment;
    out.push({ kind, title: pick.title, subtitle: pick.subtitle, ...focusOf(pick) });
    if (out.length >= 3) break;
  }
  return out;
}
