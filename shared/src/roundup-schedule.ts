import { normalizeHours, type RoundupSetting } from "./roundup-settings";

/**
 * Pure slot arithmetic for the round-up schedule. `now` is always passed in so
 * the worker (deciding) and the admin page (showing the next run) compute the
 * same answer, and so tests are deterministic.
 *
 * A slot hour H with offset O means H:00 local = (H - O):00 UTC. Global
 * round-ups use O = 0; place round-ups use the place's whole-hour offset.
 */

/**
 * How long after a slot begins it may still be served. The worker ticks hourly,
 * so this tolerates a couple of missed ticks (restart, queue backlog) without
 * firing a stale 06:00 round-up at lunchtime.
 */
export const SLOT_CATCHUP_HOURS = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Whole hours, never -0/NaN (a -0 offset would otherwise leak into date maths and labels). */
const cleanOffset = (offsetHours: number | undefined): number => {
  const o = Number.isFinite(offsetHours) ? Math.round(offsetHours as number) : 0;
  return o === 0 ? 0 : o;
};

/** Every slot instant (UTC ms) on the local days from `fromDay` to `toDay` relative to now's local day. */
function slotInstants(now: Date, hours: readonly number[], offsetHours: number | undefined, fromDay: number, toDay: number): number[] {
  const offMs = cleanOffset(offsetHours) * HOUR_MS;
  const localMidnight = Math.floor((now.getTime() + offMs) / DAY_MS) * DAY_MS;
  const out: number[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    for (const h of normalizeHours(hours)) out.push(localMidnight + d * DAY_MS + h * HOUR_MS - offMs);
  }
  return out;
}

/** UTC instant at which the most recent slot at-or-before `now` began, or null when there are no slots. `offsetHours` is the place's whole-hour UTC offset (0 for global): a slot hour H means H:00 local = (H - offsetHours):00 UTC. Looks back across the day boundary (e.g. hours [6,18], local 03:00 → yesterday's 18:00 local). */
export function currentSlotStart(now: Date, hours: readonly number[], offsetHours?: number): Date | null {
  const t = now.getTime();
  const past = slotInstants(now, hours, offsetHours, -1, 0).filter((s) => s <= t);
  return past.length ? new Date(Math.max(...past)) : null;
}

/** UTC instant of the first slot strictly after `now`, or null with no slots. */
export function nextSlotStart(now: Date, hours: readonly number[], offsetHours?: number): Date | null {
  const t = now.getTime();
  const future = slotInstants(now, hours, offsetHours, 0, 1).filter((s) => s > t);
  return future.length ? new Date(Math.min(...future)) : null;
}

/**
 * DUE = enabled, has slots, the current slot began less than SLOT_CATCHUP_HOURS
 * ago, and nothing was generated since it began (lastGeneratedAt null or < slot
 * start). A manual run inside a slot therefore serves it — the operator pressing
 * "generate now" at 06:20 doesn't get a duplicate at the 07:00 tick.
 */
export function isRoundupDue(
  now: Date,
  setting: RoundupSetting,
  lastGeneratedAt: Date | null,
  offsetHours?: number,
): boolean {
  if (!setting.enabled) return false;
  const slot = currentSlotStart(now, setting.hours, offsetHours);
  if (!slot) return false;
  if (now.getTime() - slot.getTime() >= SLOT_CATCHUP_HOURS * HOUR_MS) return false;
  return !lastGeneratedAt || lastGeneratedAt.getTime() < slot.getTime();
}

/** Longest gap in hours between consecutive slots going round the clock (one slot → 24; all 24 → 1; none → 24). */
export function maxSlotGapHours(hours: readonly number[]): number {
  const hs = normalizeHours(hours);
  if (hs.length === 0) return 24;
  let max = hs[0] + 24 - hs[hs.length - 1]; // wrap-around gap
  for (let i = 1; i < hs.length; i++) max = Math.max(max, hs[i] - hs[i - 1]);
  return max;
}

/**
 * How long a round-up may keep airing: three slot gaps (3 × maxSlotGapHours, in
 * ms) when the round-up is enabled with slots; `fallbackMs` when disabled or
 * slot-less. Three gaps tolerates two missed generations before the old text is
 * pulled. At DEFAULT settings this equals the old constants: hourly 3h, 12h
 * 36h, daily 72h.
 */
export function roundupStaleAfterMs(setting: RoundupSetting, fallbackMs: number): number {
  if (!setting.enabled || normalizeHours(setting.hours).length === 0) return fallbackMs;
  return 3 * maxSlotGapHours(setting.hours) * HOUR_MS;
}
