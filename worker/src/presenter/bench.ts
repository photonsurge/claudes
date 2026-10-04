/**
 * The voice bench (docs/presenter-plan.md §8, voice preview). One take: the
 * operator's text, made speakable, spoken in one set of voice properties,
 * stored with its audio so takes can be compared side by side.
 *
 * On demand only — called from the `presenter.test` job, which the admin page
 * enqueues. Nothing here runs on a schedule.
 */
import type { getAppDb } from "@photonsurge/shared/db/index";
import { estimateSpeechCostUsd, type VoiceTest } from "@photonsurge/shared/presenter";
import { speakable } from "@photonsurge/shared/speakable";
import { mp3DurationMs, pcmDurationMs } from "@photonsurge/shared/mp3-duration";
import { listSpeechModels, speak as defaultSpeak } from "../lib/openrouter-speech";
import { prepareSpeech } from "./voice-traits";

type Db = Awaited<ReturnType<typeof getAppDb>>;

export interface BenchDeps {
  speak?: typeof defaultSpeak;
  hasKey?: () => boolean;
}

/** Why a take could not be spoken before any call was made, or null to go ahead. */
async function blocked(db: Db, hasKey: () => boolean): Promise<string | null> {
  if (!(await db.presenterSettings.get()).enabled) {
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

  const stop = await blocked(db, hasKey);
  if (stop) {
    await db.voiceTests.update(testId, { status: "error", error: stop });
    return db.voiceTests.get(testId);
  }

  const prepared = prepareSpeech(take.voice, speakable(take.text));
  await db.voiceTests.update(testId, { status: "speaking", spoken: prepared.input, sent: prepared.sent });

  const res = await speak({
    model: take.voice.model,
    input: prepared.input,
    voice: prepared.voice,
    speed: prepared.speed,
    responseFormat: "mp3",
    extra: prepared.extra,
  });
  if (!res.ok) {
    await db.voiceTests.update(testId, { status: "error", error: res.error });
    return db.voiceTests.get(testId);
  }

  const durationMs = res.contentType.includes("pcm") ? pcmDurationMs(res.audio.length) : mp3DurationMs(res.audio);
  const catalog = await db.speechCatalog.get();
  const pricing = catalog.models.find((m) => m.id === take.voice.model)?.pricing;

  await db.voiceTests.putAudio(testId, res.audio, {
    status: "ready",
    audio: {
      contentType: res.contentType,
      bytes: res.audio.length,
      chars: prepared.input.length,
      latencyMs: res.latencyMs,
      durationMs,
      generationId: res.generationId,
      estCostUsd: estimateSpeechCostUsd(pricing, prepared.input.length, durationMs),
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
