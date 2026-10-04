/**
 * Resolve one scripted-short clip (docs/short-video-plan.md §2-3) into the
 * Segment to air, from LIVE data, at play time. A script stores references
 * (`country:japan`, `storm:<source>:<identifier>`, …), never built segments, so
 * a subject that has gone away since the script was saved (an expired warning,
 * a quake past the live window, a volcano gone quiet) is skipped with a reason
 * instead of airing dead.
 *
 * Every shot is built by the same single-item builder the auto director's pool
 * uses (./builders), so a scripted clip looks exactly like the same subject
 * airing through rotation; the clip then only overrides hold, tour length and
 * pace, the deck's lead slide, how much of the round-up it shows and the look.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  focusSubjectOf,
  mergeDirectorConfig,
  splitAlertSubject,
  type DirectorConfig,
  type Segment,
  type SegmentKind,
} from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import { countryShot } from "@photonsurge/shared/director-countries";
import { regionShot } from "@photonsurge/shared/director-regions";
import { quakeLiveWindowSince } from "@photonsurge/shared/seismic";
import { TARGET_WORLD_ROUNDUP, TARGET_WORLD_SPIN, type ShortClip } from "@photonsurge/shared/short-script";
import {
  countryCandidate,
  regionCandidate,
  quakeCandidate,
  volcanoCandidate,
  stormCandidate,
  worldSpinCandidate,
  countrySubtitle,
  regionSubtitle,
} from "./builders";
import { summaryCandidates } from "./candidates";

export type ClipResolution = { segment: Segment } | { skipped: string };

type Built = Candidate | { skipped: string };

/** The segment kind a target builds — needed BEFORE building, to layer the
 *  clip's look onto that kind's look. Null for an unknown target. */
function targetKind(target: string): SegmentKind | null {
  if (target === TARGET_WORLD_ROUNDUP || target === TARGET_WORLD_SPIN) return "global";
  const kind = target.slice(0, Math.max(0, target.indexOf(":")));
  return kind === "country" || kind === "region" || kind === "storm" || kind === "quake" || kind === "volcano"
    ? kind
    : null;
}

async function buildStorm(db: AppDb, cfg: DirectorConfig, subject: string, now: number): Promise<Built> {
  const key = splitAlertSubject(subject);
  if (!key) return { skipped: "bad alert id" };
  const a: any = await db.alerts.getByKey(key.source, key.identifier);
  if (!a) return { skipped: "alert not found" };
  if (!a.active) return { skipped: "alert is no longer active" };
  // `expiresAt` is an ISO string; an unparseable one is treated as open-ended,
  // like the expiry sweeps (which only match a non-null value).
  const expires = a.expiresAt ? Date.parse(a.expiresAt) : NaN;
  if (!Number.isNaN(expires) && expires <= now) return { skipped: "alert has expired" };
  // Same info/area pick as the pool loop in candidates.ts.
  const info = Array.isArray(a.info) ? a.info[0] : undefined;
  return stormCandidate(a, info, info?.area?.[0], cfg, now) ?? { skipped: "alert has no area to frame" };
}

async function buildQuake(db: AppDb, cfg: DirectorConfig, quakeId: string, now: number): Promise<Built> {
  const q = await db.quakes.get(quakeId);
  if (!q) return { skipped: "quake not found" };
  // The same live window buildCandidates lists quakes through.
  if (!q.time || q.time.getTime() < quakeLiveWindowSince(now)) return { skipped: "quake is older than the live window" };
  return quakeCandidate(q, cfg, now);
}

async function buildVolcano(db: AppDb, cfg: DirectorConfig, id: string, now: number): Promise<Built> {
  const v = await db.volcanoes.get(id);
  if (!v) return { skipped: "volcano not found" };
  return volcanoCandidate(v, cfg, now) ?? { skipped: "volcano is no longer active" };
}

/** The freshest world round-up that passes the pool's validity + stale rules,
 *  else the plain world spin — a globe opener always has something to air. */
async function buildRoundup(db: AppDb, cfg: DirectorConfig, now: number): Promise<Candidate> {
  const fresh = await summaryCandidates(db, cfg, undefined, now);
  const generated = (c: Candidate) => Date.parse(c.segment.summary?.generatedAt ?? "") || 0;
  const best = fresh.sort((a, b) => generated(b) - generated(a))[0];
  return best ?? worldSpinCandidate(cfg);
}

async function build(db: AppDb, cfg: DirectorConfig, target: string, now: number): Promise<Built> {
  if (target === TARGET_WORLD_ROUNDUP) return buildRoundup(db, cfg, now);
  if (target === TARGET_WORLD_SPIN) return worldSpinCandidate(cfg);
  const subject = focusSubjectOf(target);
  if (!subject) return { skipped: "unknown target" };
  switch (targetKind(target)) {
    case "country": {
      const shot = countryShot(subject);
      return shot ? countryCandidate(db, shot, cfg) : { skipped: "unknown country" };
    }
    case "region": {
      const shot = regionShot(subject);
      return shot ? regionCandidate(db, shot, cfg) : { skipped: "unknown area" };
    }
    case "storm":
      return buildStorm(db, cfg, subject, now);
    case "quake":
      return buildQuake(db, cfg, subject, now);
    case "volcano":
      return buildVolcano(db, cfg, subject, now);
    default:
      return { skipped: "unknown target" };
  }
}

/**
 * Apply the clip's own settings to a freshly built segment. Copies the
 * segment and its patch, so the result is an object nobody else holds —
 * performCut writes `spinEpoch` / `cutTransitionMs` onto `segment.patch`.
 * Pure, and exported so the lineup template labels a clip with exactly what
 * will air.
 */
export function applyClip(
  seg: Segment,
  clip: Pick<ShortClip, "durationMs" | "maxStops" | "tourDwellMs" | "leadSlide" | "roundupDepth">,
): Segment {
  const out: Segment = { ...seg, patch: { ...seg.patch }, holdMs: clip.durationMs };
  if (typeof clip.maxStops === "number") {
    // 0 (or nothing left) means one framed view — no tour at all.
    const stops = out.tourStops?.slice(0, clip.maxStops);
    if (stops?.length) out.tourStops = stops;
    else if (out.tourStops) {
      delete out.tourStops;
      // The builder captioned it as a tour; it now airs as one framed view.
      if (out.kind === "country") out.subtitle = countrySubtitle(false);
      else if (out.kind === "region") out.subtitle = regionSubtitle(false);
    }
  }
  if (typeof clip.tourDwellMs === "number") out.tourDwellMs = clip.tourDwellMs;
  if (clip.leadSlide) out.leadSlide = clip.leadSlide;
  if (clip.roundupDepth) out.roundupDepth = clip.roundupDepth;
  return out;
}

/**
 * Turn one clip into the segment to air, or say why it can't air. Never
 * throws: a failed lookup is a skip too, so one bad clip can't stop a play.
 */
export async function resolveClip(
  db: AppDb,
  cfg: DirectorConfig,
  clip: ShortClip,
  now: number,
): Promise<ClipResolution> {
  const kind = targetKind(clip.target);
  if (!kind) return { skipped: "unknown target" };
  // The clip's look layers onto the kind's look through the same merge an
  // operator's kindLooks patch takes; make() then applies it to the patch.
  const effective = clip.look ? mergeDirectorConfig(cfg, { kindLooks: { [kind]: clip.look } }) : cfg;
  let built: Built;
  try {
    built = await build(db, effective, clip.target, now);
  } catch (err) {
    return { skipped: `lookup failed: ${String((err as Error)?.message ?? err)}` };
  }
  if ("skipped" in built) return built;
  return { segment: applyClip(built.segment, clip) };
}

/** The editor's cached label for a clip, from the segment it resolved to. */
export function refreshClipLabel(segment: Segment): ShortClip["label"] {
  const label: ShortClip["label"] = { title: segment.title };
  if (segment.subtitle) label.subtitle = segment.subtitle;
  if (segment.icon) label.icon = segment.icon;
  return label;
}
