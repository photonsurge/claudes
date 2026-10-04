/**
 * Break-ins, worker side: build the shot for a break-in pick (one event, or a
 * burst framed as one grouped cut), stamp the on-air break-in / INCOMING
 * fields, and the runner view the pure queue logic reads.
 *
 * The decisions themselves (what is queued, what breaks in) are pure, in
 * shared/director-break-in.ts. See docs/director-programme-plan.md §3.5, §4.3.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig, Segment, SegmentKind } from "@photonsurge/shared/director";
import { candidateAreaKey } from "@photonsurge/shared/director-select";
import type { BreakInPick, BreakInReason, BreakInRunnerView, PendingBreakIn } from "@photonsurge/shared/director-break-in";
import { SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import { resolveTarget } from "./commands";
import type { SceneRunner } from "./runner";

/** Kinds framed on one subject — they get the reticle (and so the INCOMING pre-roll). */
export const TARGETED_KINDS = new Set<SegmentKind>(["storm", "volcano", "quake", "flight", "ship"]);

/** The queue logic's view of a runner. */
export function breakInView(r: SceneRunner, cfg: DirectorConfig, now: number): BreakInRunnerView {
  return {
    now,
    current: r.current
      ? {
          id: r.current.id,
          kind: r.current.kind,
          startedAt: r.startedAt,
          areaKey: candidateAreaKey({ segment: r.current, score: 0 }),
        }
      : null,
    seen: new Set(r.seen.keys()),
    handled: r.handled,
    lastBreakInAt: r.lastBreakInAt,
    lastRoundupBreakInAt: r.lastRoundupBreakInAt,
    favourites: { countries: new Set(cfg.countries), regions: new Set(cfg.regions) },
    paused: !!r.paused,
  };
}

/** The on-air title for a burst, in plain words — source CAP text never reaches air here. */
export function groupTitle(reason: BreakInReason, items: readonly PendingBreakIn[]): string {
  const n = items.length;
  switch (reason) {
    case "quake":
      return `${n} NEW EARTHQUAKES`;
    case "storm": {
      const floor = Math.min(...items.map((i) => i.severityRank ?? 0));
      const word = floor >= 3 ? `${SEVERITY_LABELS[floor as 3 | 4].toUpperCase()} ` : "";
      return `${n} NEW ${word}WARNINGS`;
    }
    case "volcano":
      return `${n} VOLCANOES ERUPTING`;
    case "roundup":
      return `${n} NEW ROUND-UPS`;
  }
}

/** Widest a burst can be and still read as one picture, degrees. */
const MAX_GROUP_SPAN_DEG = 90;

/**
 * Frame a set of shots as one: the centroid, zoomed out to fit their spread;
 * the top shot's own frame when they're scattered across the globe.
 */
export function frameGroup(segments: readonly Segment[]): Segment["camera"] {
  const top = segments[0].camera;
  if (segments.length === 1) return top;
  const lngs = segments.map((s) => s.camera.center[0]);
  const lats = segments.map((s) => s.camera.center[1]);
  const span = Math.max(Math.max(...lngs) - Math.min(...lngs), Math.max(...lats) - Math.min(...lats));
  if (span > MAX_GROUP_SPAN_DEG) return top;
  const center: [number, number] = [
    lngs.reduce((a, b) => a + b, 0) / lngs.length,
    lats.reduce((a, b) => a + b, 0) / lats.length,
  ];
  // About one zoom step out per doubling of the spread beyond ~8°.
  const zoom = Math.max(2, Math.min(top.zoom, top.zoom - Math.log2(Math.max(1, span / 8))));
  return { center, zoom: Math.round(zoom * 10) / 10 };
}

/**
 * The shot for a break-in pick. Each item is built through the same resolver
 * a Take uses (the channel's own builders). A group frames every member and
 * names them all; a group whose members mostly can't be built falls back to
 * the one that can. Null when nothing could be built.
 */
export async function buildBreakInSegment(
  db: AppDb,
  cfg: DirectorConfig,
  r: SceneRunner,
  pick: BreakInPick,
  now: number,
  opts: { interrupted: boolean; resolve?: typeof resolveTarget },
): Promise<Segment | null> {
  const resolve = opts.resolve ?? resolveTarget;
  const built: { item: PendingBreakIn; seg: Segment }[] = [];
  for (const item of pick.items) {
    const res = await resolve(db, cfg, r, { type: "segment", id: item.segmentId }, now);
    if ("segment" in res) built.push({ item, seg: res.segment });
  }
  if (!built.length) return null;
  const items = built.map(({ item, seg }) => ({ segmentId: seg.id, title: seg.title, ...(seg.subtitle ? { subtitle: seg.subtitle } : {}) }));
  if (built.length === 1) {
    const seg = built[0].seg;
    // A place round-up IS the story: its deck leads with the round-up slide.
    const lead = pick.reason === "roundup" && (seg.kind === "country" || seg.kind === "region") ? { leadSlide: "roundup" as const } : {};
    return { ...seg, ...lead, breakIn: { reason: pick.reason, interrupted: opts.interrupted } };
  }
  const top = built[0].seg;
  const camera = frameGroup(built.map((b) => b.seg));
  const earliest = [...built].sort((a, b) => a.item.at - b.item.at)[0].item;
  return {
    ...top,
    id: `${top.kind}:breakin-${earliest.key.replace(/^[a-z]+:/, "")}`,
    title: groupTitle(pick.reason, built.map((b) => b.item)),
    subtitle: `${top.title} and ${built.length - 1} more`,
    camera,
    patch: { ...top.patch, camera },
    breakIn: { reason: pick.reason, interrupted: opts.interrupted, items },
  };
}

/**
 * Stamp the on-air INCOMING pre-roll per the channel's setting: breaking cuts
 * only, or every targeted event shot. Length is the channel's setting, or the
 * camera flight time when that is 0.
 */
export function stampIncoming(seg: Segment, cfg: DirectorConfig): Segment {
  const mode = cfg.breakIn.incoming;
  const wants = mode === "allEvents" ? TARGETED_KINDS.has(seg.kind) || !!seg.breakIn : mode === "breakIns" && !!seg.breakIn;
  if (!wants) {
    delete seg.incomingMs;
    return seg;
  }
  seg.incomingMs = Math.round((cfg.breakIn.incomingSeconds || cfg.transitionSeconds) * 1000);
  return seg;
}
