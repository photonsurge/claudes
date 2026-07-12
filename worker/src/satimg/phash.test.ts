import sharp from "sharp";
import { pHash, hamming } from "./phash";

/** A horizontal greyscale ramp PNG (optionally reversed) — a strong dHash signal. */
async function gradientPng(reversed = false): Promise<Buffer> {
  const w = 16;
  const h = 8;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(((reversed ? w - 1 - x : x) / (w - 1)) * 255);
      const o = (y * w + x) * 3;
      raw[o] = raw[o + 1] = raw[o + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("pHash / hamming", () => {
  it("produces a 16-hex-char hash", async () => {
    const h = await pHash(await gradientPng());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same image (distance 0)", async () => {
    const g = await gradientPng();
    expect(hamming(await pHash(g), await pHash(g))).toBe(0);
  });

  it("differs sharply for a reversed gradient", async () => {
    const d = hamming(await pHash(await gradientPng(false)), await pHash(await gradientPng(true)));
    expect(d).toBeGreaterThan(10);
  });

  it("hamming handles mismatched lengths defensively", () => {
    expect(hamming("ff", "ffff")).toBeGreaterThan(0);
  });
});
