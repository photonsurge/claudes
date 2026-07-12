// satimg/compare.ts
// Reusable, WORKER-ONLY sharp compositor: stitch two PNGs side by side (e.g. two
// satellite snapshots of the same area at different times). All sharp lives on
// the worker — public only ever streams the finished bytes via the media route.
// Feature-agnostic like frame.ts, so volcanoes/events can reuse it.

import sharp from "sharp";

export interface SideBySideOptions {
  /** Gap between the two panes, px (default 8). */
  gap?: number;
  /** Canvas background (default opaque black). */
  bg?: { r: number; g: number; b: number; alpha: number };
  /** Optional bottom captions, one per pane (e.g. observation times). */
  captions?: [string, string];
}

export interface SideBySideResult {
  png: Buffer;
  width: number;
  height: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function captionSvg(width: number, height: number, leftW: number, gap: number, captions: [string, string]): Buffer {
  const y = height - 12;
  const t = (x: number, s: string) =>
    `<text x="${x}" y="${y}" font-family="sans-serif" font-size="18" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="0.6" paint-order="stroke">${esc(s)}</text>`;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${t(12, captions[0])}${t(leftW + gap + 12, captions[1])}</svg>`;
  return Buffer.from(svg);
}

/**
 * Composite `left` | `right` onto one canvas: both resized to a common height
 * (keeping aspect), separated by `gap`, with optional per-pane captions. Returns
 * a PNG buffer. Throws if either image's dimensions can't be read.
 */
export async function sideBySide(
  left: Buffer,
  right: Buffer,
  opts: SideBySideOptions = {},
): Promise<SideBySideResult> {
  const gap = opts.gap ?? 8;
  const bg = opts.bg ?? { r: 0, g: 0, b: 0, alpha: 1 };
  const [lMeta, rMeta] = await Promise.all([sharp(left).metadata(), sharp(right).metadata()]);
  const height = Math.max(lMeta.height ?? 0, rMeta.height ?? 0);
  if (!height) throw new Error("sideBySide: could not read image dimensions");

  const [lImg, rImg] = await Promise.all([
    sharp(left).resize({ height }).png().toBuffer({ resolveWithObject: true }),
    sharp(right).resize({ height }).png().toBuffer({ resolveWithObject: true }),
  ]);
  const leftW = lImg.info.width;
  const rightW = rImg.info.width;
  const width = leftW + gap + rightW;

  const layers: sharp.OverlayOptions[] = [
    { input: lImg.data, left: 0, top: 0 },
    { input: rImg.data, left: leftW + gap, top: 0 },
  ];
  if (opts.captions) layers.push({ input: captionSvg(width, height, leftW, gap, opts.captions), left: 0, top: 0 });

  const png = await sharp({ create: { width, height, channels: 4, background: bg } })
    .composite(layers)
    .png()
    .toBuffer();
  return { png, width, height };
}
