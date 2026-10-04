/**
 * Round-up settings for the hot paths that only READ them to judge staleness
 * (director candidate builds, short-video openers). Those run every cut, so the
 * settings are cached in-process for a minute — an admin edit reaches air
 * within that, which is plenty for "how long may a round-up keep airing".
 *
 * Never throws: a missing collection, a Mongo blip or a test fake without
 * `roundupSettings` yields the DEFAULTS (today's behaviour) rather than
 * breaking the director. Only successful reads are cached, so a blip is retried
 * on the next call instead of pinning defaults for a minute.
 *
 * The schedulers (summaries.tick, placeRoundups) read db.roundupSettings
 * directly: they run hourly and must see the operator's latest edit.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_ROUNDUP_SETTINGS, type RoundupSettings } from "@photonsurge/shared/roundup-settings";

export const ROUNDUP_SETTINGS_TTL_MS = 60_000;

let cached: { at: number; value: RoundupSettings } | null = null;

export async function cachedRoundupSettings(
  db: Pick<AppDb, "roundupSettings">,
  now: number = Date.now(),
): Promise<RoundupSettings> {
  if (cached && now - cached.at < ROUNDUP_SETTINGS_TTL_MS) return cached.value;
  try {
    const value = await db.roundupSettings.get();
    cached = { at: now, value };
    return value;
  } catch {
    return DEFAULT_ROUNDUP_SETTINGS;
  }
}

/** Test hook: forget the cached read. */
export function resetRoundupSettingsCache(): void {
  cached = null;
}
