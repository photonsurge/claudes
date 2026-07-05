/**
 * Minimal SEED (v2) miniSEED record parser + STEIM1/STEIM2 decompressor —
 * just enough to turn a raw 512-byte record streamed over SeedLink into
 * `{net,sta,loc,cha,startTime,sampleRateHz,samples}`. Hand-rolled rather than
 * pulling in a full seismology toolkit (evaluated `seisplotjs`: ESM-only,
 * drags in Leaflet/D3/jszip for a backend that needs only this one parser).
 * Header layout + STEIM tables per the SEED Format Manual v2.4 Appendix B;
 * validated against real bytes captured live from IRIS's SeedLink service.
 */

export interface DecodedRecord {
  net: string;
  sta: string;
  loc: string;
  cha: string;
  encoding: number;
  /** Epoch ms of the first sample. */
  startTime: number;
  sampleRateHz: number;
  numSamples: number;
  samples: number[];
}

const STEIM1 = 10;
const STEIM2 = 11;

function readCStr(rec: Buffer, offset: number, len: number): string {
  return rec.subarray(offset, offset + len).toString("latin1").trim();
}

/** BTime (10 bytes): year(u16) jday(u16) hour(u8) min(u8) sec(u8) unused(u8) 0.0001s(u16). */
function readBTime(rec: Buffer, offset: number): number {
  const year = rec.readUInt16BE(offset);
  const jday = rec.readUInt16BE(offset + 2);
  const hour = rec.readUInt8(offset + 4);
  const min = rec.readUInt8(offset + 5);
  const sec = rec.readUInt8(offset + 6);
  const frac = rec.readUInt16BE(offset + 8); // units of 0.0001s
  const dayMs = Date.UTC(year, 0, 1) + (jday - 1) * 86_400_000;
  return dayMs + hour * 3_600_000 + min * 60_000 + sec * 1000 + frac / 10;
}

function calcSampleRate(fac: number, mul: number): number {
  let rate = fac > 0 ? fac : fac < 0 ? 1 / -fac : 0;
  if (mul > 0) rate *= mul;
  else if (mul < 0) rate /= -mul;
  return rate;
}

interface RecordHeader {
  net: string;
  sta: string;
  loc: string;
  cha: string;
  startTime: number;
  numSamples: number;
  sampleRateHz: number;
  numBlockettes: number;
  blocketteOffset: number;
  dataOffset: number;
}

/** Parse the 48-byte fixed header (offsets per the SEED Format Manual). */
export function parseRecordHeader(rec: Buffer): RecordHeader {
  return {
    sta: readCStr(rec, 8, 5),
    loc: readCStr(rec, 13, 2),
    cha: readCStr(rec, 15, 3),
    net: readCStr(rec, 18, 2),
    startTime: readBTime(rec, 20),
    numSamples: rec.readUInt16BE(30),
    sampleRateHz: calcSampleRate(rec.readInt16BE(32), rec.readInt16BE(34)),
    numBlockettes: rec.readUInt8(39),
    dataOffset: rec.readUInt16BE(44),
    blocketteOffset: rec.readUInt16BE(46),
  };
}

/** Find blockette 1000's encoding format byte by walking the blockette chain. */
export function findEncoding(rec: Buffer, header: RecordHeader): number | null {
  let off = header.blocketteOffset;
  for (let i = 0; i < header.numBlockettes && off > 0 && off + 8 <= rec.length; i++) {
    const type = rec.readUInt16BE(off);
    const next = rec.readUInt16BE(off + 2);
    if (type === 1000) return rec.readUInt8(off + 4);
    if (next === 0) break;
    off = next;
  }
  return null;
}

/** Sign-extend the low `bits` bits of `v` (an unsigned value already masked to `bits` width). */
function signExtend(v: number, bits: number): number {
  const shift = 32 - bits;
  return (v << shift) >> shift;
}

/**
 * Decode one STEIM1/STEIM2 frame (64 bytes: a nibble control word + 15 data
 * words) into difference values, appending to `diffs`. `isFirstFrame` special-
 * cases words 1/2 as the raw X0/Xn markers rather than nibble-dispatched data.
 */
function decodeFrame(frame: Buffer, steim2: boolean, isFirstFrame: boolean, diffs: number[]): { x0?: number; xn?: number } {
  const control = frame.readUInt32BE(0);
  const nibble = (i: number) => (control >>> (30 - 2 * i)) & 0x3;
  let x0: number | undefined;
  let xn: number | undefined;

  for (let w = 1; w < 16; w++) {
    if (isFirstFrame && w === 1) {
      x0 = frame.readInt32BE(w * 4);
      continue;
    }
    if (isFirstFrame && w === 2) {
      xn = frame.readInt32BE(w * 4);
      continue;
    }
    const n = nibble(w);
    if (n === 0) continue; // non-data (padding at end of the last frame)
    const word = frame.readUInt32BE(w * 4);

    if (!steim2) {
      // STEIM1: nibble directly selects the packing, no secondary dispatch.
      if (n === 1) for (let k = 0; k < 4; k++) diffs.push(signExtend((word >>> ((3 - k) * 8)) & 0xff, 8));
      else if (n === 2) for (let k = 0; k < 2; k++) diffs.push(signExtend((word >>> ((1 - k) * 16)) & 0xffff, 16));
      else if (n === 3) diffs.push(word | 0);
      continue;
    }

    // STEIM2
    if (n === 1) {
      for (let k = 0; k < 4; k++) diffs.push(signExtend((word >>> ((3 - k) * 8)) & 0xff, 8));
    } else if (n === 2) {
      const dnib = (word >>> 30) & 0x3;
      if (dnib === 1) diffs.push(signExtend(word & 0x3fffffff, 30));
      else if (dnib === 2) for (let k = 0; k < 2; k++) diffs.push(signExtend((word >>> ((1 - k) * 15)) & 0x7fff, 15));
      else if (dnib === 3) for (let k = 0; k < 3; k++) diffs.push(signExtend((word >>> ((2 - k) * 10)) & 0x3ff, 10));
    } else if (n === 3) {
      const dnib = (word >>> 30) & 0x3;
      if (dnib === 0) for (let k = 0; k < 5; k++) diffs.push(signExtend((word >>> ((4 - k) * 6)) & 0x3f, 6));
      else if (dnib === 1) for (let k = 0; k < 6; k++) diffs.push(signExtend((word >>> ((5 - k) * 5)) & 0x1f, 5));
      else if (dnib === 2) for (let k = 0; k < 7; k++) diffs.push(signExtend((word >>> ((6 - k) * 4)) & 0xf, 4));
      // dnib === 3 is reserved/unused.
    }
  }
  return { x0, xn };
}

/**
 * Reconstruct absolute sample values from a STEIM1/STEIM2-decoded difference
 * stream. `xn` (the encoder's own last-sample marker) is returned alongside
 * so callers/tests can verify the reconstruction landed exactly on it.
 */
export function decodeSteim(rec: Buffer, header: RecordHeader, encoding: number): { samples: number[]; xn?: number } {
  const steim2 = encoding === STEIM2;
  const frameSize = 64;
  const frameCount = Math.floor((rec.length - header.dataOffset) / frameSize);
  const diffs: number[] = [];
  let x0: number | undefined;
  let xn: number | undefined;

  for (let f = 0; f < frameCount; f++) {
    const frame = rec.subarray(header.dataOffset + f * frameSize, header.dataOffset + (f + 1) * frameSize);
    const { x0: fx0, xn: fxn } = decodeFrame(frame, steim2, f === 0, diffs);
    if (f === 0) {
      x0 = fx0;
      xn = fxn;
    }
  }

  if (x0 === undefined) return { samples: [], xn };
  // The very first extracted difference is a STEIM artifact, not a real delta:
  // it's algebraically consumed to "prime" X0 (X(-1) = X0 - diffs[0], then
  // X0 = X(-1) + diffs[0]) and must be discarded before summing the rest.
  const samples: number[] = [x0];
  for (let i = 1; i < diffs.length && samples.length < header.numSamples; i++) {
    samples.push(samples[samples.length - 1] + diffs[i]);
  }
  return { samples: samples.slice(0, header.numSamples), xn };
}

/** Parse + decompress one miniSEED data record. Throws on an unsupported encoding. */
export function decodeRecord(rec: Buffer): DecodedRecord {
  const header = parseRecordHeader(rec);
  const encoding = findEncoding(rec, header);
  if (encoding !== STEIM1 && encoding !== STEIM2) {
    throw new Error(`unsupported miniSEED encoding: ${encoding ?? "unknown"}`);
  }
  const { samples } = decodeSteim(rec, header, encoding);
  return {
    net: header.net,
    sta: header.sta,
    loc: header.loc,
    cha: header.cha,
    encoding,
    startTime: header.startTime,
    sampleRateHz: header.sampleRateHz,
    numSamples: header.numSamples,
    samples,
  };
}
