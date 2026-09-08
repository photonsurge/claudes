"use client";

/**
 * Name labels for the live-track + city overlays, drawn on ONE 2D canvas laid
 * over the WebGL globe. deck's TextLayer renders blank under the _GlobeView
 * build (its GPU font atlases come back empty — see the icon/text-atlas note),
 * and the earlier DOM version — one absolutely-positioned div per label with
 * `will-change: transform` — cost the /watch main thread a compositor layer per
 * label (~1.5 k when zoomed into a region), a style recalc over all of them
 * every frame, and a React re-diff of every div each time the track list
 * ticked. Being part of the page, the canvas is captured by OBS / the YouTube
 * output exactly like the DOM was.
 *
 * Per frame this writes NOTHING to the DOM. Each distinct label (name + colour,
 * detail chip, icon) is rasterised once into a small sprite and `drawImage`d
 * every frame after that: canvas `fillText`/`strokeText` have to resolve the
 * font through the style engine (a forced style recalc when anything is dirty)
 * and stroking glyph outlines for a halo is the expensive way to draw text.
 * Icon labels (station/volcano/monitor pins) keep their React icon glyphs: the
 * elements are rendered into a `display:none` holder, serialised to an SVG
 * image once per variant (CSS custom properties resolved), and drawn as
 * sprites too — the previous DOM pins wrote ~26 inline styles a frame during a
 * spin, which forced one of the two style recalcs every frame paid for.
 *
 * Per-frame, from the LIVE viewport (not React state, which doesn't rebuild on
 * zoom): far-side culling (deck's project() happily returns screen coords for
 * points occluded by the globe, so we cull with a near-hemisphere dot-product
 * test), progressive reveal by `minZoom` / `detailMinZoom`, and collision
 * decluttering in priority order.
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";

export interface OverlayLabel {
  id: string;
  text: string;
  /** Small glyph rendered before the text (e.g. a station-type icon). Purely
   *  decorative — not counted by `labelWidth()`'s collision estimate. */
  icon?: ReactNode;
  /** Dim secondary line (e.g. "United Kingdom · 9.0M"), shown when zoomed in. */
  detail?: string;
  /** [lng, lat, altM] — same position the marker/dot uses, so they line up. */
  position: [number, number, number];
  color: [number, number, number];
  /** Hide the whole label below this zoom (progressive reveal). Default 0. */
  minZoom?: number;
  /** Hide just the detail line below this zoom. Default = always show detail. */
  detailMinZoom?: number;
}

// deck's viewport type is awkward to import; we only need project()/width/height/zoom.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Viewport = any;

/** Unit vector on the sphere for a lng/lat (degrees). */
function unit(lng: number, lat: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
}

/** Per-label unit vectors, computed once per label object (labels are
 *  rebuilt about once a second; positions are static for cities). */
const unitCache = new WeakMap<OverlayLabel, [number, number, number]>();
function unitOf(l: OverlayLabel): [number, number, number] {
  let u = unitCache.get(l);
  if (!u) {
    u = unit(l.position[0], l.position[1]);
    unitCache.set(l, u);
  }
  return u;
}

// ── Collision avoidance ───────────────────────────────────────────────────
// A dense conurbation (Barcelona's satellite towns, Madrid's suburbs …) can
// reveal a dozen same-tier labels within a few dozen pixels of each other.
// Each frame, labels are placed in priority order (biggest/capital first —
// `minZoom` is already that ranking) into a coarse screen-space grid; a label
// whose estimated box collides with an already-placed one is hidden (its dot,
// drawn by the separate deck.gl scatter layer, stays visible either way — only
// the crowded TEXT thins out, same as any decluttered map).
const LABEL_H = 15;
const CHAR_W = 6.3;
const GRID_CELL = 48;

/** Rough on-screen text width, so collision testing never needs a DOM read. */
export function labelWidth(text: string): number {
  return Math.min(240, 18 + text.length * CHAR_W);
}

export class LabelGrid {
  private cells = new Map<string, Array<[number, number, number, number]>>();

  clear() {
    this.cells.clear();
  }

  private forCells(x0: number, y0: number, x1: number, y1: number, fn: (key: string) => void) {
    const cx0 = Math.floor(x0 / GRID_CELL);
    const cx1 = Math.floor(x1 / GRID_CELL);
    const cy0 = Math.floor(y0 / GRID_CELL);
    const cy1 = Math.floor(y1 / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) fn(`${cx},${cy}`);
    }
  }

  /** True if the box overlaps anything already placed. */
  collides(x0: number, y0: number, x1: number, y1: number): boolean {
    let hit = false;
    this.forCells(x0, y0, x1, y1, (key) => {
      if (hit) return;
      const rects = this.cells.get(key);
      if (!rects) return;
      for (const [rx0, ry0, rx1, ry1] of rects) {
        if (x0 < rx1 && x1 > rx0 && y0 < ry1 && y1 > ry0) {
          hit = true;
          break;
        }
      }
    });
    return hit;
  }

  place(x0: number, y0: number, x1: number, y1: number) {
    this.forCells(x0, y0, x1, y1, (key) => {
      let rects = this.cells.get(key);
      if (!rects) {
        rects = [];
        this.cells.set(key, rects);
      }
      rects.push([x0, y0, x1, y1]);
    });
  }
}

// ── Sprites ───────────────────────────────────────────────────────────────
/** Matches the old DOM styling: 12px/600 name, 10px/500 detail chip. */
const NAME_FONT = "600 12px system-ui, sans-serif";
const DETAIL_FONT = "500 10px system-ui, sans-serif";
/** Text starts right of the marker dot, like the DOM's paddingLeft. */
const TEXT_DX = 9;
/** Gap between an icon glyph and its text (the DOM flex `gap`). */
const ICON_GAP = 3;
/** Dark halo standing in for the DOM's stacked text-shadows. */
const HALO = "rgba(0,0,0,0.85)";
const DETAIL_BG = "rgba(2,8,18,0.62)";
const DETAIL_FG = "rgba(226,232,240,0.92)";
const DETAIL_H = 14;
const DETAIL_PAD = 6;
/** Name sprite box: tall enough for the 12px face plus a 3px halo. */
const NAME_H = 20;
const NAME_PAD = 4;
/** Backing-store cap: 2× is crisp on any broadcast canvas; more is wasted fill. */
const MAX_DPR = 2;
/** Sprite cache bound — FIFO eviction; cities ≈ 2.3 k, track names churn. */
const SPRITE_CAP = 4000;

interface Sprite {
  img: HTMLCanvasElement;
  /** CSS-px size. */
  w: number;
  h: number;
}

const sprites = new Map<string, Sprite>();
let measureCtx: CanvasRenderingContext2D | null = null;

function makeSprite(
  key: string,
  dpr: number,
  w: number,
  h: number,
  paint: (g: CanvasRenderingContext2D) => void,
): Sprite | null {
  const hit = sprites.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * dpr));
  c.height = Math.max(1, Math.ceil(h * dpr));
  const g = c.getContext("2d");
  if (!g) return null;
  g.scale(dpr, dpr);
  paint(g);
  const s = { img: c, w, h };
  if (sprites.size >= SPRITE_CAP) {
    const oldest = sprites.keys().next().value;
    if (oldest !== undefined) sprites.delete(oldest);
  }
  sprites.set(key, s);
  return s;
}

function textWidth(font: string, text: string): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return labelWidth(text);
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function nameSprite(text: string, color: string, dpr: number): Sprite | null {
  const key = `n|${dpr}|${color}|${text}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const w = Math.ceil(textWidth(NAME_FONT, text)) + NAME_PAD * 2;
  return makeSprite(key, dpr, w, NAME_H, (g) => {
    g.font = NAME_FONT;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = HALO;
    g.strokeText(text, NAME_PAD, NAME_H / 2);
    g.fillStyle = color;
    g.fillText(text, NAME_PAD, NAME_H / 2);
  });
}

function detailSprite(text: string, dpr: number): Sprite | null {
  const key = `d|${dpr}|${text}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const w = Math.ceil(textWidth(DETAIL_FONT, text)) + DETAIL_PAD * 2;
  return makeSprite(key, dpr, w, DETAIL_H, (g) => {
    // Backing chip: the detail line ("Country · 1.5M · capital") is small and
    // sits straight on the basemap — a halo alone isn't enough over light
    // terrain, especially after stream compression.
    g.fillStyle = DETAIL_BG;
    if (typeof g.roundRect === "function") {
      g.beginPath();
      g.roundRect(0, 0, w, DETAIL_H, 4);
      g.fill();
    } else {
      g.fillRect(0, 0, w, DETAIL_H);
    }
    g.font = DETAIL_FONT;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = DETAIL_FG;
    g.fillText(text, DETAIL_PAD, DETAIL_H / 2);
  });
}

/** An icon glyph rasterised from its React-rendered <svg>. */
interface IconSprite {
  img: HTMLImageElement;
  ready: boolean;
  w: number;
  h: number;
}
const iconSprites = new Map<string, IconSprite>();
const serializer = typeof XMLSerializer === "function" ? new XMLSerializer() : null;

/**
 * SVG markup → image sprite, once per distinct markup. `var(--x, fallback)`
 * references (the icons take their ink from the scene's --gods-* custom
 * properties) are resolved against `vars` first: a data: image has no access
 * to the page's custom properties and would fall back to the defaults.
 */
function iconSprite(svg: Element, vars: (name: string, fallback: string) => string): IconSprite | null {
  if (!serializer) return null;
  const html = serializer
    .serializeToString(svg)
    .replace(/var\((--[\w-]+)\s*,\s*([^)]+)\)/g, (_, name: string, fallback: string) => vars(name, fallback.trim()));
  let s = iconSprites.get(html);
  if (s) return s;
  const img = new Image();
  const entry: IconSprite = { img, ready: false, w: 0, h: 0 };
  img.onload = () => {
    entry.ready = true;
    entry.w = img.naturalWidth || 12;
    entry.h = img.naturalHeight || 12;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(html)}`;
  iconSprites.set(html, entry);
  s = entry;
  return s;
}

export default function GlobeLabels({
  getViewport,
  getCamera,
  labels,
}: {
  /** The live deck viewport (has project()/width/height/zoom), or null if not ready. */
  getViewport: () => Viewport | null;
  /** The sub-camera point, for the near-hemisphere visibility test. */
  getCamera: () => { longitude: number; latitude: number };
  labels: OverlayLabel[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Hidden holders for the React icon glyphs, by label id — the sprite source.
  const iconHolders = useRef<Map<string, HTMLDivElement>>(new Map());
  // Per-label icon sprite, valid for one `labels` generation (an icon's
  // active/colour props can change with the labels, so it's re-serialised —
  // cheaply, and de-duplicated by markup — whenever they do).
  const iconByLabel = useRef<Map<string, { gen: number; sprite: IconSprite | null }>>(new Map());
  const genRef = useRef(0);
  const computedRef = useRef<CSSStyleDeclaration | null>(null);
  // Biggest/capital first (lowest minZoom) so a crowded conurbation always
  // keeps its most important label and thins out the smaller neighbours.
  const priorityLabels = useMemo(
    () => [...labels].sort((a, b) => (a.minZoom ?? 0) - (b.minZoom ?? 0)),
    [labels],
  );
  const priorityRef = useRef<OverlayLabel[]>(priorityLabels);
  priorityRef.current = priorityLabels;
  const iconLabels = useMemo(() => labels.filter((l) => l.icon), [labels]);
  const gridRef = useRef<LabelGrid>(new LabelGrid());

  // New labels → new generation (icons re-serialised on next use) and a fresh
  // look at the scene's custom properties. Runs after React committed the
  // holders, so the DOM icons already carry the new props.
  useEffect(() => {
    genRef.current += 1;
    if (hostRef.current && typeof getComputedStyle === "function") {
      computedRef.current = getComputedStyle(hostRef.current);
    }
  }, [labels]);

  // Project + draw every frame (camera may be spinning/zooming without new data).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // deck.gl can throw an internal assertion from getViewport()/project()
      // mid-transition (e.g. between view changes) — an uncaught throw here
      // would skip the reschedule below and permanently freeze every label
      // for the rest of the session, so guard per frame instead.
      try {
        tick();
      } catch {
        /* transient — try again next frame */
      }
      raf = requestAnimationFrame(loop);
    };
    const resolveVar = (name: string, fallback: string): string => {
      const v = computedRef.current?.getPropertyValue(name).trim();
      return v || fallback;
    };
    const iconFor = (l: OverlayLabel): IconSprite | null => {
      const gen = genRef.current;
      const cached = iconByLabel.current.get(l.id);
      if (cached && cached.gen === gen) return cached.sprite;
      const svg = iconHolders.current.get(l.id)?.firstElementChild ?? null;
      const sprite = svg ? iconSprite(svg, resolveVar) : null;
      iconByLabel.current.set(l.id, { gen, sprite });
      return sprite;
    };
    const tick = () => {
      const vp = getViewport();
      const canvas = canvasRef.current;
      if (!vp || !canvas) return;
      const w: number = vp.width;
      const h: number = vp.height;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cam = getCamera();
      const [cx, cy, cz] = unit(cam.longitude, cam.latitude);
      const zoom: number = vp.zoom ?? 0;
      const grid = gridRef.current;
      grid.clear();
      for (const l of priorityRef.current) {
        // Progressive reveal: below the label's minZoom it's not shown at all.
        if (zoom < (l.minZoom ?? 0)) continue;
        const [ux, uy, uz] = unitOf(l);
        // Dot < 0 → the point is on the hidden hemisphere; small margin so
        // labels don't flicker right at the limb.
        if (ux * cx + uy * cy + uz * cz <= 0.04) continue;
        const p = vp.project(l.position);
        const x: number = p[0];
        const y: number = p[1];
        if (x < -160 || y < -50 || x > w + 160 || y > h + 50) continue;
        // Decluttering: skip (hide) this label if a higher-priority one
        // already claimed overlapping screen space this frame. Box is
        // anchored the same way the text is laid out — right of the point,
        // vertically centred.
        const x0 = x;
        const y0 = y - LABEL_H / 2;
        const x1 = x + labelWidth(l.text);
        const y1 = y0 + LABEL_H;
        if (grid.collides(x0, y0, x1, y1)) continue;
        grid.place(x0, y0, x1, y1);

        let tx = x + TEXT_DX;
        if (l.icon) {
          const ic = iconFor(l);
          if (ic?.ready) {
            ctx.drawImage(ic.img, tx, y - ic.h / 2, ic.w, ic.h);
            tx += ic.w + ICON_GAP;
          }
        }
        if (l.text) {
          const s = nameSprite(l.text, `rgb(${l.color[0]},${l.color[1]},${l.color[2]})`, dpr);
          if (s) ctx.drawImage(s.img, tx - NAME_PAD, y - s.h / 2, s.w, s.h);
        }
        if (l.detail && zoom >= (l.detailMinZoom ?? 0)) {
          const d = detailSprite(l.detail, dpr);
          if (d) ctx.drawImage(d.img, tx, y + LABEL_H / 2 + 2, d.w, d.h);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getViewport, getCamera]);

  return (
    <div
      ref={hostRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 2 }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0 }} />
      {/* Sprite source for the icon glyphs: rendered by React, never laid out or
          painted (display:none), serialised into image sprites on demand. */}
      <div style={{ display: "none" }} aria-hidden="true">
        {iconLabels.map((l) => (
          <div
            key={l.id}
            ref={(el) => {
              if (el) iconHolders.current.set(l.id, el);
              else {
                iconHolders.current.delete(l.id);
                iconByLabel.current.delete(l.id);
              }
            }}
          >
            {l.icon}
          </div>
        ))}
      </div>
    </div>
  );
}
