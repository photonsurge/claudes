/**
 * Which global round-ups the hourly `summaries.tick` should write, and which
 * hourlies a 12h roll-up may synthesise. PURE (`now` passed in, no Mongo) so
 * the schedule decision is unit-testable; jobs/summaries.ts does the I/O.
 *
 * Kept out of jobs/summaries.ts on purpose: every function exported from a
 * jobs/ module is auto-registered as a BullMQ handler.
 */
import type { SummaryPeriod, iEventSummaryModel } from "@photonsurge/shared/db/event-summary-model";
import { ROUNDUP_ID_FOR_PERIOD, type RoundupSettings } from "@photonsurge/shared/roundup-settings";
import { isRoundupDue } from "@photonsurge/shared/roundup-schedule";

/**
 * Tick order. Hourly first so a 12h roll-up in the same tick can synthesise the
 * hourly just written (the old separate crons fired the 12h at :10, a minute
 * BEFORE that hour's hourly at :11, so it always missed the freshest hour).
 */
export const TICK_PERIODS: readonly SummaryPeriod[] = ["hourly", "12h", "daily"];

export type SkipReason = "disabled" | "not-due";

export interface TickPlan {
  /** Periods to generate, in tick order. */
  due: SummaryPeriod[];
  skipped: Partial<Record<SummaryPeriod, SkipReason>>;
}

/** PURE: which periods' current slot is unserved. `lastGeneratedAt[period]` = newest doc's generatedAt, or null. */
export function planSummaryTick(
  now: Date,
  settings: RoundupSettings,
  lastGeneratedAt: Partial<Record<SummaryPeriod, Date | null>>,
): TickPlan {
  const plan: TickPlan = { due: [], skipped: {} };
  for (const period of TICK_PERIODS) {
    const setting = settings[ROUNDUP_ID_FOR_PERIOD[period]];
    if (!setting.enabled) plan.skipped[period] = "disabled";
    else if (isRoundupDue(now, setting, lastGeneratedAt[period] ?? null)) plan.due.push(period);
    else plan.skipped[period] = "not-due";
  }
  return plan;
}

/** The roll-up's window: it narrates the last 12 HOURS, however many hourlies that holds. */
export const ROLLUP_WINDOW_HOURS = 12;

/**
 * PURE: the hourlies generated inside the roll-up window. Filtering on time, not
 * count: once hourly slots can be thinned or switched off, "the last 12 docs"
 * could reach back days and the 12h round-up would narrate stale weather.
 */
export function hourliesInWindow<T extends Pick<iEventSummaryModel, "generatedAt">>(
  hourlies: T[],
  now: Date,
  windowHours: number = ROLLUP_WINDOW_HOURS,
): T[] {
  const since = now.getTime() - windowHours * 3_600_000;
  return hourlies.filter((h) => {
    const t = new Date(h.generatedAt).getTime();
    return Number.isFinite(t) && t > since && t <= now.getTime();
  });
}
