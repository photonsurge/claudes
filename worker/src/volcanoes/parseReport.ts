/**
 * LLM-assisted parsing of a volcano's freeform weekly bulletin text into a
 * few structured facts (plume height, VEI) regex can't reliably pull out of
 * inconsistent prose. Uses the shared OpenRouter wrapper (../lib/openrouter):
 * env-gated on `OPENROUTER_API_KEY` (shared with the round-up narrator — no
 * separate key), "use ONLY the given text, don't invent" prompting, never throws.
 */
import { callOpenRouter } from "../lib/openrouter";

export interface ParsedReportFacts {
  plumeHeightM?: number;
  vei?: number;
  status: "ok" | "skipped" | "error";
  error?: string;
}

const SYSTEM =
  "You extract structured volcanology facts from a short activity-report snippet. " +
  "You only report facts explicitly stated in the given text — never estimate or infer a number that isn't written there.";

function buildPrompt(reportText: string): string {
  return [
    "Extract facts from this volcano activity report snippet. Respond with ONLY a JSON",
    'object of the shape {"plumeHeightM": number|null, "vei": number|null} — no prose,',
    "no markdown fences. Use null for any fact not explicitly stated in the text",
    "(convert km/ft mentions of ash/plume height to metres; VEI = Volcanic Explosivity",
    "Index, only if a number is explicitly given as VEI).",
    "",
    "Report text:",
    reportText,
  ].join("\n");
}

/** Parse one volcano's `latestReport` text via an LLM. Returns `{status:"skipped"}` with no API key configured. */
export async function parseReportFacts(
  reportText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedReportFacts> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { status: "skipped" };
  if (!reportText.trim()) return { status: "skipped" };

  const model = process.env.OPENROUTER_VOLCANO_MODEL || process.env.OPENROUTER_MODEL || "google/gemini-flash-1.5";

  const res = await callOpenRouter({
    model,
    system: SYSTEM,
    user: buildPrompt(reportText),
    temperature: 0,
    maxTokens: 100,
    fetchImpl,
  });
  if (res.status === "error") return { status: "error", error: res.error };
  const match = res.content.match(/\{[\s\S]*\}/);
  if (!match) return { status: "error", error: "no JSON in completion" };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      status: "ok",
      plumeHeightM: Number.isFinite(Number(parsed?.plumeHeightM)) ? Number(parsed.plumeHeightM) : undefined,
      vei: Number.isFinite(Number(parsed?.vei)) ? Number(parsed.vei) : undefined,
    };
  } catch (err) {
    return { status: "error", error: String(err).slice(0, 500) };
  }
}
