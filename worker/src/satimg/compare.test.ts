import sharp from "sharp";
import { sideBySide } from "./compare";

const solid = (w: number, h: number, color: { r: number; g: number; b: number }): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

describe("sideBySide", () => {
  it("stitches two images at a common height with a gap", async () => {
    const left = await solid(20, 10, { r: 255, g: 0, b: 0 });
    const right = await solid(30, 20, { r: 0, g: 0, b: 255 });
    const { png, width, height } = await sideBySide(left, right, { gap: 4 });
    expect(height).toBe(20); // common (max) height
    // left 20×10 scaled to height 20 → width 40; right stays 30; + gap 4 = 74.
    expect(width).toBe(40 + 4 + 30);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(width);
    expect(meta.height).toBe(height);
    expect(meta.format).toBe("png");
  });

  it("renders captions without throwing", async () => {
    const a = await solid(12, 12, { r: 1, g: 2, b: 3 });
    const b = await solid(12, 12, { r: 4, g: 5, b: 6 });
    const { png } = await sideBySide(a, b, { captions: ["00:00 UTC", "03:00 UTC"] });
    expect((await sharp(png).metadata()).format).toBe("png");
  });
});
