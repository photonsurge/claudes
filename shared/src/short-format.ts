/**
 * Short video formats — a short's own settings (docs/short-video-plan.md §5).
 *
 * A format is a named kind of short video ("Country round-up", "World
 * round-up"). It owns two things, both keyed by the format's id:
 *  • its own HIDDEN scene (`kind: "short"`) — the scene document and director
 *    config, i.e. the on-air look, thresholds, holds and reading pace. A format
 *    is made by DUPLICATING a channel or another format; there is no link back
 *    (shared/src/db/short-format-copy.ts);
 *  • its short settings — this document: what Generate starts from, how the
 *    opener and close are shaped, what YouTube is told, timing and render
 *    defaults. Things only a short has, so they never touch a channel.
 *
 * A script names its format (`ShortScript.formatId`); one with none uses the
 * default format, `DEFAULT_SHORT_FORMAT_ID` (= the `shorts` scene).
 *
 * Every number that shapes a video is a setting here (§6.9); the constants
 * below are only the defaults a new format starts from.
 */
import type { YoutubePrivacy } from "./runs";
import {
  DEFAULT_SHORT_BUDGET_MS,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  TOUR_DWELL_MAX_MS,
  TOUR_DWELL_MIN_MS,
  sanitizeInclude,
  sanitizeScope,
  type RoundupDepth,
  type ShortInclude,
  type ShortScope,
} from "./short-script";
import { DEFAULT_SHORT_FORMAT_ID, DEFAULT_SHORT_FORMAT_NAME } from "./short-scenes";

export { DEFAULT_SHORT_FORMAT_ID, DEFAULT_SHORT_FORMAT_NAME };

/** A thumbnail: an image (URL or site path, a title-code template), or a frame
 *  of the video at a set offset. An image with an empty url sets none. */
export type ShortThumbnail = { source: "image"; url: string } | { source: "frame"; atMs: number };

export interface ShortFormat {
  /** Also the id of the scene this format owns. */
  id: string;
  name: string;
  /** What Generate starts from. A request can override any of it. */
  template: {
    /** Absent = Generate needs a scope in the request. */
    scope?: ShortScope;
    include: ShortInclude;
    budgetMs: number;
    /** Several places: open on the world round-up before the first place (WP10). */
    openWithWorld: boolean;
  };
  opener: {
    /** Open the deck on the round-up. */
    leadWithRoundup: boolean;
    /** How much of a place round-up is shown: its summary, or all of it. */
    roundupDepth: RoundupDepth;
    /** Fly the tour, or hold one framed shot. */
    tour: boolean;
    minTourDwellMs: number;
    /** With events on: the opener's share of the budget (0.4). */
    budgetShare: number;
  };
  close: { enabled: boolean; ms: number };
  /** Everything YouTube is told about the video (§6.8). Templates take the date
   *  codes the live titles use, plus the video's own values. */
  video: {
    title: string;
    description: string;
    /** Zone the date codes resolve in: an IANA zone, or "place" for the video's
     *  own place. Default "Europe/London", as live titles. */
    timezone: string;
    thumbnail: ShortThumbnail;
    tags: string[];
    categoryId: string;
    playlistId?: string;
    publishAs: YoutubePrivacy;
    chapters: boolean;
  };
  /** Timing around the script inside the broadcast. */
  timing: { leadInMs: number; leadOutMs: number };
  /** What the render form and schedules start from. */
  render: { encoderId?: string; accountId?: string };
  /** "portrait" arrives with phase 2. */
  layout: "landscape";
}

/** The opener's share of the budget while events are picked. */
export const DEFAULT_OPENER_BUDGET_SHARE = 0.4;
/** The closing wide shot — a beat to end on. */
export const DEFAULT_CLOSE_MS = 6_000;
/** The shortest camera dwell on a tour stop in a scripted clip: enough for the
 *  camera to land and the stop's caption to read. Sets how many stops fit. */
export const DEFAULT_MIN_TOUR_DWELL_MS = 8_000;
/** Zone video date codes resolve in — London, as live titles. */
export const DEFAULT_VIDEO_TIMEZONE = "Europe/London";
/** `video.timezone` value meaning "the video's own place". */
export const PLACE_TIMEZONE = "place";
/** YouTube category "News & Politics". */
export const DEFAULT_VIDEO_CATEGORY_ID = "25";
/** The script starts this long after the broadcast goes live … */
export const DEFAULT_LEAD_IN_MS = 3_000;
/** … and the run ends this long after the script does (§6.3). */
export const DEFAULT_LEAD_OUT_MS = 5_000;

/** Clamps. A budget under 10 s or over an hour isn't a short. */
export const FORMAT_BUDGET_MIN_MS = 10_000;
export const FORMAT_BUDGET_MAX_MS = 3_600_000;
export const OPENER_SHARE_MIN = 0.05;
export const OPENER_SHARE_MAX = 0.95;
/** Lead-in / lead-out ceiling: past a minute it's dead air, not slack. */
export const FORMAT_TIMING_MAX_MS = 60_000;
/** Tag list ceiling (YouTube caps the total at 500 characters anyway). */
export const MAX_VIDEO_TAGS = 50;

/**
 * Short settings a new format starts from: today's round-up video — the
 * round-up leads, at full depth, with the tour flown — and an unlisted upload
 * (decision §12: default privacy unlisted).
 */
export function defaultShortFormat(id: string = DEFAULT_SHORT_FORMAT_ID, name: string = DEFAULT_SHORT_FORMAT_NAME): ShortFormat {
  return {
    id,
    name,
    template: {
      include: { alerts: false, quakes: false, volcanoes: false },
      budgetMs: DEFAULT_SHORT_BUDGET_MS,
      openWithWorld: false,
    },
    opener: {
      leadWithRoundup: true,
      roundupDepth: "full",
      tour: true,
      minTourDwellMs: DEFAULT_MIN_TOUR_DWELL_MS,
      budgetShare: DEFAULT_OPENER_BUDGET_SHARE,
    },
    close: { enabled: true, ms: DEFAULT_CLOSE_MS },
    video: {
      title: "%{place} round-up · %A %e %B",
      description: "%{roundup}",
      timezone: DEFAULT_VIDEO_TIMEZONE,
      thumbnail: { source: "image", url: "" },
      tags: [],
      categoryId: DEFAULT_VIDEO_CATEGORY_ID,
      publishAs: "unlisted",
      chapters: true,
    },
    timing: { leadInMs: DEFAULT_LEAD_IN_MS, leadOutMs: DEFAULT_LEAD_OUT_MS },
    render: {},
    layout: "landscape",
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A finite number clamped into [min, max], else `fallback`. */
const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = num(v);
  return n === null ? fallback : Math.min(max, Math.max(min, n));
};
const clampMs = (v: unknown, min: number, max: number, fallback: number) => Math.round(clamp(v, min, max, fallback));

/** True for "place" or a zone Intl knows. */
export function isVideoTimezone(tz: string): boolean {
  if (tz === PLACE_TIMEZONE) return true;
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function sanitizeThumbnail(v: unknown, fallback: ShortThumbnail): ShortThumbnail {
  const t = obj(v);
  if (t.source === "image") return { source: "image", url: str(t.url) };
  if (t.source === "frame") return { source: "frame", atMs: clampMs(t.atMs, 0, MAX_CLIP_MS * 10, 0) };
  return { ...fallback };
}

function sanitizeTags(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const out: string[] = [];
  for (const t of v) {
    const tag = str(t);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, MAX_VIDEO_TAGS);
}

/**
 * Validate an untrusted (HTTP) format body onto `base` — every field that is
 * missing or invalid keeps base's value, so a partial body is a patch. `base`
 * defaults to `defaultShortFormat` with the body's id. Returns null when the
 * result has no id. Numbers are clamped, not rejected; a scope of `null`
 * clears the template's scope.
 */
export function sanitizeShortFormat(v: unknown, base?: ShortFormat): ShortFormat | null {
  const s = obj(v);
  const id = str(s.id) || base?.id || "";
  if (!id) return null;
  const b = base ?? defaultShortFormat(id);

  const t = obj(s.template);
  const template: ShortFormat["template"] = {
    include: t.include !== undefined ? sanitizeInclude(t.include) : { ...b.template.include },
    budgetMs: clampMs(t.budgetMs, FORMAT_BUDGET_MIN_MS, FORMAT_BUDGET_MAX_MS, b.template.budgetMs),
    openWithWorld: bool(t.openWithWorld, b.template.openWithWorld),
  };
  // null clears the scope; absent or invalid keeps base's.
  const scope = t.scope === null ? null : (sanitizeScope(t.scope) ?? b.template.scope ?? null);
  if (scope) template.scope = scope;

  const o = obj(s.opener);
  const opener: ShortFormat["opener"] = {
    leadWithRoundup: bool(o.leadWithRoundup, b.opener.leadWithRoundup),
    roundupDepth: o.roundupDepth === "summary" || o.roundupDepth === "full" ? o.roundupDepth : b.opener.roundupDepth,
    tour: bool(o.tour, b.opener.tour),
    minTourDwellMs: clampMs(o.minTourDwellMs, TOUR_DWELL_MIN_MS, TOUR_DWELL_MAX_MS, b.opener.minTourDwellMs),
    budgetShare: clamp(o.budgetShare, OPENER_SHARE_MIN, OPENER_SHARE_MAX, b.opener.budgetShare),
  };

  const c = obj(s.close);
  const close: ShortFormat["close"] = {
    enabled: bool(c.enabled, b.close.enabled),
    ms: clampMs(c.ms, MIN_CLIP_MS, FORMAT_TIMING_MAX_MS, b.close.ms),
  };

  const vv = obj(s.video);
  const tz = str(vv.timezone);
  const category = str(vv.categoryId);
  const video: ShortFormat["video"] = {
    title: str(vv.title) || b.video.title,
    description: typeof vv.description === "string" ? vv.description : b.video.description,
    timezone: isVideoTimezone(tz) ? tz : b.video.timezone,
    thumbnail: vv.thumbnail !== undefined ? sanitizeThumbnail(vv.thumbnail, b.video.thumbnail) : { ...b.video.thumbnail },
    tags: sanitizeTags(vv.tags, b.video.tags),
    categoryId: /^\d+$/.test(category) ? category : b.video.categoryId,
    publishAs: vv.publishAs === "public" || vv.publishAs === "unlisted" || vv.publishAs === "private" ? vv.publishAs : b.video.publishAs,
    chapters: bool(vv.chapters, b.video.chapters),
  };
  // "" clears the playlist; absent keeps base's.
  const playlistId = typeof vv.playlistId === "string" ? str(vv.playlistId) : b.video.playlistId;
  if (playlistId) video.playlistId = playlistId;

  const tm = obj(s.timing);
  const timing: ShortFormat["timing"] = {
    leadInMs: clampMs(tm.leadInMs, 0, FORMAT_TIMING_MAX_MS, b.timing.leadInMs),
    leadOutMs: clampMs(tm.leadOutMs, 0, FORMAT_TIMING_MAX_MS, b.timing.leadOutMs),
  };

  // Each default: "" clears it, absent keeps base's.
  const r = obj(s.render);
  const render: ShortFormat["render"] = {};
  for (const k of ["encoderId", "accountId"] as const) {
    const value = typeof r[k] === "string" ? str(r[k]) : b.render[k];
    if (value) render[k] = value;
  }

  return {
    id,
    name: str(s.name) || b.name,
    template,
    opener,
    close,
    video,
    timing,
    render,
    layout: "landscape",
  };
}
