/**
 * Long text → several speech requests → one audio file
 * (docs/presenter-plan.md: long round-ups).
 *
 * Speech models cap the input per request, and long inputs are slower and
 * fail more. So the worker splits speakable text into parts, speaks each, and
 * joins the MP3s. Splits fall at the most natural break that fits: paragraph,
 * then sentence, then clause, then word — so a part never ends mid-sentence
 * unless a single sentence is longer than the limit.
 *
 * Pure: no Node APIs, so it can be unit-tested and bundled anywhere.
 */

/** Default characters per request. Conservative: every model on the list has taken this. */
export const DEFAULT_CHUNK_CHARS = 1200;

function splitBy(text: string, rx: RegExp): string[] {
  return text
    .split(rx)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pack pieces into parts of at most `max` chars, joining with `sep`. Pieces longer than `max` are passed through for a finer split. */
function pack(pieces: string[], max: number, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (!cur) cur = p;
    else if (cur.length + sep.length + p.length <= max) cur += sep + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const LEVELS: Array<{ rx: RegExp; sep: string }> = [
  { rx: /\n\s*\n/, sep: "\n\n" }, // paragraphs
  { rx: /(?<=[.!?…])\s+/, sep: " " }, // sentences
  { rx: /(?<=[,;:—])\s+/, sep: " " }, // clauses
  { rx: /\s+/, sep: " " }, // words
];

function splitLevel(text: string, max: number, level: number): string[] {
  if (text.length <= max) return [text];
  if (level >= LEVELS.length) {
    // One unbroken run longer than the limit: hard cut.
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
  }
  const { rx, sep } = LEVELS[level];
  const pieces = splitBy(text, rx).flatMap((p) => (p.length > max ? splitLevel(p, max, level + 1) : [p]));
  return pack(pieces, max, sep);
}

/** Split text into parts of at most `maxChars` (min 100), at the most natural breaks. Empty text → []. */
export function splitForSpeech(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  return splitLevel(t, Math.max(100, Math.floor(maxChars)), 0);
}

// ---------------------------------------------------------------------------
// Joining MP3 parts
// ---------------------------------------------------------------------------

/** Byte length of a leading ID3v2 tag, or 0. */
function id3v2Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Length of the Layer III frame at `i`, or 0 if there is no valid header there. */
function frameLength(b: Uint8Array, i: number): number {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  const br = (b[i + 2] >> 4) & 15;
  const sr = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return 0; // Layer III only
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATE_V1_L3 : BITRATE_V2_L3)[br] * 1000;
  const samples = v1 ? 1152 : 576;
  return Math.floor(((samples / 8) * bitrate) / RATES[version][sr]) + ((b[i + 2] >> 1) & 1);
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/**
 * The audio frames of one MP3, without the parts that describe the WHOLE file:
 * a leading ID3v2 tag, a trailing ID3v1 tag, and a Xing/Info/VBRI header frame
 * (it carries the frame count, so left in it would make players report the
 * first part's length as the length of the joined file).
 */
export function mp3Frames(bytes: Uint8Array): Uint8Array {
  let start = id3v2Length(bytes);
  let end = bytes.length;
  if (end - start >= 128 && ascii(bytes, end - 128, 3) === "TAG") end -= 128;

  // Find the first frame (a few junk bytes can precede it).
  while (start < end && !frameLength(bytes, start)) start++;
  const first = frameLength(bytes, start);
  if (first && start + first <= end) {
    const frame = bytes.subarray(start, start + first);
    const text = ascii(frame, 0, Math.min(frame.length, 200));
    if (text.includes("Xing") || text.includes("Info") || text.includes("VBRI")) start += first;
  }
  return bytes.subarray(start, end);
}

/** Join MP3 parts into one playable file (frames back to back). A single part is returned unchanged. */
export function joinMp3(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const frames = parts.map(mp3Frames);
  const out = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}
