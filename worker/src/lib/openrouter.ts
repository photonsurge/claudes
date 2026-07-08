/**
 * Bare `fetch` wrapper over OpenRouter's OpenAI-compatible /chat/completions
 * endpoint. Callers decide their own "skipped" semantics (missing API key,
 * empty input, etc) before calling — this only does the HTTP round trip and
 * reports ok/error.
 */
export interface OpenRouterCallOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenRouterCallResult {
  content: string;
  status: "ok" | "error";
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  error?: string;
}

export async function callOpenRouter(opts: OpenRouterCallOptions): Promise<OpenRouterCallResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const started = Date.now();
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 700,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { content: "", status: "error", latencyMs, error: `${res.status} ${body}`.slice(0, 500) };
    }
    const body: any = await res.json();
    const content: string = body?.choices?.[0]?.message?.content ?? "";
    return {
      content,
      status: content ? "ok" : "error",
      model: body?.model ?? opts.model,
      promptTokens: body?.usage?.prompt_tokens,
      completionTokens: body?.usage?.completion_tokens,
      latencyMs,
      error: content ? undefined : "empty completion",
    };
  } catch (err) {
    return { content: "", status: "error", latencyMs: Date.now() - started, error: String(err).slice(0, 500) };
  }
}
