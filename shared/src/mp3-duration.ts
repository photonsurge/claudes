/**
 * Duration of an MP3 from its frame headers (there is no ffmpeg in the
 * project). Walks every MPEG audio frame and sums samples / sample rate, so a
 * VBR file is measured correctly without trusting a Xing/VBRI header.
 *
 * Returns null when no frame is found (not an MP3, or empty). Pure — runs on
 * a Uint8Array so it can be bundled anywhere.
 */

// Bitrates in kbit/s, index 1..14 (0 = free, 15 = bad).
const BITRATES: Record<string, number[]> = {
  // MPEG-1
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  // MPEG-2 and 2.5
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

/** Skip an ID3v2 tag at the start, if any. */
function id3v2Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  const footer = b[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

export function mp3DurationMs(bytes: Uint8Array): number | null {
  let i = id3v2Length(bytes);
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const versionBits = (bytes[i + 1] >> 3) & 0x03; // 0 = 2.5, 2 = 2, 3 = 1
    const layerBits = (bytes[i + 1] >> 1) & 0x03; // 1 = III, 2 = II, 3 = I
    const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
    const rateIdx = (bytes[i + 2] >> 2) & 0x03;
    const padding = (bytes[i + 2] >> 1) & 0x01;
    if (versionBits === 1 || layerBits === 0 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) {
      i++;
      continue;
    }
    const layer = 4 - layerBits; // 1, 2 or 3
    const v1 = versionBits === 3;
    const bitrate = BITRATES[`${v1 ? 1 : 2}-${layer}`][bitrateIdx] * 1000;
    const sampleRate = SAMPLE_RATES[versionBits][rateIdx];
    const samples = layer === 1 ? 384 : layer === 2 ? 1152 : v1 ? 1152 : 576;
    const frameLen =
      layer === 1
        ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
        : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
    if (frameLen < 4) {
      i++;
      continue;
    }
    seconds += samples / sampleRate;
    frames++;
    i += frameLen;
  }
  return frames ? Math.round(seconds * 1000) : null;
}

/** Duration of 16-bit mono PCM at `sampleRate` (for `response_format: "pcm"`). */
export function pcmDurationMs(byteLength: number, sampleRate = 24000): number {
  return Math.round((byteLength / 2 / sampleRate) * 1000);
}
