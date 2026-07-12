// satimg/phash.ts
// WORKER-ONLY perceptual hashing (sharp). A 64-bit difference hash (dHash): the
// image is squashed to 9×8 greyscale and each pixel compared to its right
// neighbour, giving a gradient fingerprint that's stable under scaling / mild
// re-encoding. Used to skip storing a near-identical camera still hour after hour.

import sharp from "sharp";

/** 64-bit dHash of a PNG, as 16 hex chars. */
export async function pHash(png: Buffer): Promise<string> {
  // 9×8 greyscale → 8 horizontal comparisons per row × 8 rows = 64 bits.
  const { data } = await sharp(png)
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 9 + col;
      bits += data[i] < data[i + 1] ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Hamming distance (differing bits) between two equal-length hex hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
