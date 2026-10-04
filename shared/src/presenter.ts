/**
 * The presenter: a named persona with a voice (docs/presenter-plan.md §5).
 *
 * This phase is the voice audition only — presenters are a catalog the
 * operator edits on /admin/presenters and tests by ear. Nothing is generated
 * in the background and nothing goes to air yet. Every speech call is behind
 * the master switch in `PresenterSettings`, set from the same page.
 *
 * No mongoose/runtime imports here — the admin page bundles this file.
 */

export interface PresenterVoice {
  /** OpenRouter speech model id, e.g. "hexgrad/kokoro-82m". */
  model: string;
  /** One of the model's voices, or a provider voice id. null = the model's default. */
  voice: string | null;
  /** 1 = normal. Clamped to 0.5..2. */
  speed: number;
  /** Delivery note in plain words ("calm, measured, late-night desk"). How it is sent depends on the model (worker voice-traits). */
  style: string | null;
  /** Raw provider options, passed through as given. */
  options: Record<string, unknown> | null;
}

export interface Presenter {
  /** Slug, the stable key. */
  id: string;
  name: string;
  /** Who they are and how they talk. Not used until written lines exist (plan §10.4); kept so it is set once. */
  persona: string;
  voice: PresenterVoice;
  /** Bumps on every save. */
  rev: number;
  updatedAt?: string;
}

/** The page-wide switches. A singleton. */
export interface PresenterSettings {
  /** Master switch. Off = the worker makes no speech call at all, tests included. */
  enabled: boolean;
}

export const DEFAULT_PRESENTER_SETTINGS: PresenterSettings = { enabled: false };

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
/** Long round-ups are spoken in parts on the worker and joined, so this is generous. */
export const TEST_TEXT_MAX = 20000;
export const NAME_MAX = 80;
export const PERSONA_MAX = 2000;
export const STYLE_MAX = 300;

/** The cheapest model at the time of writing, so a first test costs next to nothing. */
export const DEFAULT_VOICE: PresenterVoice = {
  model: "hexgrad/kokoro-82m",
  voice: null,
  speed: 1,
  style: null,
  options: null,
};

export const DEFAULT_PRESENTER: Presenter = {
  id: "house",
  name: "House voice",
  persona: "A calm, clear newsreader for a live world weather and events channel.",
  voice: DEFAULT_VOICE,
  rev: 0,
};

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => str(v, max) || null;

/** "Night Desk!" → "night-desk". Empty when nothing usable is left. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Tolerant: missing or invalid fields fall back to DEFAULT_VOICE. Always a fresh object. */
export function sanitizeVoice(input: unknown): PresenterVoice {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const speedRaw = typeof v.speed === "number" && Number.isFinite(v.speed) ? v.speed : DEFAULT_VOICE.speed;
  const options =
    v.options && typeof v.options === "object" && !Array.isArray(v.options) && Object.keys(v.options).length
      ? { ...(v.options as Record<string, unknown>) }
      : null;
  return {
    model: str(v.model, 120) || DEFAULT_VOICE.model,
    voice: strOrNull(v.voice, 120),
    speed: Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, speedRaw)) * 100) / 100,
    style: strOrNull(v.style, STYLE_MAX),
    options,
  };
}

/**
 * Tolerant over a stored doc or a request body. The id comes from `id` or,
 * failing that, the name; null when neither yields a slug (the caller rejects).
 */
export function sanitizePresenter(input: unknown): Presenter | null {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = str(p.name, NAME_MAX);
  const id = slugify(str(p.id, 48) || name);
  if (!id) return null;
  return {
    id,
    name: name || id,
    persona: str(p.persona, PERSONA_MAX),
    voice: sanitizeVoice(p.voice),
    rev: typeof p.rev === "number" && Number.isInteger(p.rev) && p.rev >= 0 ? p.rev : 0,
    ...(typeof p.updatedAt === "string" ? { updatedAt: p.updatedAt } : {}),
  };
}

export function sanitizePresenterSettings(input: unknown): PresenterSettings {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return { enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_PRESENTER_SETTINGS.enabled };
}

// ---------------------------------------------------------------------------
// Voice catalog (OpenRouter's speech models), cached by the worker.
// ---------------------------------------------------------------------------

export interface SpeechModel {
  id: string;
  name: string;
  description: string;
  /** Voice ids the model lists. Empty = none listed (e.g. models that take a reference voice). */
  voices: string[];
  /** OpenRouter's pricing record as given: USD per unit, as strings. */
  pricing: Record<string, string>;
}

/**
 * Parse `GET /api/v1/models?output_modalities=speech`. Tolerant of shape:
 * `supported_voices` may be strings or `{ id | voice_id | name }` objects, and
 * any pricing key is kept. Entries without an id are dropped. Sorted by id.
 */
export function parseSpeechModels(json: unknown): SpeechModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: SpeechModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const id = str(m.id, 200);
    if (!id) continue;
    const voices: string[] = [];
    if (Array.isArray(m.supported_voices)) {
      for (const v of m.supported_voices) {
        if (typeof v === "string" && v.trim()) voices.push(v.trim());
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          const vid = str(o.id ?? o.voice_id ?? o.name, 200);
          if (vid) voices.push(vid);
        }
      }
    }
    const pricing: Record<string, string> = {};
    if (m.pricing && typeof m.pricing === "object") {
      for (const [k, v] of Object.entries(m.pricing as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number") pricing[k] = String(v);
      }
    }
    out.push({
      id,
      name: str(m.name, 200) || id,
      description: str(m.description, 1000),
      voices: [...new Set(voices)],
      pricing,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Gemini-style speech: about 25 audio tokens per second of output, about 4 input characters per token. */
const AUDIO_TOKENS_PER_SECOND = 25;
const CHARS_PER_TOKEN = 4;
/** A `completion` price at or above this is per second of audio, below it per audio token. */
const PER_SECOND_FLOOR = 0.0005;

/**
 * Best-effort USD estimate for speaking `chars` characters lasting `durationMs`.
 * OpenRouter's speech pricing (checked 2026-10-04) comes in three shapes:
 *
 *  - `prompt` only (most models): USD per input character.
 *  - `prompt` 0 and a large `completion` (ByteDance, 0.0025): USD per second of audio.
 *  - small `prompt` and `completion` (Gemini TTS): per input token and per audio
 *    token, estimated at 4 characters a token and 25 audio tokens a second.
 *
 * null when nothing applies (or a duration is needed and unknown). The real bill
 * is on OpenRouter's activity page under the generation id.
 */
export function estimateSpeechCostUsd(
  pricing: Record<string, string> | undefined,
  chars: number,
  durationMs?: number | null,
): number | null {
  if (!pricing) return null;
  const num = (k: string) => {
    const n = Number(pricing[k]);
    return pricing[k] != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const prompt = num("prompt") ?? num("input");
  const completion = num("completion");
  const seconds = durationMs != null && durationMs > 0 ? durationMs / 1000 : null;

  if (completion == null) return prompt != null ? prompt * chars : null;
  if (completion >= PER_SECOND_FLOOR) {
    return seconds == null ? null : completion * seconds + (prompt ?? 0) * chars;
  }
  // Token-billed.
  if (seconds == null) return null;
  return (prompt ?? 0) * (chars / CHARS_PER_TOKEN) + completion * seconds * AUDIO_TOKENS_PER_SECOND;
}

/** USD per million characters, for the voice list. null when the model is not billed per character. */
export function pricePerMillionChars(pricing: Record<string, string> | undefined): number | null {
  if (!pricing || Number(pricing.completion) > 0) return null;
  const est = estimateSpeechCostUsd(pricing, 1_000_000, null);
  return est == null ? null : Math.round(est * 100) / 100;
}

/** USD per hour of speech (at 15 characters a second for per-character models), for comparing voices. */
export function pricePerHour(pricing: Record<string, string> | undefined): number | null {
  const est = estimateSpeechCostUsd(pricing, 15 * 3600, 3_600_000);
  return est == null ? null : Math.round(est * 100) / 100;
}

// ---------------------------------------------------------------------------
// Round-up text the presenter reads (plan §7, decision 19).
// ---------------------------------------------------------------------------

/**
 * What a presenter reads for a round-up. Global: the narrative. Place: the
 * summary and the state of play; older docs without the sections fall back to
 * the composed narrative.
 */
export function roundupSpeechText(r: { narrative?: string; summary?: string; stateOfPlay?: string }): string {
  const sections = [r.summary, r.stateOfPlay].map((x) => x?.trim()).filter(Boolean);
  return sections.length ? sections.join("\n\n") : (r.narrative ?? "").trim();
}

// ---------------------------------------------------------------------------
// Voice tests: one spoken take, stored so earlier takes stay for comparison.
// ---------------------------------------------------------------------------

export type VoiceTestStatus = "queued" | "speaking" | "ready" | "error";

export interface VoiceTest {
  id: string;
  /** The presenter tested, or null for a bench take on unsaved settings. */
  presenterId: string | null;
  /** A label for the list: the presenter's name, or what the operator called the take. */
  label: string;
  /** What the operator typed. */
  text: string;
  /** What was sent to the speech model: `speakable(text)`, plus any style tags. */
  spoken?: string;
  voice: PresenterVoice;
  status: VoiceTestStatus;
  error?: string;
  audio?: {
    contentType: string;
    bytes: number;
    chars: number;
    latencyMs: number;
    durationMs: number | null;
    /** Requests the text was split into (long text). */
    parts?: number;
    /** OpenRouter generation id(s), comma-separated when spoken in parts. */
    generationId?: string;
    estCostUsd: number | null;
  };
  /** Where the take was asked for: the admin page or the `yarn speak` CLI. */
  source?: "admin" | "cli";
  /** true = always make new audio, even if an identical take exists. */
  fresh?: boolean;
  /** Hash of everything sent to the speech model; identical requests share it. */
  cacheKey?: string;
  /** Set when the audio was reused from an earlier identical take (no charge). */
  cachedFrom?: string;
  /** While a long take is speaking: parts finished / total. */
  progress?: { done: number; total: number };
  /** Which voice properties actually reached the model (worker voice-traits). */
  sent?: { voice: boolean; speed: boolean; style: "option" | "text" | "voice-id" | "not-sent" | "none"; options: boolean };
  createdBy: string;
  createdAt: string;
}
