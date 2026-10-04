/**
 * Speak text of any length: split it into parts the model takes comfortably
 * (shared speech-chunks), speak them a few at a time, and join the MP3s in
 * order. One part = one ordinary request. Used by the bench and `yarn speak`.
 */
import type { PresenterVoice } from "@photonsurge/shared/presenter";
import { joinMp3, splitForSpeech } from "@photonsurge/shared/speech-chunks";
import { speak as defaultSpeak } from "../lib/openrouter-speech";
import { chunkCharsFor, prepareSpeech, type PreparedSpeech } from "./voice-traits";

/** Parts in flight at once: quicker than one at a time, gentle on rate limits. */
export const PARALLEL_PARTS = 3;

export interface LongSpeechResult {
  ok: boolean;
  audio?: Buffer;
  contentType?: string;
  error?: string;
  parts: number;
  /** Wall-clock time for the whole take. */
  latencyMs: number;
  /** Characters actually sent, all parts (including any style text). */
  chars: number;
  generationIds: string[];
  /** The first part's prepared request — what reached the model, for the take record. */
  first: PreparedSpeech;
}

export async function speakLong(
  voice: PresenterVoice,
  spokenText: string,
  opts: {
    speak?: typeof defaultSpeak;
    onProgress?: (done: number, total: number) => void | Promise<void>;
    maxChars?: number;
  } = {},
): Promise<LongSpeechResult> {
  const speak = opts.speak ?? defaultSpeak;
  const started = Date.now();
  const texts = splitForSpeech(spokenText, opts.maxChars ?? chunkCharsFor(voice.model));
  const prepared = texts.map((t) => prepareSpeech(voice, t));
  const results: Array<Awaited<ReturnType<typeof defaultSpeak>> | undefined> = new Array(prepared.length);
  let next = 0;
  let done = 0;
  let failed: string | null = null;

  const lane = async () => {
    while (!failed && next < prepared.length) {
      const i = next++;
      const p = prepared[i];
      const res = await speak({
        model: voice.model,
        input: p.input,
        voice: p.voice,
        speed: p.speed,
        responseFormat: "mp3",
        extra: p.extra,
      });
      results[i] = res;
      if (!res.ok) {
        failed = prepared.length > 1 ? `part ${i + 1} of ${prepared.length}: ${res.error}` : res.error;
        return;
      }
      done++;
      await opts.onProgress?.(done, prepared.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, prepared.length) }, lane));

  const base = {
    parts: prepared.length,
    latencyMs: Date.now() - started,
    chars: prepared.reduce((n, p) => n + p.input.length, 0),
    first: prepared[0] ?? prepareSpeech(voice, ""),
  };
  const oks = results.filter((r): r is Extract<NonNullable<typeof r>, { ok: true }> => !!r && r.ok);
  if (failed || !prepared.length || oks.length !== prepared.length) {
    return { ...base, ok: false, error: failed ?? "nothing to say", generationIds: oks.flatMap((r) => (r.generationId ? [r.generationId] : [])) };
  }
  return {
    ...base,
    ok: true,
    audio: oks.length === 1 ? oks[0].audio : Buffer.from(joinMp3(oks.map((r) => new Uint8Array(r.audio)))),
    contentType: oks[0].contentType,
    generationIds: oks.flatMap((r) => (r.generationId ? [r.generationId] : [])),
  };
}
