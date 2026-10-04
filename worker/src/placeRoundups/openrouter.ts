/**
 * Per-place round-up narrative generation. Like `summaries/openrouter.ts` — a
 * thin `fetch` over OpenRouter's OpenAI-compatible endpoint, env-gated and fully
 * degrading (no key → stored without prose). The one real difference: the
 * PREVIOUS round-up for the same place is fed back in, so the model writes
 * continuity ("since our last update the storm has cleared…") instead of a cold
 * snapshot. The prompt states the REAL gap to that previous round-up — the
 * operator sets the local slots, so it isn't always twelve hours.
 */
import type {
  PlaceRoundupKind,
  RoundupNarrativeStatus,
  iPlaceRoundupInputs,
  iPlaceRoundup,
  iRoundupCityOutlook,
} from "@photonsurge/shared/db/place-roundup-model";
import { callOpenRouter } from "../lib/openrouter";
import { WINDOW_HOURS } from "./aggregate";

/** The structured round-up the LLM returns, plus a composed `narrative` fallback. */
export interface PlaceNarrativeSections {
  summary: string;
  stateOfPlay: string;
  cityOutlook: iRoundupCityOutlook[];
  advice: string;
  /** summary + state of play + advice joined — for legacy consumers + continuity. */
  narrative: string;
}

export interface PlaceNarrativeResult extends PlaceNarrativeSections {
  status: RoundupNarrativeStatus;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

const kindLabel = (kind: PlaceRoundupKind) => (kind === "country" ? "country" : "region");

const EMPTY_SECTIONS: PlaceNarrativeSections = {
  summary: "",
  stateOfPlay: "",
  cityOutlook: [],
  advice: "",
  narrative: "",
};

/**
 * PURE: how long ago the previous round-up was, in prompt wording — "about 8
 * hours ago", "less than an hour ago", "about 2 days ago". "earlier" when the
 * timestamp is missing, unparseable or in the future, so the prompt never
 * states a gap it doesn't know.
 */
export function sincePreviousPhrase(prevGeneratedAt: Date | string | null | undefined, now: Date): string {
  const t = prevGeneratedAt == null ? NaN : new Date(prevGeneratedAt).getTime();
  const hours = (now.getTime() - t) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return "earlier";
  if (hours < 1) return "less than an hour ago";
  const h = Math.round(hours);
  if (h < 48) return `about ${h} hour${h === 1 ? "" : "s"} ago`;
  return `about ${Math.round(hours / 24)} days ago`;
}

/**
 * Assemble the user prompt from the deterministic place facts + the previous
 * round-up (for continuity). The model returns a SINGLE JSON object with the
 * four sections (summary / state of play / per-city next-24h / advice). No
 * invented data — it works only from the JSON. Exported so the prompt shape is
 * unit-testable.
 */
export function buildPlacePrompt(
  place: { kind: PlaceRoundupKind; name: string },
  inputs: iPlaceRoundupInputs,
  prev?: Pick<iPlaceRoundup, "narrative" | "generatedAt" | "inputs"> | null,
  now: Date = new Date(),
): string {
  const prevAt = prev?.generatedAt != null ? new Date(prev.generatedAt) : null;
  const previous =
    prev && prev.narrative
      ? {
          generatedAt: prevAt && Number.isFinite(prevAt.getTime()) ? prevAt.toISOString() : undefined,
          alertsThen: prev.inputs?.alerts?.length ?? 0,
          volcanoesThen: prev.inputs?.volcanoes?.length ?? 0,
          narrative: prev.narrative,
        }
      : undefined;

  const facts = { place: place.name, kind: kindLabel(place.kind), windowHours: WINDOW_HOURS, ...inputs };

  const isRegion = place.kind === "region";
  const countries = inputs.countries ?? [];

  return [
    `Write a ${WINDOW_HOURS}-hour weather & hazard round-up for ${place.name} (${kindLabel(place.kind)}).`,
    "Use ONLY the facts in the JSON below — do not invent cities, events, numbers, or alerts.",
    "Ground every temperature, wind and rain figure in the actual city and area-weather values given.",
    "Broadcast anchor tone. Respond with a SINGLE JSON object (no markdown, no code fence) with EXACTLY these keys:",
    '  "summary": one or two sentences — the headline state of the ' +
      kindLabel(place.kind) +
      " right now (the short version an anchor reads first).",
    '  "stateOfPlay": a detailed 1–2 paragraph rundown of current conditions across the major cities' +
      " (call out the capital), then any active alerts, volcanoes and notable tide/seismograph readings." +
      " No headings or bullet lists — flowing prose.",
    '  "cities": an array of the main cities, each {"name": <city>, "outlook": <one sentence on the NEXT 24 HOURS' +
      " for that city, using its `daily` hi/lo/rain/gust>}. Cover the biggest cities and the capital;" +
      " skip any city with no forecast data.",
    '  "advice": practical advice for BOTH residents and visitors. Keep it brief and reassuring when conditions' +
      " are calm; when there are active alerts or hazards, be specific and prominent — what to do, what to avoid," +
      " and who is most affected. Never reference an alert or hazard that is not in the data.",
    isRegion
      ? `This is a REGION spanning several countries${
          countries.length ? ` (${countries.join(", ")})` : ""
        }. Frame the state of play and the advice ACROSS those countries — note where conditions or hazards differ between them — rather than as one nation.`
      : "This is a single country.",
    previous
      ? `The PREVIOUS round-up (${sincePreviousPhrase(prev?.generatedAt, now)}) is included as \`previousRoundUp\`. In the summary and state of play, note what has CHANGED since then — storms clearing or building, alerts added or lifted, temperatures trending — rather than repeating it. Do not contradict it.`
      : "There is no previous round-up — write it as the first update for this place.",
    "",
    "```json",
    JSON.stringify(previous ? { ...facts, previousRoundUp: previous } : facts, null, 2),
    "```",
  ].join("\n");
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Pull the first JSON object out of the model's reply, tolerating ``` fences and
 *  leading/trailing prose. Returns null when nothing parses. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const candidates = [stripped];
  const open = stripped.indexOf("{");
  const close = stripped.lastIndexOf("}");
  if (open >= 0 && close > open) candidates.push(stripped.slice(open, close + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Parse the model's reply into the four sections. Tolerant: if the reply isn't
 * the expected JSON (older model, refusal, plain prose), the whole text falls
 * back into `stateOfPlay` so nothing is lost. Exported for unit testing.
 */
export function parsePlaceNarrative(content: string): PlaceNarrativeSections {
  const text = (content ?? "").trim();
  if (!text) return { ...EMPTY_SECTIONS };

  const obj = extractJsonObject(text);
  if (!obj) return { ...EMPTY_SECTIONS, stateOfPlay: text, narrative: text };

  const summary = asString(obj.summary);
  const stateOfPlay = asString(obj.stateOfPlay);
  const advice = asString(obj.advice);
  const cityOutlook = Array.isArray(obj.cities)
    ? obj.cities
        .map((c) => ({ name: asString((c as any)?.name), outlook: asString((c as any)?.outlook) }))
        .filter((c) => c.name && c.outlook)
    : [];
  const narrative = [summary, stateOfPlay, advice].filter(Boolean).join("\n\n") || text;
  return { summary, stateOfPlay, cityOutlook, advice, narrative };
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
  if (!key) return { ...EMPTY_SECTIONS, status: "skipped" };

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const system =
    "You are the newsroom writer for a 24/7 weather broadcast. You write tight, " +
    "accurate regional round-ups from structured data, tracking how conditions " +
    "evolve from one update to the next. You always reply with the requested JSON object.";

  const res = await callOpenRouter({
    model,
    system,
    user: buildPlacePrompt(place, inputs, prev),
    temperature: 0.4,
    // Four sections + a per-city list is more than the old single paragraph.
    maxTokens: 1200,
    responseFormat: "json_object",
  });
  const sections = parsePlaceNarrative(res.content);
  return {
    ...sections,
    status: res.status,
    model: res.model,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    latencyMs: res.latencyMs,
    error: res.error,
  };
}
