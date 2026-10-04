/**
 * The "coming up" rail: a best-guess preview of the next few shots, sampled from
 * the candidate pool the same way the real pick works. Pure — the cut path
 * (cut.ts#performCut) calls it after each cut.
 */
import {
  type DirectorState,
  type SegmentKind,
  focusSubjectOf,
} from "@photonsurge/shared/director";
import {
  selectNext,
  withoutRecentAreas,
  PRIORITY_KINDS,
  type Candidate,
} from "@photonsurge/shared/director-select";

/** Fisher–Yates shuffle — used to sample kinds the same unbiased way `selectNext`
 *  actually picks one (uniformly at random), instead of inventing a fake
 *  "readiness order" that mostly ties at 0 and silently freezes to insertion
 *  order (see previewNext's doc comment for why that was wrong). */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random pick among a kind's least-aired candidates — mirrors `selectNext`'s
 *  own fair-rotation tie-break exactly (not "highest score"). */
function pickLeastAired(cands: Candidate[], counts: Map<string, number>): Candidate {
  const countOf = (id: string) => counts.get(id) ?? 0;
  const minCount = Math.min(...cands.map((c) => countOf(c.segment.id)));
  const atMin = cands.filter((c) => countOf(c.segment.id) === minCount);
  return atMin[Math.floor(Math.random() * atMin.length)];
}

/**
 * Top few upcoming shots (one per kind) for a "coming up" rail — a best-guess
 * hint, not a promise (see the banner's UP NEXT ticker). `selectNext` picks the NEXT kind
 * UNIFORMLY AT RANDOM among those present (excluding the just-aired kind) —
 * there's no "readiness order" to predict, so this samples the same way
 * rather than inventing one. An earlier version sorted kinds by least-aired
 * count, but that mostly ties at 0 and silently freezes to a fixed order
 * (whichever kind happens to build first), so "up next" would show the same
 * couple of kinds forever regardless of what actually aired next — reads as
 * flatly wrong once you watch it not budge cut after cut.
 *  - If the cooldown gate (see `selectPriority`) permits it, the single
 *    highest-scored still-unaired breaking candidate leads, same as the real
 *    priority tier would pick.
 *  - The remaining slots are a random sample of OTHER kinds (excluding the
 *    kind that just aired, same as the real avoid-immediate-repeat rule),
 *    each showing a random pick among ITS least-aired candidates.
 */
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

export function previewNext(
  pool: Candidate[],
  excludeId: string,
  counts: Map<string, number>,
  cooldownActive: boolean,
  recentAreasByKind: ReadonlyMap<SegmentKind, readonly string[]>,
  lastKind?: SegmentKind,
  recentCenters: [number, number][] = [],
): UpNextEntry[] {
  const eligible = pool.filter((c) => c.segment.id !== excludeId);
  const out: UpNextEntry[] = [];

  if (!cooldownActive) {
    let breaking: Candidate | undefined;
    for (const kind of PRIORITY_KINDS) {
      const ofKind = withoutRecentAreas(
        eligible.filter((c) => c.segment.kind === kind && c.breaking !== false && !counts.has(c.segment.id)),
        kind,
        recentAreasByKind,
      ).sort((a, b) => b.score - a.score);
      if (ofKind.length) {
        breaking = ofKind[0];
        break;
      }
    }
    if (breaking) out.push({ kind: breaking.segment.kind, title: breaking.segment.title, subtitle: breaking.segment.subtitle, ...focusOf(breaking.segment) });
  }

  const seenKinds = new Set(out.map((o) => o.kind));
  let remainingKinds = [...new Set(eligible.map((c) => c.segment.kind))].filter((k) => !seenKinds.has(k));
  if (lastKind && remainingKinds.length > 1) remainingKinds = remainingKinds.filter((k) => k !== lastKind);

  for (const kind of shuffled(remainingKinds)) {
    const ofKind = eligible.filter((c) => c.segment.kind === kind);
    const cands = withoutRecentAreas(
      ofKind,
      kind,
      recentAreasByKind,
    );
    const pick = (kind === "country" || kind === "region")
      ? selectNext(ofKind, { history: [], counts, recentCenters, recentAreasByKind })!
      : pickLeastAired(cands, counts).segment;
    out.push({ kind, title: pick.title, subtitle: pick.subtitle, ...focusOf(pick) });
    if (out.length >= 3) break;
  }
  return out;
}
