import { DEFAULT_VOICE } from "@photonsurge/shared/presenter";
import { mp3DurationMs } from "@photonsurge/shared/mp3-duration";
import { speakLong } from "./speak-long";

const FRAME = 417;
/** n MPEG-1 Layer III frames, with a Xing header frame first like a real encoder writes. */
function mp3(n: number): Buffer {
  const b = Buffer.alloc((n + 1) * FRAME);
  for (let i = 0; i <= n; i++) b.set([0xff, 0xfb, 0x90, 0x64], i * FRAME);
  b.write("Xing", 36);
  return b;
}

const sentence = (i: number) => `Sentence ${i} describes the weather over a long stretch of coast tonight.`;
const longText = Array.from({ length: 50 }, (_, i) => sentence(i)).join(" ");

describe("speakLong", () => {
  it("speaks short text in one request", async () => {
    const speak = jest.fn(async () => ({ ok: true as const, audio: mp3(5), contentType: "audio/mpeg", generationId: "g1", latencyMs: 1, body: {} }));
    const res = await speakLong(DEFAULT_VOICE, "Hello.", { speak });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(res.parts).toBe(1);
    expect(res.ok).toBe(true);
  });

  it("splits long text, speaks every part, and joins them in order", async () => {
    const seen: string[] = [];
    const speak = jest.fn(async (req: { input: string }) => {
      seen.push(req.input);
      // Finish out of order to prove the join keeps text order.
      await new Promise((r) => setTimeout(r, seen.length % 2 ? 5 : 0));
      return { ok: true as const, audio: mp3(10), contentType: "audio/mpeg", generationId: `g${seen.length}`, latencyMs: 1, body: {} };
    });
    const progress: string[] = [];
    const res = await speakLong(DEFAULT_VOICE, longText, { speak, maxChars: 600, onProgress: (d, t) => void progress.push(`${d}/${t}`) });

    expect(res.ok).toBe(true);
    expect(res.parts).toBeGreaterThan(3);
    expect(speak).toHaveBeenCalledTimes(res.parts);
    for (const s of seen) expect(s.length).toBeLessThanOrEqual(600);
    expect([...seen].sort((a, b) => longText.indexOf(a) - longText.indexOf(b)).join(" ")).toBe(longText);
    // Xing frames dropped: duration is exactly parts × 10 frames.
    expect(mp3DurationMs(res.audio!)).toBe(Math.round((res.parts * 10 * 1152 * 1000) / 44100));
    expect(progress[progress.length - 1]).toBe(`${res.parts}/${res.parts}`);
    expect(res.generationIds).toHaveLength(res.parts);
  });

  it("fails the take naming the part that failed", async () => {
    let n = 0;
    const speak = jest.fn(async () => {
      n++;
      return n === 2
        ? { ok: false as const, error: "429 rate limited", latencyMs: 1, body: {} }
        : { ok: true as const, audio: mp3(2), contentType: "audio/mpeg", latencyMs: 1, body: {} };
    });
    const res = await speakLong(DEFAULT_VOICE, longText, { speak, maxChars: 600 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^part \d+ of \d+: 429 rate limited$/);
  });

  it("applies the style to every part for Gemini", async () => {
    const inputs: string[] = [];
    const speak = jest.fn(async (req: { input: string }) => {
      inputs.push(req.input);
      return { ok: true as const, audio: mp3(1), contentType: "audio/mpeg", latencyMs: 1, body: {} };
    });
    await speakLong({ ...DEFAULT_VOICE, model: "google/gemini-3.8-flash-tts", style: "Calm" }, longText, { speak, maxChars: 600 });
    expect(inputs.length).toBeGreaterThan(1);
    for (const i of inputs) expect(i.startsWith("Calm: ")).toBe(true);
  });
});
