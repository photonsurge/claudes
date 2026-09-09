/**
 * Sprite atlas for the label canvas. Every label sprite (name, detail chip,
 * combined name + detail, icon glyph) used to be its own small <canvas> —
 * ~4 000 of them live at once — and each per-frame `drawImage` from a different
 * source is a separate texture bind for the accelerated 2D canvas, so nothing
 * batched across the ~140 blits a frame (`drawImage` was the label canvas's
 * largest cost, 0.65 ms/frame — docs/watch-perf-plan.md, round 22). Packed
 * into a few 2048² pages, a frame's blits come from one or two sources and
 * Skia merges them into a couple of draws.
 *
 * Pixel-identical to the per-sprite canvases: each sprite is painted into an
 * integer device-pixel region with a transparent one-pixel gutter (bilinear
 * sampling at an edge never reads a neighbour) and blitted with the same
 * integer source rect and CSS-pixel destination size as before.
 *
 * Pages fill shelf by shelf and are never compacted; past the page limit the
 * OLDEST page is retired whole (`alive = false`) and its sprites re-rasterise
 * on demand — what the old FIFO sprite cap did one sprite at a time. A retired
 * page keeps its pixels until nothing references it, so a sprite baked from
 * it a moment ago still reads correctly.
 */
export interface AtlasPage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  alive: boolean;
  shelves: Shelf[];
  nextY: number;
}
interface Shelf {
  y: number;
  h: number;
  /** Next free x. */
  x: number;
}
export interface AtlasRegion {
  page: AtlasPage;
  /** Device-pixel source rect (inside the gutter). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const GUTTER = 1;

function defaultPage(size: number): AtlasPage | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx, alive: true, shelves: [], nextY: 0 };
}

export class SpriteAtlas {
  private pages: AtlasPage[] = [];

  constructor(
    private readonly size = 2048,
    private readonly maxPages = 3,
    private readonly makePage: (size: number) => AtlasPage | null = defaultPage,
  ) {}

  get pageCount(): number {
    return this.pages.length;
  }

  /** Reserve a `bw`×`bh` device-pixel region; null when no page can be made (no 2D context) or it can't fit. */
  alloc(bw: number, bh: number): AtlasRegion | null {
    const w = bw + GUTTER * 2;
    const h = bh + GUTTER * 2;
    if (w > this.size || h > this.size) return null;
    for (const page of this.pages) {
      const r = this.fit(page, w, h, bw, bh);
      if (r) return r;
    }
    const page = this.makePage(this.size);
    if (!page) return null;
    this.pages.push(page);
    if (this.pages.length > this.maxPages) {
      const old = this.pages.shift()!;
      old.alive = false;
    }
    return this.fit(page, w, h, bw, bh);
  }

  private fit(page: AtlasPage, w: number, h: number, bw: number, bh: number): AtlasRegion | null {
    // A shelf of (about) this height with room to the right …
    for (const s of page.shelves) {
      if (s.h >= h && s.h <= h * 1.5 && s.x + w <= this.size) {
        const r = { page, sx: s.x + GUTTER, sy: s.y + GUTTER, sw: bw, sh: bh };
        s.x += w;
        return r;
      }
    }
    // … or a new shelf below the last.
    if (page.nextY + h <= this.size) {
      const s: Shelf = { y: page.nextY, h, x: w };
      page.shelves.push(s);
      page.nextY += h;
      return { page, sx: GUTTER, sy: s.y + GUTTER, sw: bw, sh: bh };
    }
    return null;
  }
}
