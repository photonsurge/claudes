/**
 * OpenRouter narrative generation. A thin `fetch` wrapper over OpenRouter's
 * OpenAI-compatible /chat/completions endpoint (NOT the Anthropic SDK) that turns
 * the deterministic round-up facts into a short broadcast-style script. Env-gated
 * and fully degrading: with no OPENROUTER_API_KEY the round-up is still stored,
 * just without prose (`status: "skipped"`).
 */
import type { SummaryPeriod, NarrativeStatus, iSummaryStats } from "@photonsurge/shared/db/event-summary-model";
import type { AggregateResult } from "./aggregate";
import { callOpenRouter } from "../lib/openrouter";

export interface NarrativeResult {
  narrative: string;
  status: NarrativeStatus;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

const PERIOD_LABEL: Record<SummaryPeriod, string> = {
  hourly: "the past hour",
  "12h": "the past 12 hours",
  daily: "the past 24 hours",
};

/** Alerts-active / quake-count deltas vs. the previous round-up of the same cadence. */
export interface SummaryTrend {
  alertsActiveDelta: number;
  quakeCountDelta: number;
}

/** `prev` stats → the deltas worth mentioning, or null when there's no prior round-up to compare against. */
export function summaryTrend(current: iSummaryStats, prev: iSummaryStats | null): SummaryTrend | null {
  if (!prev) return null;
  return {
    alertsActiveDelta: current.alertsActive - prev.alertsActive,
    quakeCountDelta: current.quakeCount - prev.quakeCount,
  };
}

/** Assemble the user prompt from the deterministic facts (no invented data). */
export function buildPrompt(agg: AggregateResult, period: SummaryPeriod, trend?: SummaryTrend | null): string {
  const facts = {
    window: PERIOD_LABEL[period],
    stats: agg.stats,
    trendSincePreviousRoundUp: trend ?? undefined,
    hotspots: agg.hotspots.slice(0, 12),
    topEvents: agg.topEvents,
    sources: agg.sources,
  };
  return [
    `Write a global weather-events round-up covering ${PERIOD_LABEL[period]}.`,
    "Use ONLY the facts in the JSON below — do not invent events, places, or numbers.",
    "Lead with the most severe hotspots, name the regions, and mention notable",
    "individual events (major quakes, cyclones, extreme alerts). 2–3 tight paragraphs,",
    "broadcast anchor tone, no headings or bullet lists.",
    "If trendSincePreviousRoundUp is present and a delta is non-trivial, briefly note",
    "the change (e.g. \"up from N alerts last hour\") — skip it if both deltas are near zero.",
    "",
    "```json",
    JSON.stringify(facts, null, 2),
    "```",
  ].join("\n");
}

/**
 * Generate the round-up narrative. Returns `{status:"skipped"}` when no API key
 * is configured, `{status:"error"}` on any HTTP/parse failure (never throws), and
 * `{status:"ok"}` with prose + token usage on success.
 */
export async function generateNarrative(
  agg: AggregateResult,
  period: SummaryPeriod,
  trend?: SummaryTrend | null,
): Promise<NarrativeResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { narrative: "", status: "skipped" };

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const system =
    "You are the newsroom writer for a 24/7 weather broadcast. You write tight, " +
    "accurate round-ups of global weather events from structured data.";

  const res = await callOpenRouter({
    model,
    system,
    user: buildPrompt(agg, period, trend),
    temperature: 0.4,
    maxTokens: 700,
  });
  return {
    narrative: res.content,
    status: res.status,
    model: res.model,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    latencyMs: res.latencyMs,
    error: res.error,
  };
}
