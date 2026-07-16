import { deflateRawSync } from "node:zlib";
import { unzipFirstEntry } from "./unzip";

/** Assemble a minimal single-entry ZIP (name + payload) with the given method. */
function makeZip(name: string, payload: Buffer, method: 0 | 8): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const body = method === 8 ? deflateRawSync(payload) : payload;

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(method, 8);
  lfh.writeUInt32LE(body.length, 18); // compressed size
  lfh.writeUInt32LE(payload.length, 22); // uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26);
  const lfhBlock = Buffer.concat([lfh, nameBuf, body]);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(method, 10);
  cdh.writeUInt32LE(body.length, 20);
  cdh.writeUInt32LE(payload.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt32LE(0, 42); // local header offset
  const cdhBlock = Buffer.concat([cdh, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); // entries on disk
  eocd.writeUInt16LE(1, 10); // entries total
  eocd.writeUInt32LE(cdhBlock.length, 12); // cd size
  eocd.writeUInt32LE(lfhBlock.length, 16); // cd offset

  return Buffer.concat([lfhBlock, cdhBlock, eocd]);
}

describe("unzipFirstEntry", () => {
  const payload = Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [1, 2, 3] }));

  it("inflates a deflated entry back to the original bytes", () => {
    expect(unzipFirstEntry(makeZip("gadm.json", payload, 8))).toEqual(payload);
  });

  it("returns a stored (uncompressed) entry verbatim", () => {
    expect(unzipFirstEntry(makeZip("gadm.json", payload, 0))).toEqual(payload);
  });

  it("survives an archive comment after the EOCD", () => {
    const z = makeZip("gadm.json", payload, 8);
    // A non-zero comment length + trailing bytes still has to be found by the scan.
    z.writeUInt16LE(3, z.length - 2);
    const withComment = Buffer.concat([z, Buffer.from("end")]);
    expect(unzipFirstEntry(withComment)).toEqual(payload);
  });

  it("throws on bytes that are not a zip", () => {
    expect(() => unzipFirstEntry(Buffer.from("<html>404</html>"))).toThrow(/not a zip/);
  });
});
