/**
 * The voice bench (docs/presenter-plan.md §8, voice preview). One take: the
 * operator's text, made speakable, spoken in one set of voice properties,
 * stored with its audio so takes can be compared side by side.
 *
 * On demand only — called from the `presenter.test` job, which the admin page
 * enqueues. Nothing here runs on a schedule.
 */
import { createHash } from "node:crypto";
import type { getAppDb } from "@photonsurge/shared/db/index";
import { estimateSpeechCostUsd, type VoiceTest } from "@photonsurge/shared/presenter";
import { speakable } from "@photonsurge/shared/speakable";
import { mp3DurationMs } from "@photonsurge/shared/mp3-duration";
import { listSpeechModels, speak as defaultSpeak } from "../lib/openrouter-speech";
import { prepareSpeech, type PreparedSpeech } from "./voice-traits";
import { speakLong } from "./speak-long";

type Db = Awaited<ReturnType<typeof getAppDb>>;

export interface BenchDeps {
  speak?: typeof defaultSpeak;
  hasKey?: () => boolean;
  /** The CLI is an explicit operator action, so it does not need the page's master switch. */
  ignoreSwitch?: boolean;
  listModels?: typeof listSpeechModels;
}

/**
 * The model's price from the cached catalog. With no catalog yet (nobody has
 * pressed "Refresh voices"), fetch it once now: it is a free GET, and without
 * it every take's cost reads as unknown. A failure just leaves the cost unknown.
 */
async function pricingFor(db: Db, model: string, list?: typeof listSpeechModels) {
  let catalog = await db.speechCatalog.get();
  if (!catalog.models.length) {
    await refreshSpeechCatalog(db, list).catch(() => undefined);
    catalog = await db.speechCatalog.get();
  }
  return catalog.models.find((m) => m.id === model)?.pricing;
}

/**
 * Hash of everything that reaches the speech model. Two takes with the same key
 * would send the same request, so the second can reuse the first's audio.
 */
export function speechCacheKey(model: string, p: PreparedSpeech): string {
  const req = { model, input: p.input, voice: p.voice, speed: p.speed, extra: p.extra };
  return createHash("sha256").update(JSON.stringify(req)).digest("hex").slice(0, 32);
}

/** Why a take could not be spoken before any call was made, or null to go ahead. */
async function blocked(db: Db, hasKey: () => boolean, ignoreSwitch: boolean): Promise<string | null> {
  if (!ignoreSwitch && !(await db.presenterSettings.get()).enabled) {
    return "The presenter is switched off. Turn it on at the top of /admin/presenters.";
  }
  if (!hasKey()) return "OPENROUTER_API_KEY is not set in the worker's environment.";
  return null;
}

export async function runVoiceTest(db: Db, testId: string, deps: BenchDeps = {}): Promise<VoiceTest | null> {
  const speak = deps.speak ?? defaultSpeak;
  const hasKey = deps.hasKey ?? (() => !!process.env.OPENROUTER_API_KEY);

  const take = await db.voiceTests.get(testId);
  if (!take) return null;
  if (take.status === "ready") return take;

  const spokenText = speakable(take.text);
  // The whole text as one request: the cache key and the "what was sent" record.
  // Long text is still spoken in parts (below); the key covers all of them.
  const prepared = prepareSpeech(take.voice, spokenText);
  const cacheKey = speechCacheKey(take.voice.model, prepared);

  // Reuse identical audio unless a fresh take was asked for. Free, so the
  // master switch and API key are not needed for it.
  if (!take.fresh) {
    const hit = await db.voiceTests.findCached(cacheKey, testId);
    const audio = hit ? await db.voiceTests.getAudio(hit.id) : null;
    if (hit?.audio && audio) {
      await db.voiceTests.putAudio(testId, audio.data, {
        status: "ready",
        spoken: prepared.input,
        sent: prepared.sent,
        cacheKey,
        cachedFrom: hit.id,
        audio: { ...hit.audio, latencyMs: 0, estCostUsd: 0 },
      });
      return db.voiceTests.get(testId);
    }
  }

  const stop = await blocked(db, hasKey, !!deps.ignoreSwitch);
  if (stop) {
    await db.voiceTests.update(testId, { status: "error", error: stop });
    return db.voiceTests.get(testId);
  }

  await db.voiceTests.update(testId, { status: "speaking", spoken: prepared.input, sent: prepared.sent, cacheKey });

  // Long text goes as several requests, joined into one file (speak-long).
  const res = await speakLong(take.voice, spokenText, {
    speak,
    onProgress: (done, total) => (total > 1 ? db.voiceTests.update(testId, { progress: { done, total } }) : undefined),
  });
  if (!res.ok || !res.audio) {
    await db.voiceTests.update(testId, { status: "error", error: res.error ?? "no audio" });
    return db.voiceTests.get(testId);
  }

  const durationMs = mp3DurationMs(res.audio);
  const pricing = await pricingFor(db, take.voice.model, deps.listModels);

  await db.voiceTests.putAudio(testId, res.audio, {
    status: "ready",
    sent: res.first.sent,
    audio: {
      contentType: res.contentType ?? "audio/mpeg",
      bytes: res.audio.length,
      chars: res.chars,
      latencyMs: res.latencyMs,
      durationMs,
      parts: res.parts,
      generationId: res.generationIds.join(", ") || undefined,
      estCostUsd: estimateSpeechCostUsd(pricing, res.chars, durationMs),
    },
  });
  return db.voiceTests.get(testId);
}

/** Refresh the cached OpenRouter speech-model list. */
export async function refreshSpeechCatalog(db: Db, list: typeof listSpeechModels = listSpeechModels) {
  const models = await list();
  if (!models.length) throw new Error("OpenRouter returned no speech models; keeping the cached list");
  await db.speechCatalog.save(models);
  return { models: models.length, voices: models.reduce((n, m) => n + m.voices.length, 0) };
}
