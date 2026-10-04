import { mp3DurationMs, pcmDurationMs } from "./mp3-duration";

/** A run of MPEG-1 Layer III frames at 128 kbit/s, 44.1 kHz, no padding (417 bytes each). */
function mp3Frames(n: number, id3 = false): Uint8Array {
  const frameLen = Math.floor((144 * 128000) / 44100); // 417
  const head = id3 ? 10 + 20 : 0;
  const b = new Uint8Array(head + n * frameLen);
  if (id3) b.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20], 0);
  for (let i = 0; i < n; i++) b.set([0xff, 0xfb, 0x90, 0x64], head + i * frameLen);
  return b;
}

describe("mp3DurationMs", () => {
  it("sums frames: 1152 samples each at 44.1 kHz", () => {
    expect(mp3DurationMs(mp3Frames(100))).toBe(Math.round((100 * 1152 * 1000) / 44100)); // 2612
  });
  it("skips a leading ID3v2 tag", () => {
    expect(mp3DurationMs(mp3Frames(10, true))).toBe(Math.round((10 * 1152 * 1000) / 44100));
  });
  it("returns null for bytes that are not MP3", () => {
    expect(mp3DurationMs(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(mp3DurationMs(new Uint8Array())).toBeNull();
  });
});

describe("pcmDurationMs", () => {
  it("16-bit mono at 24 kHz", () => {
    expect(pcmDurationMs(48000)).toBe(1000);
  });
});
