// WORKER-ONLY volcano-camera frame helpers (sharp). The capture job archives one
// still per camera per hour so a volcano's cameras become a browsable history —
// "what did it look like earlier today / this week" — and stitches them into a
// short timelapse. All sharp lives in the worker; public just <img>s the bytes.

import sharp from "sharp";

export interface FrameLuma {
  /** Mean brightness across RGB, 0-255. */
  mean: number;
  /** Brightest channel value anywhere in the frame, 0-255. */
  max: number;
}

/** Mean + peak luminance of a PNG. Used to tell day / uniform-night-dark / glow apart. */
export async function frameLuma(png: Buffer): Promise<FrameLuma> {
  const { channels } = await sharp(png).stats();
  const rgb = channels.slice(0, 3);
  if (!rgb.length) return { mean: 0, max: 0 };
  const mean = rgb.reduce((s, c) => s + c.mean, 0) / rgb.length;
  const max = Math.max(...rgb.map((c) => c.max));
  return { mean, max };
}

export interface DarkFrameOpts {
  /** Below this MEAN brightness the scene is "night". */
  nightMean: number;
  /** A bright region at or above this MAX is incandescence/glow — keep it. */
  glowMax: number;
}

/**
 * True when a frame is a uniform dark night still with nothing to see: low mean
 * brightness AND no bright region. This is the "do we need night ones?" call — a
 * night frame that carries volcanic incandescence has a bright region (high max)
 * and returns FALSE (KEEP it, the money shot); a flat black night sky returns
 * TRUE (skip, so we don't hoard identical darkness). Pure — no I/O.
 */
export function isDarkFrame(luma: FrameLuma, opts: DarkFrameOpts): boolean {
  return luma.mean < opts.nightMean && luma.max < opts.glowMax;
}

/**
 * Evenly sample at most `max` items from `arr`, always keeping the first and last
 * (so a timelapse spans the whole window even when thinned). Pure. `max <= 0` or
 * `arr.length <= max` returns the array unchanged.
 */
export function pickEvenly<T>(arr: T[], max: number): T[] {
  if (max <= 0 || arr.length <= max) return arr.slice();
  if (max === 1) return [arr[arr.length - 1]];
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

export interface ThinFrame {
  id: string;
  camId?: string;
  capturedAt: string;
  meanLuma?: number;
  kind?: string;
}

export interface ThinOpts {
  /** Frames captured at/after this epoch-ms are kept full-resolution (recent). */
  fullResUntilMs: number;
  /** Mean brightness below which a frame counts as a night frame. */
  nightMean: number;
}

/**
 * Retention thinning plan: which OLD camera frames to delete so each camera keeps,
 * per UTC day, one DAY representative (brightest) AND one NIGHT representative
 * (brightest night frame — the one most likely to show incandescence). Recent
 * frames (>= fullResUntilMs) are untouched; `render` timelapses are never thinned.
 * Returns the ids to delete. Pure — no I/O.
 */
export function planCamThinning(frames: ThinFrame[], opts: ThinOpts): string[] {
  const groups = new Map<string, ThinFrame[]>();
  for (const f of frames) {
    if (f.kind && f.kind !== "camera") continue; // leave timelapses/other kinds alone
    if (+new Date(f.capturedAt) >= opts.fullResUntilMs) continue; // recent → full-res
    const day = f.capturedAt.slice(0, 10); // YYYY-MM-DD (UTC)
    const key = `${f.camId ?? ""}:${day}`;
    const arr = groups.get(key);
    if (arr) arr.push(f);
    else groups.set(key, [f]);
  }
  const del: string[] = [];
  const brightest = (a: ThinFrame, b: ThinFrame) => ((b.meanLuma ?? 0) > (a.meanLuma ?? 0) ? b : a);
  for (const grp of groups.values()) {
    if (grp.length <= 1) continue;
    const keep = new Set<string>();
    const night = grp.filter((f) => (f.meanLuma ?? 255) < opts.nightMean);
    const dayF = grp.filter((f) => (f.meanLuma ?? 255) >= opts.nightMean);
    if (dayF.length) keep.add(dayF.reduce(brightest).id);
    if (night.length) keep.add(night.reduce(brightest).id);
    for (const f of grp) if (!keep.has(f.id)) del.push(f.id);
  }
  return del;
}

export interface TimelapseOpts {
  width?: number;
  height?: number;
  /** Per-frame delay in ms. */
  delayMs?: number;
}

/**
 * Stitch chronological PNG frames into a single animated WebP (worker sharp). Each
 * frame is cover-resized to a common canvas first (`join` needs equal dimensions),
 * then folded into one looping animation. The result is stored as a `render`
 * EventSnapshot and served by the existing /api/events/snapshot route — no new
 * model, no new media plumbing.
 */
export async function buildTimelapseWebp(
  pngs: Buffer[],
  opts: TimelapseOpts = {},
): Promise<{ webp: Buffer; width: number; height: number; frames: number }> {
  const width = opts.width ?? 480;
  const height = opts.height ?? 270;
  const delayMs = opts.delayMs ?? 140;
  if (pngs.length < 2) throw new Error("timelapse needs at least 2 frames");
  const norm = await Promise.all(
    pngs.map((p) => sharp(p).resize(width, height, { fit: "cover" }).png().toBuffer()),
  );
  const webp = await sharp(norm, { join: { animated: true } })
    .webp({ quality: 70, loop: 0, delay: norm.map(() => delayMs) })
    .toBuffer();
  return { webp, width, height, frames: norm.length };
}
