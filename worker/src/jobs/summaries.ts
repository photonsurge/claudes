import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { SummaryPeriod } from "@photonsurge/shared/db/event-summary-model";
import { SUMMARIES_UPDATED } from "@photonsurge/shared/control";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { aggregate } from "../summaries/aggregate";
import { generateNarrative, summaryTrend } from "../summaries/openrouter";
import { buildAreaContext } from "../summaries/areaContext";
import { generate12hRollup } from "../summaries/rollup";
import { planSummaryTick, hourliesInWindow, ROLLUP_WINDOW_HOURS, TICK_PERIODS } from "../summaries/schedule";

const TAG = "job:summaries";

/**
 * Generate one global weather-event round-up for `period`: aggregate the active
 * events into deterministic stats/hotspots/top-events, ask the LLM (via
 * OpenRouter) for a broadcast narrative, append the summary to Mongo, and push a
 * live event so the admin screen refetches. The narrative degrades gracefully:
 * with no OPENROUTER_API_KEY the stats are still stored.
 */
async function run(period: SummaryPeriod): Promise<{ id?: string; period: SummaryPeriod; narrativeStatus: string }> {
  const db = await getAppDb();
  try {
    const prev = await db.eventSummaries.latest(period);
    // `agg` is always the current snapshot — it backs the deterministic
    // stats/hotspots/topEvents the map + panels read, for every cadence.
    const [agg, area] = await Promise.all([aggregate(db, period), buildAreaContext(db)]);

    // The 12h round-up is a retrospective SYNTHESIS of the hourlies written in
    // the last 12 hours (+ the current snapshot + area context); hourly/daily
    // narrate the snapshot directly, with the previous prose fed back for
    // continuity. With hourlies thinned or switched off the window can be empty,
    // and a roll-up of nothing is not a round-up — the 12h then narrates the
    // snapshot like the daily does.
    let narrative;
    const hourlies =
      period === "12h"
        ? hourliesInWindow(
            // At most one hourly per hour, so this limit always covers the window.
            await db.eventSummaries.list({ period: "hourly", limit: ROLLUP_WINDOW_HOURS + 1 }),
            new Date(),
          )
        : [];
    if (hourlies.length) {
      narrative = await generate12hRollup(hourlies, agg, { area, prevNarrative: prev?.narrative });
    } else {
      const trend = summaryTrend(agg.stats, prev?.stats ?? null);
      narrative = await generateNarrative(agg, period, trend, { area, prevNarrative: prev?.narrative });
    }

    // Note area/round-up provenance when they actually contributed.
    if (area.areaWeather.length) agg.sources.push("area-weather");
    if (area.placeHeadlines.length) agg.sources.push("place-roundups");
    agg.sources = [...new Set(agg.sources)].sort();

    const saved = await db.eventSummaries.create({
      period,
      windowStart: agg.windowStart,
      windowEnd: agg.windowEnd,
      generatedAt: new Date(),
      stats: agg.stats,
      hotspots: agg.hotspots,
      topEvents: agg.topEvents,
      narrative: narrative.narrative,
      narrativeStatus: narrative.status,
      sources: agg.sources,
      llm: {
        model: narrative.model,
        promptTokens: narrative.promptTokens,
        completionTokens: narrative.completionTokens,
        latencyMs: narrative.latencyMs,
        error: narrative.error,
      },
    });
    const result = {
      id: saved.id,
      period,
      hotspots: agg.hotspots.length,
      alerts: agg.stats.alertsActive,
      quakes: agg.stats.quakeCount,
      narrativeStatus: narrative.status,
    };
    log(TAG, `${period} round-up done`, result);
    blogInfo(TAG, `${period} round-up (${agg.hotspots.length} hotspots, narrative=${narrative.status})`, result, "summaries", period);
    emitWorkerEvent({ type: SUMMARIES_UPDATED, data: { period, id: saved.id } });
    return { id: saved.id, period, narrativeStatus: narrative.status };
  } catch (err) {
    log(TAG, `${period} round-up failed`, summarizeForLog(err));
    blogErr(TAG, `${period} round-up failed`, err, "summaries", period);
    throw err;
  }
}

/**
 * The scheduled entry point: one repeatable fires this hourly and it writes
 * whichever round-ups have an unserved slot under the operator's settings
 * (db.roundupSettings, edited on the admin round-up pages). Settings are read
 * per tick, so an edit applies at the next tick with no restart.
 *
 * Periods run in order (hourly → 12h → daily) and independently: one failing
 * doesn't stop the others. The first error is rethrown after all were tried so
 * BullMQ retries the tick — the periods that succeeded have then served their
 * slot and skip on the retry.
 */
export async function tick(_job: Job) {
  const db = await getAppDb();
  const now = new Date();
  const settings = await db.roundupSettings.get();
  const latest = await Promise.all(
    TICK_PERIODS.map(async (p) => [p, (await db.eventSummaries.latest(p))?.generatedAt] as const),
  );
  const last = Object.fromEntries(latest.map(([p, at]) => [p, at ? new Date(at) : null]));
  const plan = planSummaryTick(now, settings, last);

  const ran: SummaryPeriod[] = [];
  const failed: SummaryPeriod[] = [];
  let firstErr: unknown;
  for (const period of plan.due) {
    try {
      await run(period);
      ran.push(period);
    } catch (err) {
      // run() has already logged it.
      failed.push(period);
      if (failed.length === 1) firstErr = err;
    }
  }
  const result = { ran, failed, skipped: plan.skipped };
  log(TAG, "tick", result);
  if (failed.length) throw firstErr;
  return result;
}

/**
 * Manual triggers (/admin "Generate now", /admin/jobs): write that cadence now,
 * ignoring the schedule. A run inside a slot serves it, so the tick won't
 * duplicate it.
 */
export const generateHourly = (_job: Job) => run("hourly");
export const generate12h = (_job: Job) => run("12h");
export const generateDaily = (_job: Job) => run("daily");
