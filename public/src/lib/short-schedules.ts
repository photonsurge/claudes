/**
 * Client helpers + pure logic for SCHEDULES on /admin/shorts
 * (docs/short-video-plan.md §8): the API client for
 * `/api/shorts/schedules/**`, the human-readable "when" and "next run" lines,
 * the editor's validation, the round-up slot hint (§8: "the schedule form shows
 * when each place's round-up is next written") and the YouTube quota warning
 * (§13: the quota day resets at midnight Pacific, 08:00 London).
 *
 * The pure helpers take `now` so the components and their tests agree.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import { currentSlotStart, nextSlotStart, placeOffsetHours, type PlaceBbox } from "@photonsurge/shared/roundup-schedule";
import type { RoundupSettings } from "@photonsurge/shared/roundup-settings";
import type { YoutubePrivacy } from "@photonsurge/shared/runs";
import type { ShortRender } from "@photonsurge/shared/short-render";
import {
  ALL_DAYS,
  DEFAULT_ROUNDUP_RULE,
  DEFAULT_START_BY_MS,
  nextFireAt,
  type ScheduledVideo,
  type ShortSchedule,
  type ShortScheduleWhen,
} from "@photonsurge/shared/short-schedule";
import { MAIN_AREAS_PLACES, type ShortPlace, type ShortScope } from "@photonsurge/shared/short-script";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-scenes";
import { isValidTimeZone, VIDEO_TEXT_TIMEZONE } from "@photonsurge/shared/video-text";

// ---- API ----

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const url = (id?: string, tail = "") => `/api/shorts/schedules${id ? `/${encodeURIComponent(id)}` : ""}${tail}`;

/** What the editor sends: everything the operator sets (the server owns id, fireCount, nextAt, lastFire). */
export type ScheduleInput = Omit<ShortSchedule, "id" | "fireCount" | "nextAt" | "lastFire" | "accountId"> & {
  /** "" = each format's default account. */
  accountId: string;
};

export const listSchedules = () => call<{ schedules: ShortSchedule[] }>(url());
export const createSchedule = (input: ScheduleInput) => call<ShortSchedule>(url(), json("POST", input));
export const saveSchedule = (id: string, input: ScheduleInput) => call<ShortSchedule>(url(id), json("PUT", input));
export const deleteSchedule = (id: string) => call<{ ok: true; id: string }>(url(id), { method: "DELETE" });
export const setScheduleEnabled = (id: string, enabled: boolean) =>
  call<ShortSchedule>(url(id, "/enabled"), json("POST", { enabled }));

export interface RunBatchResult {
  ok: true;
  scheduleId: string;
  batchId: string;
  n: number;
  renders: ShortRender[];
}
/** Run batch now (§6.7, §8.1 step 5). `publishAs` overrides every video's privacy for this batch only. */
export const runScheduleNow = (id: string, publishAs?: YoutubePrivacy) =>
  call<RunBatchResult>(url(id, "/run"), json("POST", publishAs ? { publishAs } : {}));

export const SCHEDULES_POLL_MS = 30_000;

/** Every schedule, polled (a fire changes `nextAt` and `lastFire`). Identity is stable across equal payloads. */
export function useSchedules(load: typeof listSchedules = listSchedules): {
  schedules: ShortSchedule[] | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [schedules, setSchedules] = useState<ShortSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fingerprint = useRef("");
  const refresh = useCallback(async () => {
    const res = await load();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    const next = JSON.stringify(res.data.schedules);
    if (next === fingerprint.current) return;
    fingerprint.current = next;
    setSchedules(res.data.schedules);
  }, [load]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, SCHEDULES_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { schedules, error, refresh };
}

// ---- time, in words ----

export const LONDON = VIDEO_TEXT_TIMEZONE;
/** The zone the YouTube quota day runs in: it resets at midnight here (§13). */
export const QUOTA_TIMEZONE = "America/Los_Angeles";

/** Monday first, as the day chips show them. Values are `Date#getDay()` (0 = Sunday). */
export const WEEK: readonly { day: number; short: string }[] = [
  { day: 1, short: "Mon" },
  { day: 2, short: "Tue" },
  { day: 3, short: "Wed" },
  { day: 4, short: "Thu" },
  { day: 5, short: "Fri" },
  { day: 6, short: "Sat" },
  { day: 0, short: "Sun" },
];

/** "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const set = new Set(days.length ? days : ALL_DAYS);
  if (set.size === 7) return "Every day";
  const is = (want: number[]) => want.length === set.size && want.every((d) => set.has(d));
  if (is([1, 2, 3, 4, 5])) return "Weekdays";
  if (is([0, 6])) return "Weekends";
  return WEEK.filter((w) => set.has(w.day))
    .map((w) => w.short)
    .join(", ");
}

/** "Mon 5 Oct 08:15" in the zone. */
export function fmtInZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("weekday")} ${p("day")} ${p("month")} ${p("hour")}:${p("minute")}`;
}

/** "08:15" in the zone. */
export function clockInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(ms),
  );
}

/** A zone's short name for a line: "London" for Europe/London, else the IANA name. */
export const zoneName = (tz: string) => (tz === LONDON ? "London" : tz);

/** "Every day 08:15 Europe/London", or "Once, Mon 5 Oct 08:15 London". */
export function describeWhen(when: ShortScheduleWhen): string {
  if (when.type === "once") return `Once, ${fmtInZone(when.at, LONDON)} London`;
  return `${describeDays(when.days)} ${when.time} ${when.tz}`;
}

/** The next run in the schedule's zone and, when that isn't London, in London too. */
export function describeNextRun(nextAt: number | null, when: ShortScheduleWhen): string {
  if (nextAt == null) return "—";
  const tz = when.type === "weekly" && isValidTimeZone(when.tz) ? when.tz : LONDON;
  const own = `${fmtInZone(nextAt, tz)} ${zoneName(tz)}`;
  return tz === LONDON ? own : `${own} · ${fmtInZone(nextAt, LONDON)} London`;
}

// ---- the quota warning (§13) ----

/**
 * Does the schedule fire in the last hour of the YouTube quota day (the hour
 * before midnight Pacific — 07:00-08:00 London most of the year)? The batch
 * would then spend the reserve the live channels' recycles need. Checks the
 * next fires across a year, so a schedule in another zone is caught in either
 * season. Returns the first such fire, or null.
 */
export function quotaHourFire(when: ShortScheduleWhen, now: number): number | null {
  const inLastHour = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: QUOTA_TIMEZONE, hour: "numeric", hourCycle: "h23" }) === "23";
  if (when.type === "once") return inLastHour(when.at) ? when.at : null;
  for (let k = 0; k < 12; k++) {
    const t = nextFireAt(when, now + k * 31 * 86_400_000);
    if (t != null && inLastHour(t)) return t;
  }
  return null;
}

/** The London time the quota resets on the day of `t`'s quota day ("08:00"). */
export function quotaResetLondon(t: number): string {
  // The next whole hour after `t` is midnight Pacific when `t` is in the quota day's last hour.
  return clockInZone(Math.ceil((t + 1) / 3_600_000) * 3_600_000, LONDON);
}

// ---- the round-up slot hint (§8) ----

const countryById = new Map(COUNTRY_SHOTS.map((c) => [c.id, c]));
const regionById = new Map(REGION_SHOTS.map((r) => [r.id, r]));

/** The box of a country or area scope, from the shared catalogs (what the round-up job phases by). */
export function scopePlace(scope: ShortScope | ShortPlace): { name: string; bbox: PlaceBbox; kind: "country" | "area" } | null {
  if (scope.type === "country") {
    const c = countryById.get(scope.id);
    return c ? { name: c.name, bbox: c.bbox, kind: "country" } : null;
  }
  if (scope.type === "area") {
    const r = regionById.get(scope.id);
    return r ? { name: r.name, bbox: r.bbox, kind: "area" } : null;
  }
  return null;
}

export type RoundupSlotHint =
  | { state: "off"; place: string; kind: "country" | "area" }
  | {
      state: "on";
      place: string;
      /** The place's slot hours, local to it. */
      hours: number[];
      /** Its next slot after now (ms), and in London. */
      nextAt: number;
      /** The slot the schedule's next run will use: the latest at or before it, and its age then (h). */
      beforeRun?: { at: number; ageHours: number };
    };

/**
 * When a fixed country or area's round-up is next written (§8), from the
 * round-up settings (hours local to the place, phased by the place's
 * whole-hour offset — the same instants the worker takes), and how old the
 * latest one will be when the schedule next runs. Null for the globe, auto
 * scopes and unknown places; a several-places scope asks per place
 * (`roundupSlotHints`).
 */
export function roundupSlotHint(
  scope: ShortScope | ShortPlace | { type: "auto" } | undefined,
  settings: RoundupSettings | null,
  now: number,
  runAt: number | null,
): RoundupSlotHint | null {
  if (!scope || scope.type === "auto" || scope.type === "places" || !settings) return null;
  const place = scopePlace(scope);
  if (!place) return null;
  const setting = settings[place.kind === "country" ? "place-country" : "place-region"];
  if (!setting.enabled || !setting.hours.length) return { state: "off", place: place.name, kind: place.kind };
  const offset = placeOffsetHours(place.bbox);
  const next = nextSlotStart(new Date(now), setting.hours, offset);
  if (!next) return { state: "off", place: place.name, kind: place.kind };
  const out: RoundupSlotHint = { state: "on", place: place.name, hours: setting.hours, nextAt: next.getTime() };
  if (runAt != null) {
    const slot = currentSlotStart(new Date(runAt), setting.hours, offset);
    if (slot) out.beforeRun = { at: slot.getTime(), ageHours: (runAt - slot.getTime()) / 3_600_000 };
  }
  return out;
}

/** The hint for each place a scope covers: one for a country or area, one per place of a several-places scope. */
export function roundupSlotHints(
  scope: ShortScope | { type: "auto" } | undefined,
  settings: RoundupSettings | null,
  now: number,
  runAt: number | null,
): RoundupSlotHint[] {
  const places: (ShortScope | ShortPlace | { type: "auto" } | undefined)[] = scope?.type === "places" ? scope.places : [scope];
  return places.map((p) => roundupSlotHint(p, settings, now, runAt)).filter((h): h is RoundupSlotHint => !!h);
}

// ---- the editor ----

/** One video as the editor holds it — a ScheduledVideo with a stable key for React. */
export type DraftVideo = ScheduledVideo & { key: string };

/** The editor's state: a ScheduleInput, with `once` held as the datetime-local text it edits. */
export interface ScheduleDraft extends Omit<ScheduleInput, "when" | "videos"> {
  repeat: "weekly" | "once";
  days: number[];
  time: string;
  tz: string;
  /** "2026-10-05T08:15", local to the browser (a datetime-local input). */
  onceAt: string;
  videos: DraftVideo[];
}

let keySeq = 0;
export const newVideoKey = () => `v${++keySeq}`;

/** "2026-10-04T18:00" in the browser's zone, for a datetime-local input. */
export function localInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A new batch video in a format: a template for the world, round-up rule at its defaults. */
export function newDraftVideo(formatId = DEFAULT_SHORT_FORMAT_ID, scope: ShortScope = { type: "globe" }): DraftVideo {
  return { key: newVideoKey(), formatId, what: { type: "template", scope }, roundup: { ...DEFAULT_ROUNDUP_RULE } };
}

/** The editor's state for a stored schedule (or null: a new one, off, every day 08:15 London — after the quota resets). */
export function draftFromSchedule(s: ShortSchedule | null, now: number): ScheduleDraft {
  const when = s?.when;
  return {
    name: s?.name ?? "New schedule",
    enabled: s?.enabled ?? false,
    encoderId: s?.encoderId ?? "any",
    accountId: s?.accountId ?? "",
    offline: s?.offline ?? false,
    startByMs: s?.startByMs ?? DEFAULT_START_BY_MS,
    repeat: when?.type === "once" ? "once" : "weekly",
    days: when?.type === "weekly" ? [...when.days] : [...ALL_DAYS],
    time: when?.type === "weekly" ? when.time : "08:15",
    tz: when?.type === "weekly" ? when.tz : LONDON,
    onceAt: localInputValue(when?.type === "once" ? when.at : now + 60 * 60_000),
    videos: (s?.videos ?? []).map((v) => ({ ...v, key: newVideoKey() })),
  };
}

/**
 * The "Morning batch" quick start (§8.1): every day at 08:15 London — after
 * the YouTube quota resets at 08:00 (§13) and after Europe's and the UK's
 * 06:00-local round-ups — on `encoderId`, Europe then the UK in the default
 * format, round-ups up to 14 h old and refreshed if stale, then the main
 * areas video (one video, a chapter per place — the several-places scope, §4),
 * whose stale places are refreshed one by one.
 */
export function morningBatchDraft(now: number, encoderId = "any"): ScheduleDraft {
  return {
    ...draftFromSchedule(null, now),
    name: "Morning batch",
    encoderId,
    days: [...ALL_DAYS],
    time: "08:15",
    tz: LONDON,
    videos: [
      newDraftVideo(DEFAULT_SHORT_FORMAT_ID, { type: "area", id: "europe" }),
      newDraftVideo(DEFAULT_SHORT_FORMAT_ID, { type: "country", id: "uk" }),
      newDraftVideo(DEFAULT_SHORT_FORMAT_ID, { type: "places", places: MAIN_AREAS_PLACES.map((p) => ({ ...p })) }),
    ],
  };
}

/** The `when` a draft describes (unchecked — validate first). */
export function draftWhen(d: ScheduleDraft): ShortScheduleWhen {
  return d.repeat === "once"
    ? { type: "once", at: new Date(d.onceAt).getTime() }
    : { type: "weekly", days: [...d.days].sort((a, b) => a - b), time: d.time, tz: d.tz.trim() };
}

/** The request body a draft saves as. */
export function draftToInput(d: ScheduleDraft): ScheduleInput {
  return {
    name: d.name.trim(),
    enabled: d.enabled,
    when: draftWhen(d),
    encoderId: d.encoderId,
    accountId: d.accountId,
    offline: d.offline,
    startByMs: d.startByMs,
    videos: d.videos.map(({ key: _key, ...v }) => {
      // An emptied title override means the format's title.
      if (v.video && v.video.title !== undefined && !v.video.title.trim()) {
        const { title: _t, ...rest } = v.video;
        return Object.keys(rest).length ? { ...v, video: rest } : (({ video: _v, ...noVideo }) => noVideo)(v);
      }
      return v;
    }),
  };
}

export interface ScheduleErrors {
  name?: string;
  days?: string;
  time?: string;
  tz?: string;
  onceAt?: string;
  startBy?: string;
  videos?: string;
  /** Per video, by index. */
  video: Record<number, string>;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** What stops a draft saving, field by field. Empty (`hasErrors` false) when it can be saved. */
export function validateDraft(d: ScheduleDraft, now: number): ScheduleErrors {
  const e: ScheduleErrors = { video: {} };
  if (!d.name.trim()) e.name = "Give the schedule a name.";
  if (d.repeat === "weekly") {
    if (!d.days.length) e.days = "Pick at least one day.";
    if (!TIME_RE.test(d.time)) e.time = "A time like 08:15.";
    if (!isValidTimeZone(d.tz.trim())) e.tz = "An IANA time zone, like Europe/London.";
  } else {
    const at = new Date(d.onceAt).getTime();
    if (!Number.isFinite(at)) e.onceAt = "Pick a date and time.";
    else if (at <= now) e.onceAt = "Pick a time in the future.";
  }
  if (!(d.startByMs >= 60_000 && d.startByMs <= 24 * 3_600_000)) e.startBy = "Between 1 minute and 24 hours.";
  if (!d.videos.length) e.videos = "Add at least one video.";
  d.videos.forEach((v, i) => {
    if (!v.formatId) e.video[i] = "Pick a format.";
    else if (v.what.type === "script" && !v.what.scriptId) e.video[i] = "Pick a saved script.";
    else if (v.what.type === "template" && v.what.scope.type === "places" && !v.what.scope.places.length)
      e.video[i] = "Add at least one place.";
    else if (v.what.type === "template" && (v.what.scope.type === "country" || v.what.scope.type === "area") && !v.what.scope.id)
      e.video[i] = "Pick a place.";
    else if (!(v.roundup.maxAgeHours > 0 && v.roundup.maxAgeHours <= 24 * 14))
      e.video[i] = "A round-up age between 1 and 336 hours.";
  });
  return e;
}

export const hasErrors = (e: ScheduleErrors): boolean =>
  Object.entries(e).some(([k, v]) => (k === "video" ? Object.keys(v as object).length > 0 : !!v));

/** Move item `i` by `delta` (−1 up, +1 down); out of range is a no-op. */
export function moveItem<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** The time zones the picker suggests: the runtime's list, London first. */
export function timeZoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
  let zones: string[] = [];
  try {
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  return [LONDON, ...zones.filter((z) => z !== LONDON), ...(zones.includes("UTC") ? [] : ["UTC"])];
}
