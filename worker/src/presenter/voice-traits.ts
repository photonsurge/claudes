/**
 * How each speech model takes the presenter's voice properties
 * (docs/presenter-plan.md §5.1). OpenRouter does not report which properties
 * a model honours, so this table is what the bench has taught us. Add to it
 * as models are auditioned.
 *
 * `options` on the voice is always merged into the request body as given,
 * after everything here, so the operator can try a provider field this table
 * does not know yet.
 */
import type { PresenterVoice, VoiceTest } from "@photonsurge/shared/presenter";
import { DEFAULT_CHUNK_CHARS } from "@photonsurge/shared/speech-chunks";

type StyleRoute = "text-prefix" | "text-tag" | "voice-id" | "none";

interface Trait {
  match: (model: string) => boolean;
  style: StyleRoute;
  note: string;
  /** Characters per request for long text; DEFAULT_CHUNK_CHARS when absent. */
  chunkChars?: number;
}

const TRAITS: Trait[] = [
  {
    // Gemini TTS follows a natural-language direction placed before the words.
    match: (m) => m.startsWith("google/gemini") && m.includes("tts"),
    style: "text-prefix",
    note: "style is sent as a spoken direction before the text",
  },
  {
    // Fish Audio reads parenthesised emotion/tone tags.
    match: (m) => m.startsWith("fish-audio/"),
    style: "text-tag",
    note: "style is sent as a (tag) before the text",
  },
  {
    // The manner is part of the voice id (en_paul_neutral, en_paul_sad, read_speech_a).
    match: (m) => m.startsWith("mistralai/voxtral") || m.startsWith("sesame/csm"),
    style: "voice-id",
    note: "style is chosen by picking the voice",
  },
];

export function traitFor(model: string): Trait | null {
  return TRAITS.find((t) => t.match(model)) ?? null;
}

/** How much text to send per request for this model. */
export function chunkCharsFor(model: string): number {
  return traitFor(model)?.chunkChars ?? DEFAULT_CHUNK_CHARS;
}

export interface PreparedSpeech {
  input: string;
  voice: string | null;
  speed: number;
  extra: Record<string, unknown> | null;
  sent: NonNullable<VoiceTest["sent"]>;
}

/** Turn a voice and already-speakable text into the speech request fields. */
export function prepareSpeech(voice: PresenterVoice, text: string): PreparedSpeech {
  const trait = traitFor(voice.model);
  const style = voice.style?.trim() || null;
  let input = text;
  let styleSent: NonNullable<VoiceTest["sent"]>["style"] = style ? "not-sent" : "none";

  if (style && trait) {
    if (trait.style === "text-prefix") {
      input = `${style}: ${text}`;
      styleSent = "text";
    } else if (trait.style === "text-tag") {
      input = `(${style}) ${text}`;
      styleSent = "text";
    } else if (trait.style === "voice-id") {
      styleSent = "voice-id";
    }
  }

  return {
    input,
    voice: voice.voice,
    speed: voice.speed,
    extra: voice.options && Object.keys(voice.options).length ? voice.options : null,
    sent: {
      voice: !!voice.voice,
      speed: voice.speed !== 1,
      style: styleSent,
      options: !!(voice.options && Object.keys(voice.options).length),
    },
  };
}
