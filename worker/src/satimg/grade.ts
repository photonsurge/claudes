// satimg/grade.ts
// Turn a flat true-color satellite PNG into a see-through CLOUD overlay: derive the
// per-pixel alpha from brightness so clouds (bright) stay opaque and clear sky (dark
// ocean/land) goes transparent — the globe / weather beneath shows through instead
// of an opaque photo. The image's existing alpha (transparent space + swath gaps) is
// preserved. Runs in the worker via sharp (already a dep) so the STORED frame is the
// finished cloud layer; the client just draws it (with a live opacity on top).

import sharp from "sharp";

export interface CloudKeyOptions {
  /** Brightness (0–255) at/below which a pixel is fully transparent. */
  lo?: number;
  /** Brightness at/above which a pixel is fully opaque. */
  hi?: number;
  /** Alpha ramp shaping (>1 pushes mid clouds more transparent). */
  gamma?: number;
  /** 0–1: how much to fade COLOURED bright land (deserts) vs white cloud/snow. */
  satSuppress?: number;
  /** RGB multiplier to punch the cloud whites a touch. */
  boost?: number;
}

export const DEFAULT_CLOUD_KEY: Required<CloudKeyOptions> = {
  lo: 65,
  hi: 195,
  gamma: 1.1,
  satSuppress: 0.55,
  boost: 1.08,
};

/** Read cloud-key tuning from env (SATIMG_CK_*), falling back to the defaults. */
export function cloudKeyFromEnv(): Required<CloudKeyOptions> {
  const num = (v: string | undefined, d: number) => (v != null && v !== "" ? Number(v) : d);
  return {
    lo: num(process.env.SATIMG_CK_LO, DEFAULT_CLOUD_KEY.lo),
    hi: num(process.env.SATIMG_CK_HI, DEFAULT_CLOUD_KEY.hi),
    gamma: num(process.env.SATIMG_CK_GAMMA, DEFAULT_CLOUD_KEY.gamma),
    satSuppress: num(process.env.SATIMG_CK_SATSUPPRESS, DEFAULT_CLOUD_KEY.satSuppress),
    boost: num(process.env.SATIMG_CK_BOOST, DEFAULT_CLOUD_KEY.boost),
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Compute one pixel's keyed alpha (0–255) from its RGB + original alpha. Exposed for
 * unit testing the ramp without decoding a PNG. `a0` is the original alpha (0–255).
 */
export function keyedAlpha(r: number, g: number, b: number, a0: number, o: Required<CloudKeyOptions>): number {
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx <= 0 ? 0 : (mx - mn) / mx; // colourfulness: deserts high, cloud ~0
  let t = clamp01((L - o.lo) / (o.hi - o.lo));
  t = Math.pow(t, o.gamma) * (1 - o.satSuppress * clamp01(sat * 2));
  return clampByte((a0 / 255) * t * 255);
}

/**
 * Cloud-key a true-color PNG buffer → an RGBA PNG buffer where clear sky is
 * transparent. Pure pixel transform over sharp raw buffers.
 */
export async function cloudKey(pngIn: Buffer, opts: CloudKeyOptions = {}): Promise<Buffer> {
  const o = { ...DEFAULT_CLOUD_KEY, ...opts };
  const { data, info } = await sharp(pngIn).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a0 = data[i * 4 + 3];
    out[i * 4] = clampByte(r * o.boost);
    out[i * 4 + 1] = clampByte(g * o.boost);
    out[i * 4 + 2] = clampByte(b * o.boost);
    out[i * 4 + 3] = keyedAlpha(r, g, b, a0, o);
  }
  return sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
