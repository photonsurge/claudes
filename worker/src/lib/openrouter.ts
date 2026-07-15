/**
 * Bare `fetch` wrapper over OpenRouter's OpenAI-compatible /chat/completions
 * endpoint. Callers decide their own "skipped" semantics (missing API key,
 * empty input, etc) before calling — this only does the HTTP round trip and
 * reports ok/error.
 *
 * Transient failures (undici network errors, 429, 5xx) are retried with capped
 * exponential backoff, matching the pacing/backoff idiom in
 * shared/utill/wikipedia. Without it a single blip permanently failed every
 * remaining item in a run, since callers loop over items and only log.
 */
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 5_000;
const TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * undici reports every network-layer failure as the same opaque
 * `TypeError: fetch failed`; the actionable reason (EAI_AGAIN, ECONNRESET,
 * UND_ERR_CONNECT_TIMEOUT…) only exists on the nested `cause` chain, so flatten
 * it — otherwise the logs can't distinguish DNS from a reset from a timeout.
 */
function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur instanceof Error && depth < 4; depth++) {
    const code = (cur as NodeJS.ErrnoException).code;
    parts.push(code ? `${cur.message} (${code})` : cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  if (!parts.length) parts.push(String(err));
  return parts.join(" ← ");
}

export interface OpenRouterCallOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the model for a strict JSON object reply (OpenAI-compatible `response_format`). */
  responseFormat?: "json_object";
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
  const body = JSON.stringify({
    model: opts.model,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 700,
    ...(opts.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  let lastError = "unknown error";
  for (let attempt = 0; ; attempt++) {
    let retryable: boolean;
    try {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const parsed: any = await res.json();
        const content: string = parsed?.choices?.[0]?.message?.content ?? "";
        return {
          content,
          status: content ? "ok" : "error",
          model: parsed?.model ?? opts.model,
          promptTokens: parsed?.usage?.prompt_tokens,
          completionTokens: parsed?.usage?.completion_tokens,
          latencyMs: Date.now() - started,
          error: content ? undefined : "empty completion",
        };
      }
      // 4xx (bad key/model/prompt) is deterministic — retrying just burns time.
      retryable = res.status === 429 || res.status >= 500;
      lastError = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
    } catch (err) {
      // Network-layer failure or our own timeout — both worth another attempt.
      retryable = true;
      lastError = describeError(err).slice(0, 500);
    }

    if (!retryable || attempt >= MAX_RETRIES) {
      return { content: "", status: "error", latencyMs: Date.now() - started, error: lastError };
    }
    await sleep(Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS));
  }
}
