import { DEFAULT_VOICE } from "@photonsurge/shared/presenter";
import { prepareSpeech, traitFor } from "./voice-traits";

const v = (over: Partial<typeof DEFAULT_VOICE>) => ({ ...DEFAULT_VOICE, ...over });

describe("prepareSpeech", () => {
  it("sends the text as is when there is no style", () => {
    const p = prepareSpeech(v({}), "Hello.");
    expect(p.input).toBe("Hello.");
    expect(p.sent).toEqual({ voice: false, speed: false, style: "none", options: false });
  });

  it("puts the style before the text for Gemini TTS", () => {
    const p = prepareSpeech(v({ model: "google/gemini-3.8-flash-tts", style: "Calm and measured" }), "Hello.");
    expect(p.input).toBe("Calm and measured: Hello.");
    expect(p.sent.style).toBe("text");
  });

  it("uses a (tag) for Fish Audio", () => {
    expect(prepareSpeech(v({ model: "fish-audio/s1", style: "calm" }), "Hi").input).toBe("(calm) Hi");
  });

  it("reports the style as carried by the voice id for Voxtral", () => {
    const p = prepareSpeech(v({ model: "mistralai/voxtral-mini-tts-2603", voice: "en_paul_sad", style: "sad" }), "Hi");
    expect(p.input).toBe("Hi");
    expect(p.sent.style).toBe("voice-id");
  });

  it("reports an unsupported style as not sent, and passes options through", () => {
    const p = prepareSpeech(v({ style: "warm", voice: "af_heart", speed: 1.1, options: { provider: { a: 1 } } }), "Hi");
    expect(p.input).toBe("Hi");
    expect(p.extra).toEqual({ provider: { a: 1 } });
    expect(p.sent).toEqual({ voice: true, speed: true, style: "not-sent", options: true });
  });

  it("has no trait for an unknown model", () => {
    expect(traitFor("hexgrad/kokoro-82m")).toBeNull();
  });
});
