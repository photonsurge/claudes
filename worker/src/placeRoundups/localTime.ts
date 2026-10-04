/**
 * Local-time phasing for per-place round-ups. The cron fires hourly, but each
 * country/region only generates when one of its slots — LOCAL hours at the
 * place, set by the operator on the admin round-up pages (db.roundupSettings,
 * default 06:00 + 18:00) — has begun and not yet been served. So a place's
 * round-up lands in its own morning (and evening), not at a fixed UTC instant
 * that's the middle of someone's night.
 *
 * "Served" (any round-up since the slot began) replaces the old fixed minimum
 * gap, which would have blocked a third slot in a day; the slot maths and the
 * catch-up window are shared with the admin page (roundup-schedule.ts) so the
 * "next run" it shows is the one the worker takes.
 *
 * Timezone is derived from the bbox-centre longitude (round(lng/15)) — no DST,
 * no tz database, good enough for an "early-AM feel" (a summer place can read an
 * hour off, which doesn't matter for a morning round-up). Everything here is
 * PURE (`now` is passed in) so it's unit-testable.
 */
import type { RoundupSetting } from "@photonsurge/shared/roundup-settings";
import { isRoundupDue, placeOffsetHours } from "@photonsurge/shared/roundup-schedule";

type Bbox = [number, number, number, number];

/** PURE: representative whole-hour UTC offset for a bbox, from its centre longitude.
 *  Lives in shared so the admin pages (the schedule form's round-up hint) phase slots the same way. */
export { placeOffsetHours };

/**
 * PURE: should this place generate a round-up right now? True when the round-up
 * kind is enabled, the place's current local slot began under the catch-up
 * window ago, and nothing has been generated for the place since it began.
 * `lastGeneratedAt` = null when the place has never generated.
 */
export function isPlaceDue(now: Date, bbox: Bbox, lastGeneratedAt: Date | null, setting: RoundupSetting): boolean {
  return isRoundupDue(now, setting, lastGeneratedAt, placeOffsetHours(bbox));
}
