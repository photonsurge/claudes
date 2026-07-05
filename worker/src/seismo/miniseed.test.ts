import { readFileSync } from "fs";
import { join } from "path";
import { decodeRecord, decodeSteim, findEncoding, parseRecordHeader } from "./miniseed";

const RECORD_LEN = 512;

/** 4 real records captured live from IRIS SeedLink (rtserve.iris.washington.edu),
 *  station IU.ANMO.BHZ — used as a ground-truth fixture since STEIM2 decoding
 *  has no useful way to fabricate a correct-by-construction test input. */
function loadFixture(): Buffer[] {
  const raw = readFileSync(join(__dirname, "__fixtures__/anmo-bhz-sample.mseed"));
  const out: Buffer[] = [];
  for (let off = 0; off + RECORD_LEN <= raw.length; off += RECORD_LEN) out.push(raw.subarray(off, off + RECORD_LEN));
  return out;
}

describe("parseRecordHeader", () => {
  it("reads station identity + timing off a real record", () => {
    const [rec] = loadFixture();
    const h = parseRecordHeader(rec);
    expect(h).toMatchObject({ net: "IU", sta: "ANMO", cha: "BHZ", sampleRateHz: 40 });
    expect(h.numSamples).toBeGreaterThan(0);
    expect(h.dataOffset).toBe(64);
  });
});

describe("findEncoding", () => {
  it("finds STEIM2 (11) via the blockette 1000 chain", () => {
    const [rec] = loadFixture();
    const h = parseRecordHeader(rec);
    expect(findEncoding(rec, h)).toBe(11);
  });
});

describe("decodeSteim", () => {
  it("reconstructs samples that land exactly on the encoder's own Xn marker", () => {
    for (const rec of loadFixture()) {
      const h = parseRecordHeader(rec);
      const encoding = findEncoding(rec, h);
      const { samples, xn } = decodeSteim(rec, h, encoding!);
      expect(samples).toHaveLength(h.numSamples);
      // Xn is the encoder's own copy of the final sample value — an exact
      // match is the real correctness proof for STEIM difference-decoding,
      // not just "some numbers came out".
      expect(samples[samples.length - 1]).toBe(xn);
    }
  });
});

describe("decodeRecord", () => {
  it("decodes all 4 captured records to plausible ground-motion counts", () => {
    for (const rec of loadFixture()) {
      const d = decodeRecord(rec);
      expect(d).toMatchObject({ net: "IU", sta: "ANMO", cha: "BHZ", encoding: 11, sampleRateHz: 40 });
      expect(d.samples).toHaveLength(d.numSamples);
      // Real broadband ground-motion counts are nowhere near saturating int32.
      for (const v of d.samples) expect(Math.abs(v)).toBeLessThan(1e8);
    }
  });

  it("throws on an unsupported encoding", () => {
    const [rec] = loadFixture();
    const mutated = Buffer.from(rec);
    mutated.writeUInt8(0, 48 + 4); // blockette 1000's encoding byte -> 0 (unknown)
    expect(() => decodeRecord(mutated)).toThrow(/unsupported/);
  });
});
