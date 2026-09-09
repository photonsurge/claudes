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
 * image once per variant (CSS custom properties resolved), baked to a bitmap
 * the moment it loads, and drawn as sprites too — the previous DOM pins wrote
 * ~26 inline styles a frame during a spin, which forced one of the two style
 * recalcs every frame paid for. A frame whose camera, size and label set are
 * unchanged since the last one is skipped outright (a parked shot costs nothing).
 *
 * Per-frame, from the LIVE viewport (not React state, which doesn't rebuild on
 * zoom): far-side culling (deck's project() happily returns screen coords for
 * points occluded by the globe, so we cull with a near-hemisphere dot-product
 * test), progressive reveal by `minZoom` / `detailMinZoom`, and collision
 * decluttering in priority order.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface OverlayLabel {
  id: string;
  text: string;
  /** Small glyph rendered before the text (e.g. a station-type icon). Purely
   *  decorative — not counted by `labelWidth()`'s collision estimate. */
  icon?: ReactNode;
  /** Stable identity of the icon's LOOK (e.g. `heartbeat:on`). With it the
   *  glyph is rasterised once per look (+ theme colours) and its hidden DOM
   *  copy is dropped after that first frame; without it the icon stays in the
   *  DOM and is re-serialised on every label rebuild. */
  iconKey?: string;
  /** Dim secondary line (e.g. "United Kingdom · 9.0M"), shown when zoomed in. */
  detail?: string;
  /** [lng, lat, altM] — same position the marker/dot uses, so they line up. */
  position: [number, number, number];
  color: [number, number, number];
  /** Hide the whole label below this zoom (progressive reveal). Default 0. */
  minZoom?: number;
  /** Hide just the detail line below this zoom. Default = always show detail. */
  detailMinZoom?: number;
  /** Anchor: text to the right of the point (default) or centred on it (H/L markers). */
  align?: "left" | "center";
  /** Canvas font for the name; default NAME_FONT. */
  font?: string;
  /** Detail as the dark chip (default) or plain haloed text under the name. */
  detailStyle?: "chip" | "plain";
  /** Canvas font for a plain detail; default PLAIN_DETAIL_FONT. */
  detailFont?: string;
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

/**
 * The frame loop's view of the label list: biggest/capital first (lowest
 * `minZoom`) so a crowded conurbation keeps its most important label, plus flat
 * per-label arrays for the cull pass. Built once per label rebuild (~1/s);
 * the per-frame pass then reads two typed arrays instead of touching a couple
 * of thousand objects and a WeakMap, and — because the list is sorted by
 * `minZoom` — stops at the first label above the current zoom.
 */
export interface LabelIndex {
  labels: OverlayLabel[];
  /** Unit sphere vectors, 3 per label, in `labels` order. */
  unit: Float64Array;
  /** `minZoom ?? 0` per label (Float64: an exact-equality zoom must compare as before). */
  minZoom: Float64Array;
}

export function indexLabels(labels: OverlayLabel[]): LabelIndex {
  const sorted = [...labels].sort((a, b) => (a.minZoom ?? 0) - (b.minZoom ?? 0));
  const n = sorted.length;
  const u = new Float64Array(n * 3);
  const mz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const l = sorted[i];
    const [x, y, z] = unit(l.position[0], l.position[1]);
    u[i * 3] = x;
    u[i * 3 + 1] = y;
    u[i * 3 + 2] = z;
    mz[i] = l.minZoom ?? 0;
  }
  return { labels: sorted, unit: u, minZoom: mz };
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

/** One 48 px cell's boxes for the current frame. `stamp` is the frame that last
 *  wrote it: `clear()` only bumps the grid's stamp, so the Map and every cell's
 *  array survive from frame to frame instead of being dropped and regrown (a
 *  thousand cells' worth of Map growth, array allocation and the per-call
 *  closures `forCells` took — all GC pressure at 30 frames/s). Rects are stored
 *  flat (x0, y0, x1, y1, …) for the same reason. */
type Cell = { stamp: number; rects: number[] };

export class LabelGrid {
  // Numeric cell keys: this runs per label per frame, and a `${cx},${cy}`
  // template string per cell was a measurable allocation + hash cost.
  private cells = new Map<number, Cell>();
  private stamp = 1;

  /** Forget this frame's boxes — O(1): cells with an older stamp read as empty. */
  clear() {
    this.stamp++;
  }

  /** True if the box overlaps anything already placed this frame. */
  collides(x0: number, y0: number, x1: number, y1: number): boolean {
    const cx0 = Math.floor(x0 / GRID_CELL);
    const cx1 = Math.floor(x1 / GRID_CELL);
    const cy0 = Math.floor(y0 / GRID_CELL);
    const cy1 = Math.floor(y1 / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.cells.get((cx + 32768) * 65536 + (cy + 32768));
        if (!cell || cell.stamp !== this.stamp) continue;
        const r = cell.rects;
        for (let i = 0; i < r.length; i += 4) {
          if (x0 < r[i + 2] && x1 > r[i] && y0 < r[i + 3] && y1 > r[i + 1]) return true;
        }
      }
    }
    return false;
  }

  place(x0: number, y0: number, x1: number, y1: number) {
    const cx0 = Math.floor(x0 / GRID_CELL);
    const cx1 = Math.floor(x1 / GRID_CELL);
    const cy0 = Math.floor(y0 / GRID_CELL);
    const cy1 = Math.floor(y1 / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = (cx + 32768) * 65536 + (cy + 32768);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = { stamp: this.stamp, rects: [] };
          this.cells.set(key, cell);
        } else if (cell.stamp !== this.stamp) {
          cell.stamp = this.stamp;
          cell.rects.length = 0;
        }
        cell.rects.push(x0, y0, x1, y1);
      }
    }
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
  /** Cache key — combined sprites key on their parts' keys. */
  key: string;
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
  const s: Sprite = { img: c, w, h, key };
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

/** Plain (chip-less) detail line, e.g. a pressure centre's hPa value. */
const PLAIN_DETAIL_FONT = "600 11px system-ui, sans-serif";

function nameSprite(text: string, color: string, dpr: number, font = NAME_FONT): Sprite | null {
  const key = `n|${dpr}|${font}|${color}|${text}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const w = Math.ceil(textWidth(font, text)) + NAME_PAD * 2;
  return makeSprite(key, dpr, w, NAME_H, (g) => {
    g.font = font;
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
  /** Bitmap at the sprite's dpr — null until the SVG image has loaded and been baked. */
  img: HTMLCanvasElement | null;
  /** CSS-px size. */
  w: number;
  h: number;
}
const iconSprites = new Map<string, IconSprite>();
const serializer = typeof XMLSerializer === "function" ? new XMLSerializer() : null;
/** Bumped whenever an icon bitmap lands, so a parked frame knows to repaint. */
let iconEpoch = 0;

/**
 * SVG markup → bitmap sprite, once per distinct (markup, dpr). `var(--x,
 * fallback)` references (the icons take their ink from the scene's --gods-*
 * custom properties) are resolved against `vars` first: a data: image has no
 * access to the page's custom properties and would fall back to the defaults.
 *
 * Baked to a canvas the moment the <img> loads: `drawImage` of an SVG-backed
 * image element makes Blink re-rasterise the vector document on EVERY call,
 * and dozens of icon labels a frame made that the label canvas's top cost. A
 * bitmap blit is a texture copy.
 */
const VAR_RE = /var\((--[\w-]+)\s*,\s*([^)]+)\)/g;

/** The custom-property names an icon's markup reads (`var(--x, fallback)`). */
export function iconVarsOf(markup: string): string[] {
  const out = new Set<string>();
  for (const m of markup.matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

/**
 * Cache signature for a keyed icon: its look key, the backing-store scale and
 * the CURRENT values of the theme variables it reads — so a scene theme change
 * rasterises fresh sprites while everything else hits the cache. Null until
 * the key has been serialised once (its variables aren't known before that).
 */
export function iconSig(
  key: string,
  dpr: number,
  vars: string[] | undefined,
  resolve: (name: string, fallback: string) => string,
): string | null {
  if (!vars) return null;
  return `${key}|${dpr}|${vars.map((v) => resolve(v, "")).join("|")}`;
}

/** Serialise a rendered icon <svg> with its theme variables resolved. */
function serialiseIcon(svg: Element, vars: (name: string, fallback: string) => string): { html: string; varNames: string[] } {
  const raw = serializer ? serializer.serializeToString(svg) : "";
  const varNames = iconVarsOf(raw);
  const html = raw.replace(VAR_RE, (_, name: string, fallback: string) => vars(name, fallback.trim()));
  return { html, varNames };
}

/** Which theme variables each icon key's markup reads — learned on first serialisation. */
const iconKeyVars = new Map<string, string[]>();
/** Sprite per keyed-icon signature (see iconSig). */
const iconBySig = new Map<string, IconSprite>();

/**
 * Which icon labels still need a hidden DOM holder: every keyless one, plus
 * keyed ones whose look (at the current theme colours and dpr) has no sprite
 * yet. `epoch` only ties the call to the render that follows a rasterisation.
 */
export function holderLabels(
  iconLabels: OverlayLabel[],
  computed: CSSStyleDeclaration | null,
  epoch: number,
): OverlayLabel[] {
  void epoch;
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, MAX_DPR) : 1;
  const resolve = (name: string, fallback: string) => computed?.getPropertyValue(name).trim() || fallback;
  return iconLabels.filter((l) => {
    if (!l.iconKey) return true;
    const sig = iconSig(l.iconKey, dpr, iconKeyVars.get(l.iconKey), resolve);
    return !sig || !iconBySig.has(sig);
  });
}

function iconSprite(
  svg: Element,
  vars: (name: string, fallback: string) => string,
  dpr: number,
): IconSprite | null {
  if (!serializer) return null;
  const { html } = serialiseIcon(svg, vars);
  return spriteForHtml(html, dpr);
}

/** Bitmap sprite for resolved icon markup, once per distinct (markup, dpr). */
function spriteForHtml(html: string, dpr: number): IconSprite {
  const key = `${dpr}|${html}`;
  const hit = iconSprites.get(key);
  if (hit) return hit;
  const entry: IconSprite = { img: null, w: 0, h: 0 };
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || 12;
    const h = img.naturalHeight || 12;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.drawImage(img, 0, 0, w, h);
    entry.img = c;
    entry.w = w;
    entry.h = h;
    iconEpoch += 1;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(html)}`;
  iconSprites.set(key, entry);
  return entry;
}

/** Text sprites resolved once per label object (labels rebuild ~1/s; the
 *  per-frame path used to rebuild a cache-key string for every label). */
interface LabelSprites {
  dpr: number;
  name: Sprite | null;
  detail: Sprite | null;
  /** Name + detail pre-composed for the left-anchored layout: ONE drawImage
   *  per label instead of two (a dense zoomed shot draws ~300 of each). */
  combo: Sprite | null;
}
/** Vertical offset of the detail line below the name sprite's top edge. */
const DETAIL_DY = NAME_H / 2 + LABEL_H / 2 + 2;

function comboSprite(name: Sprite, detail: Sprite, dpr: number): Sprite | null {
  const key = `c|${name.key}|${detail.key}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const w = Math.max(name.w, NAME_PAD + detail.w);
  const h = DETAIL_DY + detail.h;
  return makeSprite(key, dpr, w, h, (g) => {
    g.drawImage(name.img, 0, 0, name.w, name.h);
    g.drawImage(detail.img, NAME_PAD, DETAIL_DY, detail.w, detail.h);
  });
}

const textByLabel = new WeakMap<OverlayLabel, LabelSprites>();
function spritesOf(l: OverlayLabel, dpr: number): LabelSprites {
  let s = textByLabel.get(l);
  if (s && s.dpr === dpr) return s;
  const color = `rgb(${l.color[0]},${l.color[1]},${l.color[2]})`;
  const name = l.text ? nameSprite(l.text, color, dpr, l.font) : null;
  const detail = !l.detail
    ? null
    : l.detailStyle === "plain"
      ? nameSprite(l.detail, color, dpr, l.detailFont ?? PLAIN_DETAIL_FONT)
      : detailSprite(l.detail, dpr);
  s = {
    dpr,
    name,
    detail,
    combo: name && detail && l.align !== "center" ? comboSprite(name, detail, dpr) : null,
  };
  textByLabel.set(l, s);
  return s;
}

// ── View culling ──────────────────────────────────────────────────────────
/**
 * cos of the widest angle from the sub-camera point that can still land on
 * screen (plus the label margin), from the viewport's four corners. Labels
 * beyond it are skipped BEFORE projection and collision testing — a zoomed
 * shot has ~1 000 labels facing the camera but only a few hundred anywhere
 * near the screen. Falls back to the near-hemisphere floor (whole-globe
 * shots, or a viewport without unproject()).
 */
export function viewCosMin(vp: Viewport, w: number, h: number, cam: [number, number, number]): number {
  const FLOOR = 0.04;
  if (typeof vp.unproject !== "function") return FLOOR;
  let maxAngle = 0;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    const ll = vp.unproject([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return FLOOR;
    const [ux, uy, uz] = unit(ll[0], ll[1]);
    const d = Math.max(-1, Math.min(1, ux * cam[0] + uy * cam[1] + uz * cam[2]));
    maxAngle = Math.max(maxAngle, Math.acos(d));
  }
  // Labels may sit up to ~160 px outside the viewport: widen by a quarter
  // plus a degree, never past the hemisphere.
  const a = Math.min(Math.PI / 2, maxAngle * 1.25 + Math.PI / 180);
  return Math.max(FLOOR, Math.cos(a));
}

/** Last-frame counters for scripts/profile-watch.mjs (`--deck` prints them). */
const labelStats = { frames: 0, skipped: 0, considered: 0, projected: 0, drawn: 0, draws: 0 };

// ── Fast projection ───────────────────────────────────────────────────────
// deck's viewport.project() is trig + a 4×4 transform + three array
// allocations per call, and a dense region projects >1 k labels a frame to
// draw a few dozen (the collision grid needs screen positions to declutter).
// The world position of a label never changes (GlobeViewport.projectPosition
// is pure lng/lat → sphere; zoom lives in the matrix), so it is cached per
// label and each frame is one allocation-free matrix multiply. Falls back to
// project() for any viewport that lacks the pieces.
const worldCache = new WeakMap<OverlayLabel, { ctor: unknown; p: number[] }>();
function worldOf(l: OverlayLabel, vp: Viewport): number[] {
  let c = worldCache.get(l);
  if (!c || c.ctor !== vp.constructor) {
    c = { ctor: vp.constructor, p: vp.projectPosition(l.position) };
    worldCache.set(l, c);
  }
  return c.p;
}
function fastMatrix(vp: Viewport): ArrayLike<number> | null {
  const m = vp.pixelProjectionMatrix;
  return m && m.length === 16 && typeof vp.projectPosition === "function" ? m : null;
}
/** World → pixel through deck's pixelProjectionMatrix (column-major), perspective-divided. */
export function projectWorld(m: ArrayLike<number>, p: ArrayLike<number>, out: [number, number]): [number, number] {
  const x = p[0];
  const y = p[1];
  const z = p[2] ?? 0;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return out;
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
  const iconByLabel = useRef<Map<string, { gen: number; dpr: number; sprite: IconSprite | null }>>(new Map());
  const genRef = useRef(0);
  const computedRef = useRef<CSSStyleDeclaration | null>(null);
  // Bumped when a keyed icon has just been rasterised, so the render below can
  // drop its hidden DOM holder (kept only until the first sprite exists).
  const [holderEpoch, setHolderEpoch] = useState(0);
  // Signature of the last painted frame: camera + size + label generation.
  // A parked shot (no spin, no idle motion, no new labels) repaints nothing.
  const lastSigRef = useRef("");
  const labelIndex = useMemo(() => indexLabels(labels), [labels]);
  const indexRef = useRef<LabelIndex>(labelIndex);
  indexRef.current = labelIndex;
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
    // Set when a keyed icon was rasterised this frame → re-render to drop holders.
    let keyedNew = false;
    const iconFor = (l: OverlayLabel, dpr: number): IconSprite | null => {
      if (l.iconKey) {
        // Keyed: one sprite per (look, dpr, theme colours), shared by every
        // label with that look; serialised once per look, then never again.
        const sig = iconSig(l.iconKey, dpr, iconKeyVars.get(l.iconKey), resolveVar);
        if (sig) {
          const hit = iconBySig.get(sig);
          if (hit) return hit;
        }
        const svg = iconHolders.current.get(l.id)?.firstElementChild ?? null;
        if (!svg || !serializer) return null; // holder not rendered yet
        const { html, varNames } = serialiseIcon(svg, resolveVar);
        iconKeyVars.set(l.iconKey, varNames);
        const sprite = spriteForHtml(html, dpr);
        iconBySig.set(iconSig(l.iconKey, dpr, varNames, resolveVar)!, sprite);
        keyedNew = true;
        return sprite;
      }
      const gen = genRef.current;
      const cached = iconByLabel.current.get(l.id);
      if (cached && cached.gen === gen && cached.dpr === dpr) return cached.sprite;
      const svg = iconHolders.current.get(l.id)?.firstElementChild ?? null;
      const sprite = svg ? iconSprite(svg, resolveVar, dpr) : null;
      iconByLabel.current.set(l.id, { gen, dpr, sprite });
      return sprite;
    };
    const tick = () => {
      const vp = getViewport();
      const canvas = canvasRef.current;
      if (!vp || !canvas) return;
      const w: number = vp.width;
      const h: number = vp.height;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cam = getCamera();
      const zoom: number = vp.zoom ?? 0;
      // Nothing moved and nothing new to show → keep last frame's pixels.
      const sig = `${w}|${h}|${dpr}|${vp.longitude}|${vp.latitude}|${zoom}|${cam.longitude}|${cam.latitude}|${genRef.current}|${iconEpoch}`;
      labelStats.frames += 1;
      if (sig === lastSigRef.current) {
        labelStats.skipped += 1;
        return;
      }
      lastSigRef.current = sig;
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

      const [cx, cy, cz] = unit(cam.longitude, cam.latitude);
      const cosMin = viewCosMin(vp, w, h, [cx, cy, cz]);
      const grid = gridRef.current;
      grid.clear();
      const m = fastMatrix(vp);
      const px: [number, number] = [0, 0];
      let considered = 0;
      let projected = 0;
      let drawn = 0;
      let draws = 0;
      const { labels: ls, unit: un, minZoom: mz } = indexRef.current;
      for (let i = 0; i < ls.length; i++) {
        // Progressive reveal: below the label's minZoom it's not shown at all —
        // and the list is sorted by minZoom, so the first one above the zoom
        // ends this frame's candidates.
        if (zoom < mz[i]) break;
        considered++;
        // Beyond the view's angular reach (or on the hidden hemisphere — the
        // 0.04 floor keeps a small margin so labels don't flicker at the limb).
        const j = i * 3;
        if (un[j] * cx + un[j + 1] * cy + un[j + 2] * cz <= cosMin) continue;
        const l = ls[i];
        projected++;
        let x: number;
        let y: number;
        if (m) {
          projectWorld(m, worldOf(l, vp), px);
          x = px[0];
          y = px[1];
        } else {
          const p = vp.project(l.position);
          x = p[0];
          y = p[1];
        }
        if (x < -160 || y < -50 || x > w + 160 || y > h + 50) continue;
        // Decluttering: skip (hide) this label if a higher-priority one
        // already claimed overlapping screen space this frame. Box is
        // anchored the same way the text is laid out — right of the point
        // (or centred on it), vertically centred.
        const centred = l.align === "center";
        const showDetail = !!l.detail && zoom >= (l.detailMinZoom ?? 0);
        const boxW = centred
          ? Math.max(labelWidth(l.text), showDetail ? labelWidth(l.detail!) : 0)
          : labelWidth(l.text);
        const x0 = centred ? x - boxW / 2 : x;
        const y0 = y - LABEL_H / 2;
        const x1 = x0 + boxW;
        const y1 = y0 + LABEL_H + (centred && showDetail ? DETAIL_H : 0);
        if (grid.collides(x0, y0, x1, y1)) continue;
        grid.place(x0, y0, x1, y1);
        drawn++;

        const sp = spritesOf(l, dpr);
        if (centred) {
          if (sp.name) {
            ctx.drawImage(sp.name.img, x - sp.name.w / 2, y - sp.name.h / 2, sp.name.w, sp.name.h);
            draws++;
          }
          if (sp.detail && showDetail) {
            ctx.drawImage(sp.detail.img, x - sp.detail.w / 2, y + LABEL_H / 2 - 3, sp.detail.w, sp.detail.h);
            draws++;
          }
          continue;
        }
        let tx = x + TEXT_DX;
        if (l.icon) {
          const ic = iconFor(l, dpr);
          if (ic?.img) {
            ctx.drawImage(ic.img, tx, y - ic.h / 2, ic.w, ic.h);
            draws++;
            tx += ic.w + ICON_GAP;
          }
        }
        if (sp.combo && showDetail) {
          // Name + detail in one blit (same placement as the two draws below).
          ctx.drawImage(sp.combo.img, tx - NAME_PAD, y - NAME_H / 2, sp.combo.w, sp.combo.h);
          draws++;
          continue;
        }
        if (sp.name) {
          ctx.drawImage(sp.name.img, tx - NAME_PAD, y - sp.name.h / 2, sp.name.w, sp.name.h);
          draws++;
        }
        if (sp.detail && showDetail) {
          ctx.drawImage(sp.detail.img, tx, y + LABEL_H / 2 + 2, sp.detail.w, sp.detail.h);
          draws++;
        }
      }
      labelStats.considered = considered;
      labelStats.projected = projected;
      labelStats.drawn = drawn;
      labelStats.draws = draws;
      if (keyedNew) {
        keyedNew = false;
        setHolderEpoch((e) => e + 1);
      }
    };
    (window as unknown as { __godsLabels?: unknown }).__godsLabels = labelStats;
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      delete (window as unknown as { __godsLabels?: unknown }).__godsLabels;
    };
  }, [getViewport, getCamera]);

  return (
    <div
      ref={hostRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 2 }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0 }} />
      {/* Sprite source for the icon glyphs: rendered by React, never laid out or
          painted (display:none), serialised into image sprites on demand. Keyed
          icons keep a holder only until their look has been rasterised — a few
          hundred station pins would otherwise sit in the DOM and be re-diffed
          by React on every label rebuild. */}
      <div style={{ display: "none" }} aria-hidden="true">
        {holderLabels(iconLabels, computedRef.current, holderEpoch).map((l) => (
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
