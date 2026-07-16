import { inflateRawSync } from "node:zlib";

/**
 * Extract the first file from a ZIP archive, with no dependency and no shelling out.
 *
 * GADM publishes its boundaries as a single-entry `.json.zip`; the worker has no
 * zip library and can't assume `unzip` on the host, so this reads just enough of
 * the format to pull that one entry: find the End Of Central Directory record,
 * follow it to the first central-directory header, jump to that entry's local
 * header, and inflate the compressed bytes. Handles the two methods a real zip uses
 * — stored (0) and deflate (8). Not a general zip library; it does exactly what the
 * GADM import needs and throws on anything it doesn't recognise.
 */

const SIG_EOCD = 0x06054b50; // End Of Central Directory
const SIG_CDH = 0x02014b50; // Central Directory Header
const SIG_LFH = 0x04034b50; // Local File Header

export function unzipFirstEntry(buf: Buffer): Buffer {
  // The EOCD sits at the end, after an optional comment — scan backwards for it.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("unzip: no End Of Central Directory record (not a zip?)");

  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== SIG_CDH) throw new Error("unzip: central directory not where EOCD points");

  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const extraLen = buf.readUInt16LE(cdOffset + 30);
  const commentLen = buf.readUInt16LE(cdOffset + 32);
  const lfhOffset = buf.readUInt32LE(cdOffset + 42);
  void nameLen;
  void extraLen;
  void commentLen;

  if (buf.readUInt32LE(lfhOffset) !== SIG_LFH) throw new Error("unzip: local file header not where the central directory points");

  // The local header carries its OWN name/extra lengths (they can differ from the
  // central directory's) — the data starts right after them.
  const lNameLen = buf.readUInt16LE(lfhOffset + 26);
  const lExtraLen = buf.readUInt16LE(lfhOffset + 28);
  const dataStart = lfhOffset + 30 + lNameLen + lExtraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);

  if (method === 0) return Buffer.from(data); // stored, no compression
  if (method === 8) return inflateRawSync(data); // deflate
  throw new Error(`unzip: unsupported compression method ${method}`);
}
