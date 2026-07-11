/**
 * Per-place round-up narrative generation. Like `summaries/openrouter.ts` — a
 * thin `fetch` over OpenRouter's OpenAI-compatible endpoint, env-gated and fully
 * degrading (no key → stored without prose). The one real difference: the
 * PREVIOUS round-up for the same place is fed back in, so the model writes
 * continuity ("since our last update 12h ago the storm has cleared…") instead of
 * a cold snapshot.
 */
import type {
  PlaceRoundupKind,
  RoundupNarrativeStatus,
  iPlaceRoundupInputs,
  iPlaceRoundup,
} from "@photonsurge/shared/db/place-roundup-model";
import { callOpenRouter } from "../lib/openrouter";
import { WINDOW_HOURS } from "./aggregate";

export interface PlaceNarrativeResult {
  narrative: string;
  status: RoundupNarrativeStatus;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

const kindLabel = (kind: PlaceRoundupKind) => (kind === "country" ? "country" : "region");

/**
 * Assemble the user prompt from the deterministic place facts + the previous
 * round-up (for continuity). No invented data — the model works only from what's
 * in the JSON. Exported so the prompt shape is unit-testable.
 */
export function buildPlacePrompt(
  place: { kind: PlaceRoundupKind; name: string },
  inputs: iPlaceRoundupInputs,
  prev?: Pick<iPlaceRoundup, "narrative" | "generatedAt" | "inputs"> | null,
): string {
  const previous =
    prev && prev.narrative
      ? {
          generatedAt: new Date(prev.generatedAt).toISOString(),
          alertsThen: prev.inputs?.alerts?.length ?? 0,
          volcanoesThen: prev.inputs?.volcanoes?.length ?? 0,
          narrative: prev.narrative,
        }
      : undefined;

  const facts = { place: place.name, kind: kindLabel(place.kind), windowHours: WINDOW_HOURS, ...inputs };

  return [
    `Write a ${WINDOW_HOURS}-hour weather & hazard round-up for ${place.name} (${kindLabel(place.kind)}).`,
    "Use ONLY the facts in the JSON below — do not invent cities, events, or numbers.",
    "Lead with the headline conditions across the major cities (call out the capital),",
    "then any active alerts, volcanoes, and notable tide/seismograph readings. Ground",
    "temperatures/winds in the actual city and area-weather figures given. 2–3 tight",
    "paragraphs, broadcast anchor tone, no headings or bullet lists.",
    previous
      ? "The PREVIOUS round-up (12 hours ago) is included as `previousRoundUp`. Open by noting what has CHANGED since then — storms clearing or building, alerts added or lifted, temperatures trending — rather than repeating it. Do not contradict it."
      : "There is no previous round-up — write it as the first update for this place.",
    "",
    "```json",
    JSON.stringify(previous ? { ...facts, previousRoundUp: previous } : facts, null, 2),
    "```",
  ].join("\n");
}

/**
 * Generate the round-up narrative. `{status:"skipped"}` with no API key,
 * `{status:"error"}` on any failure (never throws), `{status:"ok"}` + prose on success.
 */
export async function generatePlaceNarrative(
  place: { kind: PlaceRoundupKind; name: string },
  inputs: iPlaceRoundupInputs,
  prev?: Pick<iPlaceRoundup, "narrative" | "generatedAt" | "inputs"> | null,
): Promise<PlaceNarrativeResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { narrative: "", status: "skipped" };

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const system =
    "You are the newsroom writer for a 24/7 weather broadcast. You write tight, " +
    "accurate regional round-ups from structured data, tracking how conditions " +
    "evolve from one update to the next.";

  const res = await callOpenRouter({
    model,
    system,
    user: buildPlacePrompt(place, inputs, prev),
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
