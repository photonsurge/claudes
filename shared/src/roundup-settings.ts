import type { SummaryPeriod } from "./db/event-summary-model";

/**
 * Operator control over WHICH AI round-ups are generated and WHEN.
 *
 * Deliberately small: per round-up an on/off switch and a list of whole-hour
 * slots. The worker's hourly tick asks "has the current slot been served?"
 * (see roundup-schedule.ts) and the admin page uses the same functions to show
 * the next run, so the two can never disagree.
 *
 * No mongoose/runtime imports here — the admin page bundles this file.
 */

export const ROUNDUP_IDS = ["global-hourly", "global-12h", "global-daily", "place-country", "place-region"] as const;
export type RoundupId = (typeof ROUNDUP_IDS)[number];

export interface RoundupSetting {
  enabled: boolean;
  /** Slots: whole hours 0..23, unique, ascending. Global round-ups: UTC. Place round-ups: local time at the place. */
  hours: number[];
}
export type RoundupSettings = Record<RoundupId, RoundupSetting>;

const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Defaults reproduce the schedules that used to be hard-wired (three crons in
 * the worker plus PLACE_ROUNDUP_TARGET_HOURS="6,18"), so a fresh install with
 * no settings document behaves exactly as before.
 */
export const DEFAULT_ROUNDUP_SETTINGS: RoundupSettings = {
  "global-hourly": { enabled: true, hours: ALL_HOURS },
  "global-12h": { enabled: true, hours: [0, 12] },
  "global-daily": { enabled: true, hours: [0] },
  "place-country": { enabled: true, hours: [6, 18] },
  "place-region": { enabled: true, hours: [6, 18] },
};

export const ROUNDUP_META: Record<
  RoundupId,
  { label: string; clock: "utc" | "local"; period?: SummaryPeriod; placeKind?: "country" | "region" }
> = {
  "global-hourly": { label: "Global hourly", clock: "utc", period: "hourly" },
  "global-12h": { label: "Global 12-hour", clock: "utc", period: "12h" },
  "global-daily": { label: "Global daily", clock: "utc", period: "daily" },
  "place-country": { label: "Countries", clock: "local", placeKind: "country" },
  "place-region": { label: "Regions", clock: "local", placeKind: "region" },
};

/** SummaryPeriod → RoundupId and place kind → RoundupId lookups. */
export const ROUNDUP_ID_FOR_PERIOD: Record<SummaryPeriod, RoundupId> = {
  hourly: "global-hourly",
  "12h": "global-12h",
  daily: "global-daily",
};
export const ROUNDUP_ID_FOR_PLACE: Record<"country" | "region", RoundupId> = {
  country: "place-country",
  region: "place-region",
};

/** Integers 0..23, de-duplicated, ascending. Anything else is dropped. */
export function normalizeHours(hours: readonly unknown[]): number[] {
  const valid = hours.filter(
    (h): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23,
  );
  // `+ 0` folds -0 into 0 so it de-dupes against a real 0.
  return [...new Set(valid.map((h) => h + 0))].sort((a, b) => a - b);
}

/**
 * Tolerant: merges `input` over the defaults per id. Unknown ids dropped; a
 * missing/invalid `enabled` or `hours` falls back to that id's default; hours
 * are filtered to integers 0..23, de-duplicated and sorted. An EMPTY hours
 * array is valid (no slots = never scheduled). Always returns fresh
 * objects/arrays (never the DEFAULT references).
 *
 * Tolerance matters because this runs on whatever is in Mongo and on raw
 * request bodies: a half-written or older document must still yield a usable
 * schedule rather than stopping every round-up.
 */
export function sanitizeRoundupSettings(input: unknown): RoundupSettings {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out = {} as RoundupSettings;
  for (const id of ROUNDUP_IDS) {
    const def = DEFAULT_ROUNDUP_SETTINGS[id];
    const raw = src[id] && typeof src[id] === "object" ? (src[id] as Record<string, unknown>) : {};
    out[id] = {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : def.enabled,
      hours: Array.isArray(raw.hours) ? normalizeHours(raw.hours) : [...def.hours],
    };
  }
  return out;
}
