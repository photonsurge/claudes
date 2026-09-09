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
import { SpriteAtlas, type AtlasRegion } from "./label-atlas";
import {
  DETAIL_H,
  LABEL_H,
  LabelGrid,
  declutter,
  indexLabelData,
  labelWidth,
  projectWorldAt,
  unit,
  type Decision,
  type FrameParams,
} from "./label-declutter";
import { createDeclutterer, type Declutterer } from "./label-declutter-client";
export { LabelGrid, labelWidth, projectWorld } from "./label-declutter";

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

/**
 * The frame loop's view of the label list: biggest/capital first (lowest
 * `minZoom`) so a crowded conurbation keeps its most important label, plus the
 * flat per-label arrays the declutter pass reads (label-declutter.ts) — built
 * once per label rebuild (~1/s) so the per-frame pass touches typed arrays, not
 * a couple of thousand objects. World positions are filled in by the frame
 * loop (they need the live viewport) and then never change: the sphere
 * position of a label is fixed, only the matrix moves.
 */
export interface LabelIndex {
  labels: OverlayLabel[];
  data: import("./label-declutter").LabelIndexData;
  /** Bumped per rebuild; a worker decision is only used for the same generation. */
  gen: number;
  /** Which viewport class `data.world` was projected with (null until filled). */
  worldCtor: unknown;
}
let indexGen = 0;
export function indexLabels(labels: OverlayLabel[]): LabelIndex {
  const sorted = [...labels].sort((a, b) => (a.minZoom ?? 0) - (b.minZoom ?? 0));
  return { labels: sorted, data: indexLabelData(sorted), gen: ++indexGen, worldCtor: null };
}

// Collision avoidance, projection and the per-frame decision live in
// label-declutter.ts (pure data, shared with the declutter worker).

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
const DETAIL_PAD = 6;
/** Name sprite box: tall enough for the 12px face plus a 3px halo. */
const NAME_H = 20;
const NAME_PAD = 4;
/** Backing-store cap: 2× is crisp on any broadcast canvas; more is wasted fill. */
const MAX_DPR = 2;
/** Sprite cache bound — FIFO eviction; cities ≈ 2.3 k, track names churn. */
const SPRITE_CAP = 4000;

/** Every sprite lives in the shared atlas (label-atlas.ts): one source for a frame's blits. */
const atlas = new SpriteAtlas();

interface Sprite {
  /** Its atlas region (integer device pixels). */
  region: AtlasRegion;
  /** CSS-px size. */
  w: number;
  h: number;
  /** Cache key — combined sprites key on their parts' keys. */
  key: string;
}

const sprites = new Map<string, Sprite>();
let measureCtx: CanvasRenderingContext2D | null = null;

/** A cached sprite is only good while its atlas page is; a retired page's sprites re-rasterise. */
function liveSprite(key: string): Sprite | null {
  const hit = sprites.get(key);
  return hit && hit.region.page.alive ? hit : null;
}

/** Paint `w`×`h` CSS px at `dpr` into a fresh atlas region — the clip and transform a sprite canvas had. */
function paintRegion(dpr: number, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): AtlasRegion | null {
  const bw = Math.max(1, Math.ceil(w * dpr));
  const bh = Math.max(1, Math.ceil(h * dpr));
  const region = atlas.alloc(bw, bh);
  if (!region) return null;
  const g = region.page.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(region.sx, region.sy, bw, bh);
  g.clip();
  g.setTransform(dpr, 0, 0, dpr, region.sx, region.sy);
  paint(g);
  g.restore();
  return region;
}

/** One blit from the atlas: the sprite's integer source rect at its CSS-px size, exactly as before. */
function blit(ctx: CanvasRenderingContext2D, r: AtlasRegion, w: number, h: number, dx: number, dy: number): void {
  ctx.drawImage(r.page.canvas, r.sx, r.sy, r.sw, r.sh, dx, dy, w, h);
}

function makeSprite(
  key: string,
  dpr: number,
  w: number,
  h: number,
  paint: (g: CanvasRenderingContext2D) => void,
): Sprite | null {
  const hit = liveSprite(key);
  if (hit) return hit;
  const region = paintRegion(dpr, w, h, paint);
  if (!region) return null;
  const s: Sprite = { region, w, h, key };
  if (!sprites.has(key) && sprites.size >= SPRITE_CAP) {
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
  const hit = liveSprite(key);
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
  const hit = liveSprite(key);
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
  /** Atlas region at the sprite's dpr — null until the SVG image has loaded and been baked. */
  region: AtlasRegion | null;
  /** CSS-px size. */
  w: number;
  h: number;
  /** The resolved markup, so a retired page's glyph can be baked again. */
  html: string;
  dpr: number;
  baking: boolean;
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
  if (hit) {
    refreshIcon(hit);
    return hit;
  }
  const entry: IconSprite = { region: null, w: 0, h: 0, html, dpr, baking: false };
  iconSprites.set(key, entry);
  bakeIcon(entry);
  return entry;
}

/** An icon whose atlas page was retired keeps drawing from it (its pixels stay
 *  until it is collected) while a fresh bake lands — no frame without its glyph. */
function refreshIcon(entry: IconSprite): void {
  if (entry.region && !entry.region.page.alive) bakeIcon(entry);
}

/** Load the glyph's SVG as an image and paint it into the atlas. */
function bakeIcon(entry: IconSprite): void {
  if (entry.baking) return;
  entry.baking = true;
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || 12;
    const h = img.naturalHeight || 12;
    const region = paintRegion(entry.dpr, w, h, (g) => g.drawImage(img, 0, 0, w, h));
    entry.baking = false;
    if (!region) return;
    entry.region = region;
    entry.w = w;
    entry.h = h;
    iconEpoch += 1;
  };
  img.onerror = () => {
    entry.baking = false;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.html)}`;
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
  const hit = liveSprite(key);
  if (hit) return hit;
  const w = Math.max(name.w, NAME_PAD + detail.w);
  const h = DETAIL_DY + detail.h;
  return makeSprite(key, dpr, w, h, (g) => {
    blit(g, name.region, name.w, name.h, 0, 0);
    blit(g, detail.region, detail.w, detail.h, NAME_PAD, DETAIL_DY);
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
// allocations per call. The world position of a label never changes
// (GlobeViewport.projectPosition is pure lng/lat → sphere; zoom lives in the
// matrix), so the index carries every label's world position and each frame
// is one allocation-free matrix multiply (label-declutter.ts). Falls back to
// project() for any viewport that lacks the pieces.
function fastMatrix(vp: Viewport): ArrayLike<number> | null {
  const m = vp.pixelProjectionMatrix;
  return m && m.length === 16 && typeof vp.projectPosition === "function" ? m : null;
}
/** Fill the index's world positions for this viewport class (once per rebuild). */
function ensureWorld(idx: LabelIndex, vp: Viewport): void {
  if (idx.worldCtor === vp.constructor) return;
  const { labels, data } = idx;
  for (let i = 0; i < labels.length; i++) {
    const p = vp.projectPosition(labels[i].position);
    data.world[i * 3] = p[0];
    data.world[i * 3 + 1] = p[1];
    data.world[i * 3 + 2] = p[2] ?? 0;
  }
  idx.worldCtor = vp.constructor;
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
  // The declutter worker (null where Workers are unavailable → inline), and
  // the label generation it was last given.
  const declutterRef = useRef<Declutterer | null | undefined>(undefined);
  const sentGenRef = useRef(-1);

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
          if (hit) {
            refreshIcon(hit);
            return hit;
          }
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
      if (cached && cached.gen === gen && cached.dpr === dpr) {
        if (cached.sprite) refreshIcon(cached.sprite);
        return cached.sprite;
      }
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
      const idx = indexRef.current;
      const { labels: ls, data } = idx;
      const m = fastMatrix(vp);
      if (m) ensureWorld(idx, vp);
      const frame: FrameParams = { m, w, h, zoom, cx, cy, cz, cosMin };
      // Which labels to draw (and with their detail line or not): the worker's
      // pass over the PREVIOUS frame's camera when it has one for this label
      // generation, else computed here. Positions below are always projected
      // against THIS frame's matrix, so a one-frame-old decision only means a
      // label at the edge of a collision appears or hides a frame late.
      if (declutterRef.current === undefined) declutterRef.current = createDeclutterer();
      const dc = declutterRef.current;
      let decision: Decision;
      if (dc && m) {
        if (sentGenRef.current !== idx.gen) {
          dc.setIndex(idx.gen, data);
          sentGenRef.current = idx.gen;
        }
        const ready = dc.take();
        if (!dc.busy) dc.request(idx.gen, frame);
        decision = ready && ready.gen === idx.gen ? ready : declutter(data, frame, gridRef.current);
      } else {
        decision = declutter(data, frame, gridRef.current, m ? undefined : (i) => vp.project(ls[i].position));
      }
      const px: [number, number] = [0, 0];
      let drawn = 0;
      let draws = 0;
      const { chosen, detail } = decision;
      for (let k = 0; k < chosen.length; k++) {
        const i = chosen[k];
        const l = ls[i];
        let x: number;
        let y: number;
        if (m) {
          projectWorldAt(m, data.world, i * 3, px);
          x = px[0];
          y = px[1];
        } else {
          const p = vp.project(l.position);
          x = p[0];
          y = p[1];
        }
        drawn++;
        const showDetail = detail[k] === 1;
        const sp = spritesOf(l, dpr);
        if (l.align === "center") {
          if (sp.name) {
            blit(ctx, sp.name.region, sp.name.w, sp.name.h, x - sp.name.w / 2, y - sp.name.h / 2);
            draws++;
          }
          if (sp.detail && showDetail) {
            blit(ctx, sp.detail.region, sp.detail.w, sp.detail.h, x - sp.detail.w / 2, y + LABEL_H / 2 - 3);
            draws++;
          }
          continue;
        }
        let tx = x + TEXT_DX;
        if (l.icon) {
          const ic = iconFor(l, dpr);
          if (ic?.region) {
            blit(ctx, ic.region, ic.w, ic.h, tx, y - ic.h / 2);
            draws++;
            tx += ic.w + ICON_GAP;
          }
        }
        if (sp.combo && showDetail) {
          // Name + detail in one blit (same placement as the two draws below).
          blit(ctx, sp.combo.region, sp.combo.w, sp.combo.h, tx - NAME_PAD, y - NAME_H / 2);
          draws++;
          continue;
        }
        if (sp.name) {
          blit(ctx, sp.name.region, sp.name.w, sp.name.h, tx - NAME_PAD, y - sp.name.h / 2);
          draws++;
        }
        if (sp.detail && showDetail) {
          blit(ctx, sp.detail.region, sp.detail.w, sp.detail.h, tx, y + LABEL_H / 2 + 2);
          draws++;
        }
      }
      labelStats.considered = decision.considered;
      labelStats.projected = decision.projected;
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
      declutterRef.current?.destroy();
      declutterRef.current = undefined;
      sentGenRef.current = -1;
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
