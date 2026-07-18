import sharp from "sharp";
import { assertDecodable } from "./basemap";
import { BASEMAP_TEXTURES } from "@photonsurge/shared/basemaps";

/**
 * A genuinely-decodable JPEG well over the 50KB floor. High-entropy pixels
 * (deterministic pseudo-noise — no Math.random) so it compresses LARGE, matching
 * a real texture; a solid colour would compress to a couple of KB and never clear
 * the floor. Truncating this reproduces the "premature end of JPEG image" bug.
 */
async function bigJpeg(): Promise<Buffer> {
  const W = 1024;
  const H = 1024;
  const px = Buffer.alloc(W * H * 3);
  // xorshift32 (deterministic — no Math.random) → high-entropy pixels that resist
  // JPEG compression, so the encoded buffer is comfortably > 100KB.
  let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i < px.length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    px[i] = s & 0xff;
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe("assertDecodable", () => {
  it("accepts a fully-decodable image and returns its dimensions", async () => {
    const jpeg = await bigJpeg();
    expect(jpeg.length).toBeGreaterThan(50 * 1024); // clears the floor on its own
    const { width, height } = await assertDecodable(jpeg, "satellite");
    expect(width).toBe(1024);
    expect(height).toBe(1024);
  });

  it("rejects a truncated JPEG — the corrupt-satellite.jpg bug", async () => {
    const jpeg = await bigJpeg();
    // Chop off the tail (EOI marker + trailing scan data) → "premature end of JPEG".
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length * 0.6));
    expect(truncated.length).toBeGreaterThan(50 * 1024); // so it's the DECODE that fails
    await expect(assertDecodable(Buffer.from(truncated), "satellite")).rejects.toThrow();
  });

  it("rejects a tiny error/empty body before trying to decode", async () => {
    const html = Buffer.from("<html><body>403 Forbidden</body></html>");
    await expect(assertDecodable(html, "terrain")).rejects.toThrow(/bytes/);
  });

  it("rejects non-image bytes that clear the size floor", async () => {
    const junk = Buffer.alloc(60 * 1024, 0x41); // 60KB of 'A' — big enough, not an image
    await expect(assertDecodable(junk, "night")).rejects.toThrow();
  });
});

describe("BASEMAP_TEXTURES registry", () => {
  it("has the three raster base images with unique ids and keyless https URLs", () => {
    const ids = BASEMAP_TEXTURES.map((t) => t.id);
    expect(ids).toEqual(["satellite", "terrain", "night"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BASEMAP_TEXTURES) {
      expect(t.url).toMatch(/^https:\/\//);
      expect(t.fallback).toBe(`/data/${t.id}.jpg`);
      expect(t.contentType).toBe("image/jpeg");
    }
  });
});
