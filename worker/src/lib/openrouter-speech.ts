/**
 * OpenRouter text-to-speech (docs/presenter-plan.md §1):
 *
 *   POST /api/v1/audio/speech  { model, input, voice, response_format, speed, provider? }
 *     → the audio bytes; the generation id in the `X-Generation-Id` header.
 *   GET  /api/v1/models?output_modalities=speech
 *     → the speech models with `supported_voices` and `pricing`.
 *
 * Same retry rules as openrouter.ts: network errors, 429 and 5xx are retried
 * with capped backoff; any other 4xx is returned at once.
 */
import { parseSpeechModels, type SpeechModel } from "@photonsurge/shared/presenter";
import { describeError } from "./openrouter";

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 5_000;
const TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = () => process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export interface SpeechRequest {
  model: string;
  input: string;
  voice?: string | null;
  speed?: number;
  responseFormat?: "mp3" | "pcm";
  /** Merged into the request body as given (provider-specific fields). */
  extra?: Record<string, unknown> | null;
  fetchImpl?: typeof fetch;
}

export type SpeechResult =
  | { ok: true; audio: Buffer; contentType: string; generationId?: string; latencyMs: number; body: Record<string, unknown> }
  | { ok: false; error: string; status?: number; latencyMs: number; body: Record<string, unknown> };

/** The request body exactly as sent — returned on both paths so the bench can show it. */
export function speechBody(req: SpeechRequest): Record<string, unknown> {
  return {
    model: req.model,
    input: req.input,
    ...(req.voice ? { voice: req.voice } : {}),
    ...(req.speed != null && req.speed !== 1 ? { speed: req.speed } : {}),
    response_format: req.responseFormat ?? "mp3",
    ...(req.extra ?? {}),
  };
}

export async function speak(req: SpeechRequest): Promise<SpeechResult> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const started = Date.now();
  const body = speechBody(req);
  const payload = JSON.stringify(body);

  let lastError = "unknown error";
  let lastStatus: number | undefined;
  for (let attempt = 0; ; attempt++) {
    let retryable: boolean;
    try {
      const res = await fetchImpl(`${base()}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = res.status;
      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? (body.response_format === "pcm" ? "audio/pcm" : "audio/mpeg");
        // A JSON body on a 200 is an error envelope, not audio.
        if (contentType.includes("json")) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `unexpected JSON reply: ${text.slice(0, 400)}`, status: res.status, latencyMs: Date.now() - started, body };
        }
        const audio = Buffer.from(await res.arrayBuffer());
        if (!audio.length) {
          return { ok: false, error: "empty audio", status: res.status, latencyMs: Date.now() - started, body };
        }
        return {
          ok: true,
          audio,
          contentType: contentType.split(";")[0].trim(),
          generationId: res.headers.get("x-generation-id") ?? undefined,
          latencyMs: Date.now() - started,
          body,
        };
      }
      retryable = res.status === 429 || res.status >= 500;
      lastError = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
    } catch (err) {
      retryable = true;
      lastError = describeError(err).slice(0, 500);
    }
    if (!retryable || attempt >= MAX_RETRIES) {
      return { ok: false, error: lastError, status: lastStatus, latencyMs: Date.now() - started, body };
    }
    await sleep(Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS));
  }
}

/** The speech model list. Throws on failure (the caller is a job; the error lands in its log). */
export async function listSpeechModels(fetchImpl: typeof fetch = fetch): Promise<SpeechModel[]> {
  const res = await fetchImpl(`${base()}/models?output_modalities=speech`, {
    headers: process.env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`models list ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return parseSpeechModels(await res.json());
}
