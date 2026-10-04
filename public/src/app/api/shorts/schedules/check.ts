/**
 * Shared by the schedule routes (docs/short-video-plan.md §8): validate a
 * schedule body onto a base and recompute its next fire. The API writes Mongo
 * directly; the worker's `short-video.tick` picks up `nextAt` on its next pass.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-format";
import { sanitizeShortSchedule, scheduleNextAt, type ShortSchedule } from "@photonsurge/shared/short-schedule";

export type ScheduleCheck = { ok: true; schedule: ShortSchedule } | { ok: false; error: string };

/**
 * Sanitise `body` onto `base`, refuse what the sanitiser would silently drop
 * (an invalid video, an unusable `when`), check every video's format exists,
 * and set `nextAt` from now: an edit always recomputes it. A once schedule
 * switched on with its time passed is refused.
 */
export async function checkSchedule(db: AppDb, body: Record<string, unknown>, base: ShortSchedule, now = Date.now()): Promise<ScheduleCheck> {
  const s = sanitizeShortSchedule(body, base);
  if (body.when !== undefined && s.when === base.when) {
    return { ok: false, error: 'when must be { type: "once", at } or { type: "weekly", days, time: "HH:MM", tz }' };
  }
  if (Array.isArray(body.videos) && s.videos.length !== body.videos.length) {
    return { ok: false, error: "every video needs a formatId and a script or a scope (country, area, globe or auto)" };
  }
  for (const id of new Set(s.videos.map((v) => v.formatId))) {
    if (id !== DEFAULT_SHORT_FORMAT_ID && !(await db.shortFormats.get(id))) return { ok: false, error: `no format "${id}"` };
  }
  s.nextAt = scheduleNextAt(s, now);
  if (s.enabled && s.when.type === "once" && s.nextAt == null) {
    return { ok: false, error: "the schedule's time has passed — pick a later one" };
  }
  return { ok: true, schedule: s };
}
