/**
 * 12-hour retrospective. Unlike the hourly/daily snapshot round-ups, the 12h
 * round-up is a SYNTHESIS of the hourly round-ups written in the 12 hours before
 * it (as many as the operator's hourly slots produced — jobs/summaries.ts falls
 * back to a snapshot narrative when there are none): the model is handed each
 * one's stats + prose (oldest first) plus the current
 * snapshot, and asked to narrate the arc — what built, peaked, and cleared over
 * the window — closing on where things stand now. Same OpenRouter path and
 * graceful degradation as `openrouter.ts`; the pure prompt builder is unit-tested.
 */
import type { iEventSummaryModel } from "@photonsurge/shared/db/event-summary-model";
import type { AggregateResult } from "./aggregate";
import { callOpenRouter } from "../lib/openrouter";
import { hasAreaSignal, type AreaContext } from "./areaContext";
import type { NarrativeResult } from "./openrouter";

/** One hour's contribution to the retrospective — the stats that show a trend + the prose. */
function hourlyDigest(s: iEventSummaryModel) {
  return {
    at: s.windowEnd,
    alertsActive: s.stats.alertsActive,
    quakeCount: s.stats.quakeCount,
    quakeMaxMag: s.stats.quakeMaxMag,
    cyclones: s.stats.cyclones,
    volcanoErupting: s.stats.volcanoErupting,
    narrative: s.narrative || undefined,
  };
}

/**
 * Assemble the 12h retrospective prompt. `hourlies` arrive newest-first (as the
 * repo returns them); they're reversed to oldest-first so the model reads the
 * arc in order. `current` is a fresh snapshot for the "where things stand now"
 * close. Exported so the prompt shape is unit-testable.
 */
export function build12hRollupPrompt(
  hourlies: iEventSummaryModel[],
  current: AggregateResult,
  extras?: { area?: AreaContext | null; prevNarrative?: string | null },
): string {
  const area = hasAreaSignal(extras?.area) ? extras!.area : undefined;
  const prev = extras?.prevNarrative?.trim() || undefined;
  const facts = {
    hourlyRoundUps: hourlies.map(hourlyDigest).reverse(), // oldest → newest
    currentSnapshot: {
      stats: current.stats,
      hotspots: current.hotspots.slice(0, 12),
      topEvents: current.topEvents,
    },
    areaConditions: area?.areaWeather,
    placeHeadlines: area?.placeHeadlines,
    previousRoundUp: prev,
  };
  return [
    "Write a global weather-events round-up covering the past 12 hours.",
    "You are given `hourlyRoundUps` — the hourly round-ups across the window, oldest first —",
    "and a `currentSnapshot` of what is active right now. Synthesise the ARC of the 12 hours:",
    "what built, what peaked, and what has cleared — do not just restate the latest hour.",
    "Use ONLY the facts provided — do not invent events, places, or numbers.",
    "Name the regions and notable individual events (major quakes, cyclones, extreme alerts).",
    "Close on where things stand now, per `currentSnapshot`. 2–3 tight paragraphs,",
    "broadcast anchor tone, no headings or bullet lists.",
    area
      ? "Where `areaConditions` or `placeHeadlines` add colour, weave a line in — but only for places listed there."
      : "",
    prev
      ? "`previousRoundUp` is the last 12-hour round-up — note what has changed since it, don't repeat or contradict it."
      : "",
    "",
    "```json",
    JSON.stringify(facts, null, 2),
    "```",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate the 12h retrospective narrative. Same semantics as
 * `generateNarrative`: `{status:"skipped"}` with no API key, `{status:"error"}`
 * on any failure (never throws), `{status:"ok"}` with prose + usage on success.
 */
export async function generate12hRollup(
  hourlies: iEventSummaryModel[],
  current: AggregateResult,
  extras?: { area?: AreaContext | null; prevNarrative?: string | null },
): Promise<NarrativeResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { narrative: "", status: "skipped" };

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const system =
    "You are the newsroom writer for a 24/7 weather broadcast. You write tight, accurate " +
    "12-hour retrospectives of global weather events, synthesising a run of hourly updates.";

  const res = await callOpenRouter({
    model,
    system,
    user: build12hRollupPrompt(hourlies, current, extras),
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
