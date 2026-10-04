/**
 * Scheduled video batches (docs/short-video-plan.md §8). A schedule is a time,
 * an encoder, and the videos to make then, in order. The worker's 60 s
 * `short-video.tick` fires every enabled schedule whose `nextAt` has come by
 * queuing its videos as ShortRenders (one batch), then sets the next `nextAt`.
 * Freshness, the round-up refresh and generation happen as each video reaches
 * the front of the render queue, never here.
 *
 * Pure contract + helpers; persistence is `db.shortSchedules`.
 */
import type { YoutubePrivacy } from "./runs";
import {
  ANY_ENCODER,
  sanitizeVideoOverrides,
  type ShortAutoScope,
  type ShortFormatVideo,
} from "./short-render";
import { sanitizeInclude, sanitizeScope, type ShortInclude, type ShortScope } from "./short-script";
import { isValidTimeZone, VIDEO_TEXT_TIMEZONE } from "./video-text";

/** How fresh a round-up must be, and what to do when it isn't (§8). */
export interface RoundupRule {
  maxAgeHours: number;
  ifStale: "refresh" | "skip";
}

/** One video in a schedule's batch. */
export interface ScheduledVideo {
  formatId: string;
  what:
    | { type: "script"; scriptId: string }
    | {
        type: "template";
        /** A fixed scope, or "auto": pick the country or area with the most going on. */
        scope: ShortScope | ShortAutoScope;
        /** Absent = the format's switches. */
        include?: ShortInclude;
      };
  /** How fresh the round-up must be, and what to do when it isn't. */
  roundup: RoundupRule;
  /** Make no video when nothing is active in the scope. */
  skipIfQuiet?: boolean;
  /** Overrides of the format's YouTube video settings for this one video. */
  video?: Partial<ShortFormatVideo>;
}

/** When a schedule fires. `days` are 0 = Sunday … 6 = Saturday, in `tz`. */
export type ShortScheduleWhen =
  | { type: "once"; at: number }
  | { type: "weekly"; days: number[]; time: string; tz: string }; // "07:30", IANA zone

/** What the last fire did. `at` is the schedule's time it fired for (Run batch now: when pressed). */
export interface ShortScheduleFire {
  at: number;
  batchId?: string;
  outcome: "queued" | "missed";
  note?: string;
}

/** A time, an encoder, and the videos to make then, in order. */
export interface ShortSchedule {
  id: string;
  name: string; // "Morning batch"
  enabled: boolean;
  when: ShortScheduleWhen;
  encoderId: string | "any";
  accountId?: string;
  offline: boolean;
  /** Skip a video not started this long after the schedule's time. Default 1 h. */
  startByMs: number;
  videos: ScheduledVideo[];
  /** Fires so far; the value of `%{n}`. */
  fireCount: number;
  nextAt: number | null;
  lastFire?: ShortScheduleFire;
}

/**
 * Default round-up age limit. 14 h, not 12: with the default 06:00 / 18:00
 * local slots a round-up is up to ~12 h old before its next slot, plus up to an
 * hour of ticker lag, so 12 h would turn a 07:00 London batch into a daily
 * refresh (an extra LLM call) for places like Australia (§13).
 */
export const DEFAULT_ROUNDUP_MAX_AGE_HOURS = 14;
export const DEFAULT_ROUNDUP_RULE: RoundupRule = { maxAgeHours: DEFAULT_ROUNDUP_MAX_AGE_HOURS, ifStale: "refresh" };
/** A scheduled video not started this long after the schedule's time is skipped as too late. */
export const DEFAULT_START_BY_MS = 60 * 60_000;
export const DEFAULT_SCHEDULE_TIME = "07:00";
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MAX_VIDEOS = 20;

/** A new schedule: every day at 07:00 London, any video encoder, nothing to make yet, off. */
export function defaultShortSchedule(id = "", name = "New schedule"): ShortSchedule {
  return {
    id,
    name,
    enabled: false,
    when: { type: "weekly", days: [...ALL_DAYS], time: DEFAULT_SCHEDULE_TIME, tz: VIDEO_TEXT_TIMEZONE },
    encoderId: ANY_ENCODER,
    offline: false,
    startByMs: DEFAULT_START_BY_MS,
    videos: [],
    fireCount: 0,
    nextAt: null,
  };
}

/** A new video for a batch: the format's own template scope is not known here, so the world. */
export function defaultScheduledVideo(formatId: string): ScheduledVideo {
  return { formatId, what: { type: "template", scope: { type: "globe" } }, roundup: { ...DEFAULT_ROUNDUP_RULE } };
}

// ---- sanitiser ----

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function sanitizeRoundupRule(v: unknown, base: RoundupRule): RoundupRule {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const age = typeof r.maxAgeHours === "number" && Number.isFinite(r.maxAgeHours) && r.maxAgeHours > 0 ? Math.min(r.maxAgeHours, 24 * 14) : base.maxAgeHours;
  const ifStale = r.ifStale === "refresh" || r.ifStale === "skip" ? r.ifStale : base.ifStale;
  return { maxAgeHours: age, ifStale };
}

/** One batch video, or null when it can't be one (no format, nothing to make). */
export function sanitizeScheduledVideo(v: unknown): ScheduledVideo | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const formatId = str(s.formatId);
  if (!formatId) return null;
  const w = (s.what && typeof s.what === "object" ? s.what : {}) as Record<string, unknown>;
  let what: ScheduledVideo["what"];
  if (w.type === "script" && str(w.scriptId)) {
    what = { type: "script", scriptId: str(w.scriptId) };
  } else if (w.type === "template") {
    const sc = w.scope as Record<string, unknown> | undefined;
    const scope: ShortScope | ShortAutoScope | null =
      sc && sc.type === "auto" && (sc.of === "country" || sc.of === "area") ? { type: "auto", of: sc.of } : sanitizeScope(sc);
    if (!scope) return null;
    what = { type: "template", scope };
    if (w.include != null) what.include = sanitizeInclude(w.include);
  } else {
    return null;
  }
  const out: ScheduledVideo = { formatId, what, roundup: sanitizeRoundupRule(s.roundup, DEFAULT_ROUNDUP_RULE) };
  if (s.skipIfQuiet === true) out.skipIfQuiet = true;
  const video = sanitizeVideoOverrides(s.video);
  if (video) out.video = video;
  return out;
}

/** A schedule's `when`, or null when it isn't one. Days are de-duplicated and sorted; none = every day. */
export function sanitizeScheduleWhen(v: unknown): ShortScheduleWhen | null {
  if (!v || typeof v !== "object") return null;
  const w = v as Record<string, unknown>;
  if (w.type === "once") {
    return typeof w.at === "number" && Number.isFinite(w.at) && w.at > 0 ? { type: "once", at: Math.round(w.at) } : null;
  }
  if (w.type === "weekly") {
    const time = str(w.time);
    if (!TIME_RE.test(time)) return null;
    const tz = str(w.tz) || VIDEO_TEXT_TIMEZONE;
    if (!isValidTimeZone(tz)) return null;
    const days = Array.isArray(w.days)
      ? [...new Set(w.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [];
    return { type: "weekly", days: days.length ? days : [...ALL_DAYS], time, tz };
  }
  return null;
}

/**
 * Validate an untrusted schedule (an API body) onto `base` (the stored
 * schedule, or the defaults): a partial body is a patch, junk keeps the base
 * value. `id`, `fireCount`, `nextAt` and `lastFire` are the server's and always
 * come from `base` — the caller recomputes `nextAt` (`scheduleNextAt`).
 * `videos`, when sent, replaces the batch; invalid videos are dropped.
 */
export function sanitizeShortSchedule(v: unknown, base: ShortSchedule = defaultShortSchedule()): ShortSchedule {
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: ShortSchedule = {
    id: base.id,
    name: (str(s.name) || base.name).slice(0, 200),
    enabled: typeof s.enabled === "boolean" ? s.enabled : base.enabled,
    when: (s.when !== undefined && sanitizeScheduleWhen(s.when)) || base.when,
    encoderId: str(s.encoderId) || base.encoderId,
    offline: typeof s.offline === "boolean" ? s.offline : base.offline,
    startByMs:
      typeof s.startByMs === "number" && Number.isFinite(s.startByMs) && s.startByMs > 0
        ? Math.min(Math.round(s.startByMs), 24 * 3_600_000)
        : base.startByMs,
    videos: Array.isArray(s.videos)
      ? s.videos.map(sanitizeScheduledVideo).filter((x): x is ScheduledVideo => !!x).slice(0, MAX_VIDEOS)
      : base.videos,
    fireCount: base.fireCount,
    nextAt: base.nextAt,
  };
  // accountId: a string sets it, "" or null clears it (back to each format's default).
  if (s.accountId === null || s.accountId === "") {
    /* cleared */
  } else if (str(s.accountId)) out.accountId = str(s.accountId);
  else if (base.accountId) out.accountId = base.accountId;
  if (base.lastFire) out.lastFire = base.lastFire;
  return out;
}

/** The ids of the formats a schedule's videos are made in (the format delete guard). */
export const scheduleFormatIds = (s: Pick<ShortSchedule, "videos">): string[] => [...new Set(s.videos.map((v) => v.formatId))];

// ---- time ----

/** The zone's offset from UTC at instant `ms`, in ms (London summer: +3_600_000). */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return local - Math.floor(ms / 1000) * 1000;
}

/** The local calendar date (y, m 1-12, d) of `ms` in the zone. */
function localDate(ms: number, timeZone: string): { y: number; m: number; d: number } {
  const local = new Date(ms + zoneOffsetMs(ms, timeZone));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

/**
 * The instant a local wall time happens in a zone. Across a DST change: a wall
 * time that happens twice (autumn) gives the FIRST; one that doesn't exist
 * (spring) gives the instant the same distance after midnight on the old
 * offset — 01:30 on London's spring-forward day fires at 02:30 BST.
 */
export function zonedWallTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = zoneOffsetMs(wall - 36 * 3_600_000, timeZone);
  const after = zoneOffsetMs(wall + 36 * 3_600_000, timeZone);
  const hits = [...new Set([before, after])].map((o) => wall - o).filter((t) => t + zoneOffsetMs(t, timeZone) === wall);
  return hits.length ? Math.min(...hits) : wall - before;
}

/**
 * When a schedule next fires strictly after `afterMs`, or null when it never
 * will (a once schedule whose time has passed, an unknown zone). Weekly times
 * are wall-clock times in the schedule's own IANA zone, DST included. Pure.
 */
export function nextFireAt(when: ShortScheduleWhen, afterMs: number): number | null {
  if (when.type === "once") return when.at > afterMs ? when.at : null;
  const m = TIME_RE.exec(when.time);
  if (!m || !isValidTimeZone(when.tz)) return null;
  const days = when.days.length ? when.days : ALL_DAYS;
  const [hh, mm] = [Number(m[1]), Number(m[2])];
  // Start a day early: the zone's date at `afterMs` may be behind UTC's.
  const start = localDate(afterMs, when.tz);
  for (let i = -1; i <= 8; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    if (!days.includes(day.getUTCDay())) continue;
    const t = zonedWallTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, when.tz);
    if (t > afterMs) return t;
  }
  return null;
}

/** The `nextAt` a schedule should hold now: its next fire when enabled, else none. Edits recompute it with this. */
export const scheduleNextAt = (s: Pick<ShortSchedule, "enabled" | "when">, now: number): number | null =>
  s.enabled ? nextFireAt(s.when, now) : null;

/** The privacy a "Run batch now" override can set for the whole batch (§8.1 step 5). */
export const sanitizePublishAs = (v: unknown): YoutubePrivacy | undefined =>
  v === "public" || v === "unlisted" || v === "private" ? v : undefined;
