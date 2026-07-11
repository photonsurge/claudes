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

const TAG = "job:summaries";

/** How many recent hourly round-ups the 12h retrospective synthesises. */
const ROLLUP_HOURS = 12;

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

    // The 12h round-up is a retrospective SYNTHESIS of the recent hourly
    // round-ups (+ the current snapshot + area context); hourly/daily narrate
    // the snapshot directly, with the previous prose fed back for continuity.
    let narrative;
    if (period === "12h") {
      const hourlies = await db.eventSummaries.list({ period: "hourly", limit: ROLLUP_HOURS });
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

/** Dispatched as type "summaries", one event per cadence. */
export const generateHourly = (_job: Job) => run("hourly");
export const generate12h = (_job: Job) => run("12h");
export const generateDaily = (_job: Job) => run("daily");
