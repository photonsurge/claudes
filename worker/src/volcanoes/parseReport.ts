/**
 * LLM-assisted parsing of a volcano's freeform weekly bulletin text into a
 * few structured facts (plume height, VEI) regex can't reliably pull out of
 * inconsistent prose. Same OpenRouter wrapper pattern as
 * worker/src/summaries/openrouter.ts#generateNarrative: env-gated on
 * `OPENROUTER_API_KEY` (shared with the round-up narrator — no separate key),
 * "use ONLY the given text, don't invent" prompting, never throws.
 */
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

  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.OPENROUTER_VOLCANO_MODEL || process.env.OPENROUTER_MODEL || "google/gemini-flash-1.5";

  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 100,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(reportText) },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { status: "error", error: `${res.status} ${body}`.slice(0, 500) };
    }
    const body: any = await res.json();
    const content: string = body?.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { status: "error", error: "no JSON in completion" };
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
