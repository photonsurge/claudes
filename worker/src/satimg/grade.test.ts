import sharp from "sharp";
import { keyedAlpha, cloudKey, DEFAULT_CLOUD_KEY } from "./grade";

const K = DEFAULT_CLOUD_KEY;

describe("keyedAlpha", () => {
  it("makes bright cloud (white) fully opaque", () => {
    expect(keyedAlpha(255, 255, 255, 255, K)).toBe(255);
  });

  it("makes dark clear sky (deep ocean) transparent", () => {
    expect(keyedAlpha(20, 30, 50, 255, K)).toBe(0);
  });

  it("keeps space (original alpha 0) transparent regardless of colour", () => {
    expect(keyedAlpha(255, 255, 255, 0, K)).toBe(0);
  });

  it("suppresses coloured bright LAND (desert) below white cloud of equal brightness", () => {
    // A tan desert pixel and a neutral pixel chosen at ~equal luminance; the coloured
    // one must key LESS opaque so the layer reads as cloud, not terrain.
    const desert = keyedAlpha(200, 170, 120, 255, K); // saturated
    const grey = keyedAlpha(173, 173, 173, 255, K); // ~same L, neutral
    expect(desert).toBeLessThan(grey);
    expect(grey).toBeGreaterThan(0);
  });
});

describe("cloudKey", () => {
  it("keys a 2-pixel image: bright→opaque, dark→transparent, preserves size", async () => {
    // [white opaque, black opaque]
    const raw = Buffer.from([255, 255, 255, 255, 0, 0, 0, 255]);
    const pngIn = await sharp(raw, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();

    const out = await cloudKey(pngIn);
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2);
    expect(info.height).toBe(1);
    expect(data[3]).toBe(255); // white pixel alpha
    expect(data[7]).toBe(0); // black pixel alpha
  });
});
