/**
 * Scripted short videos — the shared contract (docs/short-video-plan.md §2).
 *
 * A script is a saved list of REFERENCES (segment ids + durations), never built
 * `Segment`s: the worker resolves each clip from live data when the script
 * plays (worker/src/director/script-resolve.ts), so an alert that expired
 * between save and render is skipped instead of airing dead. Clip start times
 * are derived from order + duration, never stored — see `clipStarts`.
 */
import { v4 as uuidv4 } from "uuid";
import { sanitizeKindLook, type KindLook } from "./director";

/** Where a video looks. */
export type ShortScope =
  | { type: "country"; id: string } // a COUNTRY_SHOTS id
  | { type: "area"; id: string } // a REGION_SHOTS id
  | { type: "globe" };

/** Which kinds of active event the template pulls in. */
export interface ShortInclude {
  alerts: boolean;
  quakes: boolean;
  volcanoes: boolean;
}

export interface ShortClip {
  id: string;
  /** A director segment id: "country:japan", "storm:<source>:<identifier>",
   *  "quake:<id>", "volcano:<id>". Same form as the commands plan's
   *  CommandTarget { type: "segment" }. */
  target: string;
  durationMs: number;
  /** Look override for this clip, same shape as DirectorConfig.kindLooks. */
  look?: KindLook;
  /** Country and region clips: fly only the first N tour stops. */
  maxStops?: number;
  /** Country and region clips: camera dwell per tour stop, ms — copied onto
   *  `Segment.tourDwellMs`. The template sets it so the kept stops spread
   *  evenly across the clip; absent = the client's live-channel default
   *  (40 s a stop, sized for the left-column package, not a short clip). */
  tourDwellMs?: number;
  /** Country and region clips: open the deck on the place round-up, not the
   *  nation card. Same field the commands and break-in plans add to Segment. */
  leadSlide?: "roundup";
  /** Cached for the editor only; refreshed on every resolve. */
  label: { title: string; subtitle?: string; icon?: string };
}

/** What the runner really played on one scene — written by it, never by the editor. */
export interface ShortScriptPlay {
  /** The scene that played it. A script keeps one record per scene, so the
   *  editor's preview (`shorts-preview`) and a render (`shorts`) playing the
   *  same script never overwrite each other's record. */
  sceneId: string;
  /** The `DirectorConfig.script.playNonce` this play answered. A worker that
   *  restarts mid-play finds the nonce already here and does not start over. */
  playNonce: number;
  startedAt: number;
  endedAt?: number;
  /** The play was cut short (the scene left script mode, or the worker
   *  restarted) — a render job must not treat it as a finished video. */
  stopped?: boolean;
  runId?: string;
  clips: { id: string; startMs: number; durationMs: number }[];
  skipped: { id: string; reason: string }[];
}

export interface ShortScript {
  id: string;
  template: "lineup";
  scope: ShortScope;
  include: ShortInclude;
  title: string;
  /** Values for the title codes (`%{place}`…), stamped at generate (§6.8).
   *  Written by the worker only (`db.shortScripts.stampValues`). */
  values?: Record<string, string>;
  clips: ShortClip[];
  status: "draft" | "ready";
  /** Written by the runner: the LATEST play on each scene (at most one entry
   *  per `sceneId`) — the schedule it really played (§7 screenshots use it).
   *  Read one scene's with `playFor`. */
  plays?: ShortScriptPlay[];
}

/** The latest play of `script` on `sceneId`, or undefined when it never played there. */
export function playFor(script: Pick<ShortScript, "plays">, sceneId: string): ShortScriptPlay | undefined {
  return script.plays?.find((p) => p.sceneId === sceneId);
}

/** Duration clamp for one clip. Below a second nothing reads; above ten minutes
 *  it isn't a short. Out-of-range values are clamped, not rejected. */
export const MIN_CLIP_MS = 1_000;
export const MAX_CLIP_MS = 600_000;
/** Duration for a clip whose duration is missing or not a number. */
export const DEFAULT_CLIP_MS = 10_000;
/**
 * Clip targets that are not a stored subject's segment id. Every other target is
 * the director's own segment id (`country:<id>`, `region:<id>`,
 * `storm:<source>:<identifier>`, `quake:<id>`, `volcano:<id>`).
 */
/** The freshest world round-up spin; a plain world spin when none is fresh. */
export const TARGET_WORLD_ROUNDUP = "global:roundup";
/** A plain world spin (a globe video's closing shot). */
export const TARGET_WORLD_SPIN = "global:spin";

/** Target length of a generated script when the caller names none. */
export const DEFAULT_SHORT_BUDGET_MS = 75_000;
/** Generous ceiling on `maxStops` — real tours are a handful of stops. */
export const MAX_CLIP_STOPS = 50;
/** Clamp for `tourDwellMs`: under two seconds the camera barely lands before
 *  it leaves; over two minutes on one stop isn't a tour. */
export const TOUR_DWELL_MIN_MS = 2_000;
export const TOUR_DWELL_MAX_MS = 120_000;

type Timed = Pick<ShortClip, "durationMs">;

/** Start offset (ms from the top of the script) of each clip, in order. */
export function clipStarts(clips: readonly Timed[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of clips) {
    out.push(t);
    t += c.durationMs;
  }
  return out;
}

/** Total running time of the clips, ms. */
export function scriptDurationMs(clips: readonly Timed[]): number {
  return clips.reduce((sum, c) => sum + c.durationMs, 0);
}

/**
 * Which clip is on screen `elapsedMs` into the script, and how far into it.
 * A time exactly on a boundary belongs to the clip that STARTS there (clip i
 * covers [start, start + duration)), so the end of the script itself — and
 * anything past it, or before 0 — is null, as is an empty list. Zero-length
 * clips are therefore never "on screen".
 */
export function clipAt(
  clips: readonly Timed[],
  elapsedMs: number,
): { index: number; offsetMs: number } | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const end = start + clips[i].durationMs;
    if (elapsedMs < end) return { index: i, offsetMs: elapsedMs - start };
    start = end;
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const optStr = (v: unknown): string | undefined => str(v) || undefined;

/** A scope from an untrusted body, or null when it isn't one. Catalog
 *  membership of a country/area id is NOT checked here (resolveScope does). */
export function sanitizeScope(v: unknown): ShortScope | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (s.type === "globe") return { type: "globe" };
  const id = str(s.id);
  if ((s.type === "country" || s.type === "area") && id) return { type: s.type, id };
  return null;
}

/** Each switch defaults OFF when absent or not a boolean — the first release
 *  is round-up videos only; event clips are opt-in. */
export function sanitizeInclude(v: unknown): ShortInclude {
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const flag = (x: unknown) => x === true;
  return { alerts: flag(s.alerts), quakes: flag(s.quakes), volcanoes: flag(s.volcanoes) };
}

function sanitizeClip(v: unknown, seen: Set<string>): ShortClip | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const target = str(c.target);
  if (!target) return null;
  // A clip added in the editor may not have an id yet; a duplicated one may
  // share its source's. Either way it gets a fresh one rather than being lost.
  let id = str(c.id);
  if (!id || seen.has(id)) id = uuidv4();
  seen.add(id);

  const rawMs = typeof c.durationMs === "number" && Number.isFinite(c.durationMs) ? c.durationMs : DEFAULT_CLIP_MS;
  const label = (c.label && typeof c.label === "object" ? c.label : {}) as Record<string, unknown>;
  const clip: ShortClip = {
    id,
    target,
    durationMs: Math.round(Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, rawMs))),
    label: { title: str(label.title) || target },
  };
  const subtitle = optStr(label.subtitle);
  const icon = optStr(label.icon);
  if (subtitle) clip.label.subtitle = subtitle;
  if (icon) clip.label.icon = icon;

  const look = sanitizeKindLook(c.look);
  if (look && Object.keys(look).length) clip.look = look;
  if (typeof c.maxStops === "number" && Number.isFinite(c.maxStops)) {
    clip.maxStops = Math.min(MAX_CLIP_STOPS, Math.max(0, Math.floor(c.maxStops)));
  }
  if (typeof c.tourDwellMs === "number" && Number.isFinite(c.tourDwellMs)) {
    clip.tourDwellMs = Math.round(Math.min(TOUR_DWELL_MAX_MS, Math.max(TOUR_DWELL_MIN_MS, c.tourDwellMs)));
  }
  if (c.leadSlide === "roundup") clip.leadSlide = "roundup";
  return clip;
}

/**
 * Validate an untrusted (HTTP) script body. Returns null when it can't be a
 * script at all (no id, or no valid scope); otherwise strings are trimmed,
 * durations clamped to MIN/MAX_CLIP_MS, clips with an empty target dropped.
 * `plays` is never taken from the body — only the runner writes them
 * (`db.shortScripts.stampPlay`).
 */
export function sanitizeShortScript(v: unknown): ShortScript | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const id = str(s.id);
  const scope = sanitizeScope(s.scope);
  if (!id || !scope) return null;
  const seen = new Set<string>();
  const clips = (Array.isArray(s.clips) ? s.clips : [])
    .map((c) => sanitizeClip(c, seen))
    .filter((c): c is ShortClip => c !== null);
  return {
    id,
    template: "lineup",
    scope,
    include: sanitizeInclude(s.include),
    title: str(s.title) || "Untitled short",
    clips,
    status: s.status === "ready" ? "ready" : "draft",
  };
}
