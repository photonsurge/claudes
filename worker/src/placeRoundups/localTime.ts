/**
 * Local-time phasing for per-place round-ups. The cron fires hourly, but each
 * country/region should only generate when it's the target local hour THERE —
 * so a place's round-up lands in its own early morning (and evening), not at a
 * fixed UTC instant that's the middle of someone's night.
 *
 * Timezone is derived from the bbox-centre longitude (round(lng/15)) — no DST,
 * no tz database, good enough for an "early-AM feel" (a summer place can read an
 * hour off, which doesn't matter for a morning round-up). Everything here is
 * PURE (`now` is passed in) so it's unit-testable.
 */
import { bboxCenter } from "./aggregate";

type Bbox = [number, number, number, number];

/** Local hours (0–23) each place aims to generate at — its morning + evening slots. */
export const TARGET_HOURS: number[] = (process.env.PLACE_ROUNDUP_TARGET_HOURS || "6,18")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((h) => Number.isFinite(h) && h >= 0 && h <= 23);

/** Hours after a target slot during which a place stays eligible — absorbs a
 *  missed hourly fire (worker restart) so a place isn't skipped for a whole slot. */
const CATCHUP_HOURS = Number(process.env.PLACE_ROUNDUP_CATCHUP_HOURS) || 3;

/** Minimum gap since a place's last round-up before it may fire again — guards
 *  against double-firing within one multi-hour catch-up window. Just under the
 *  12h slot spacing so a legitimately-due slot is never blocked. */
const MIN_GAP_HOURS = Number(process.env.PLACE_ROUNDUP_MIN_GAP_HOURS) || 11;

/** PURE: representative whole-hour UTC offset for a bbox, from its centre longitude. */
export function placeOffsetHours(bbox: Bbox): number {
  const { lng } = bboxCenter(bbox);
  return Math.max(-12, Math.min(14, Math.round(lng / 15))) || 0; // `|| 0` normalises -0 → 0
}

/** PURE: fractional local hour (0–24) at the place, given `now` and its offset. */
export function localHourFloat(now: Date, offsetHours: number): number {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  return ((utcHours + offsetHours) % 24 + 24) % 24;
}

/**
 * PURE: should this place generate a round-up right now? True when the place's
 * local time sits within a catch-up window after one of its target hours AND its
 * last round-up (if any) is older than the min gap. `lastGeneratedAt` = null when
 * the place has never generated (fire immediately once in-window).
 */
export function isPlaceDue(now: Date, bbox: Bbox, lastGeneratedAt: Date | null): boolean {
  if (!TARGET_HOURS.length) return true; // misconfigured → fall back to firing every run
  const localH = localHourFloat(now, placeOffsetHours(bbox));
  const sinceSlot = Math.min(...TARGET_HOURS.map((t) => ((localH - t) % 24 + 24) % 24));
  if (sinceSlot >= CATCHUP_HOURS) return false; // not in any firing window
  if (!lastGeneratedAt) return true;
  const hoursSinceLast = (now.getTime() - lastGeneratedAt.getTime()) / 3_600_000;
  return hoursSinceLast >= MIN_GAP_HOURS;
}
