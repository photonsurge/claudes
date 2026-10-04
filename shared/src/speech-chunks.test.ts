import { joinMp3, mp3Frames, splitForSpeech } from "./speech-chunks";
import { mp3DurationMs } from "./mp3-duration";

describe("splitForSpeech", () => {
  it("keeps short text whole", () => {
    expect(splitForSpeech("Hello there.", 500)).toEqual(["Hello there."]);
    expect(splitForSpeech("   ", 500)).toEqual([]);
  });

  it("splits at sentence ends, packing as many sentences as fit", () => {
    const s = "One two three four. Five six seven eight. Nine ten eleven twelve.";
    const parts = splitForSpeech(s, 100);
    expect(parts).toEqual([s]);
    const small = splitForSpeech(Array(10).fill("Sentence number here is fine.").join(" "), 100);
    for (const p of small) {
      expect(p.length).toBeLessThanOrEqual(100);
      expect(p.endsWith(".")).toBe(true);
    }
    expect(small.join(" ")).toBe(Array(10).fill("Sentence number here is fine.").join(" "));
  });

  it("prefers paragraph breaks", () => {
    const a = "A".repeat(60) + ".";
    const b = "B".repeat(60) + ".";
    expect(splitForSpeech(`${a}\n\n${b}`, 100)).toEqual([a, b]);
  });

  it("falls back to clauses, then words, for an over-long sentence", () => {
    const long = Array(40).fill("word").join(" ") + ", " + Array(40).fill("more").join(" ") + ".";
    const parts = splitForSpeech(long, 120);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("hard-cuts a run with no spaces", () => {
    const parts = splitForSpeech("x".repeat(250), 100);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
  });

  it("loses no text on a real-sized round-up", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence ${i} talks about the weather in some detail, with numbers.`).join(" ");
    const parts = splitForSpeech(text, 1200);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join(" ")).toBe(text);
  });
});

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: 417-byte frames. */
const FRAME = 417;
function frames(n: number, opts: { id3?: boolean; xing?: boolean; id3v1?: boolean } = {}): Uint8Array {
  const parts: number[] = [];
  if (opts.id3) parts.push(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0);
  const total = n + (opts.xing ? 1 : 0);
  for (let i = 0; i < total; i++) {
    const f = new Array(FRAME).fill(0);
    f.splice(0, 4, 0xff, 0xfb, 0x90, 0x64);
    if (opts.xing && i === 0) "Xing".split("").forEach((c, k) => (f[36 + k] = c.charCodeAt(0)));
    parts.push(...f);
  }
  if (opts.id3v1) parts.push(..."TAG".split("").map((c) => c.charCodeAt(0)), ...new Array(125).fill(0));
  return new Uint8Array(parts);
}

describe("mp3Frames / joinMp3", () => {
  it("strips ID3v2, the Xing frame and ID3v1", () => {
    const f = mp3Frames(frames(5, { id3: true, xing: true, id3v1: true }));
    expect(f.length).toBe(5 * FRAME);
    expect([...f.subarray(0, 2)]).toEqual([0xff, 0xfb]);
  });

  it("joins parts so the duration is the sum", () => {
    const joined = joinMp3([frames(10, { xing: true }), frames(20, { id3: true, xing: true })]);
    expect(joined.length).toBe(30 * FRAME);
    expect(mp3DurationMs(joined)).toBe(Math.round((30 * 1152 * 1000) / 44100));
  });

  it("returns a single part unchanged", () => {
    const one = frames(3, { xing: true });
    expect(joinMp3([one])).toBe(one);
  });
});
