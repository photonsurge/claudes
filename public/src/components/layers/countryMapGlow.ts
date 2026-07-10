"use client";

/**
 * "Map as the glow" spotlight fill. Instead of washing a spotlighted country in
 * a flat cyan tint (countryGlow's translucent fill), this fills the country with
 * REAL map imagery clipped to its own shape — brightened and breathing — so the
 * highlight IS the map lighting up, not a colour over it.
 *
 * Why a baked BitmapLayer and not deck.gl's MaskExtension: MaskExtension is
 * explicitly unsupported under `_GlobeView` (it `log.warn`s and no-ops), so a
 * polygon can't clip a raster on the sphere. But the source basemap images
 * (/data/terrain.jpg …) are equirectangular (plate carrée), so lng/lat → pixel
 * is a plain linear map: we rasterize the country boundary into a canvas clip
 * path, draw the matching image crop through it, and hand the canvas to a
 * BitmapLayer over the country's bbox — the SAME proven pattern satimg.ts uses
 * (BitmapLayer + DEPTH_PAINT + back-face cull renders clean on the globe).
 *
 * The bake is memoized per (country, image) so the per-frame breathe only
 * recreates a cheap layer over the cached canvas — never re-rasterizes.
 */
import { BitmapLayer } from "@deck.gl/layers";
import { DEPTH_PAINT } from "./depth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Geometry = { type?: string; coordinates?: any } | null | undefined;
export type Ring = number[][];
export type Poly = Ring[]; // [outerRing, ...holeRings]
export type Bbox = [number, number, number, number]; // [west, south, east, north]

/** Polygon → one part; MultiPolygon → many; anything else → none. */
export function polysOf(geometry: Geometry): Poly[] {
  if (geometry?.type === "Polygon") return [geometry.coordinates as Poly];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates as Poly[];
  return [];
}

function ringBbox(ring: Ring): Bbox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/** Union bbox over every part's outer ring, or null if there are no points. */
export function unionBbox(polys: Poly[]): Bbox | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer?.length) continue;
    const [pw, ps, pe, pn] = ringBbox(outer);
    if (pw < w) w = pw;
    if (ps < s) s = ps;
    if (pe > e) e = pe;
    if (pn > n) n = pn;
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** A bbox wider than half the globe is really an antimeridian straddle (Russia,
 *  Fiji) collapsed to one bogus box — the crop/clip math below assumes a single
 *  continuous plate-carrée window, so callers fall back to the largest part. */
export function spansAntimeridian(bbox: Bbox): boolean {
  return bbox[2] - bbox[0] > 180;
}

/** The part with the largest outer-ring bbox area — same "biggest landmass"
 *  convention the camera-framing code uses to ignore far-flung territories. */
export function largestPoly(polys: Poly[]): Poly | null {
  let best: Poly | null = null;
  let bestArea = -Infinity;
  for (const poly of polys) {
    if (!poly[0]?.length) continue;
    const [w, s, e, n] = ringBbox(poly[0]);
    const area = (e - w) * (n - s);
    if (area > bestArea) {
      bestArea = area;
      best = poly;
    }
  }
  return best;
}

/** Project a [lng,lat] into canvas-local pixels for a bbox-sized canvas (north
 *  at the top, matching an equirectangular image's row order). */
export function projectPoint(
  [lng, lat]: number[],
  [w, s, e, n]: Bbox,
  cw: number,
  ch: number,
): [number, number] {
  const dx = e - w || 1;
  const dy = n - s || 1;
  return [((lng - w) / dx) * cw, ((n - lat) / dy) * ch];
}

/** One full breath, in ms — matches countryGlow so the map fill and the framing
 *  edge pulse in lockstep. */
const GLOW_PERIOD_MS = 2600;
export function glowBreath(now: number, period = GLOW_PERIOD_MS): number {
  const phase = (((now % period) + period) % period) / period;
  return 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
}

/** Canvas dimensions for a bbox at the source image's resolution, capped so a
 *  wide country (Russia, Canada) can't allocate a giant texture. */
export function canvasSizeFor(
  bbox: Bbox,
  imageW: number,
  imageH: number,
  maxTex: number,
): { cw: number; ch: number } {
  const [w, s, e, n] = bbox;
  const fullW = ((e - w) / 360) * imageW;
  const fullH = ((n - s) / 180) * imageH;
  const scale = Math.min(1, maxTex / Math.max(fullW, fullH, 1));
  return {
    cw: Math.max(1, Math.round(fullW * scale)),
    ch: Math.max(1, Math.round(fullH * scale)),
  };
}

const MAX_TEX = 2048;

/** The loaded equirectangular source image (or {width,height} in tests). */
export interface SourceImage {
  width: number;
  height: number;
}

/** iso|imageSrc → baked canvas, so the per-frame breathe never re-rasterizes.
 *  A country's mask depends only on its geometry and the source image, neither
 *  of which changes while it's on air. */
const bakeCache = new Map<string, HTMLCanvasElement>();

/** For tests: drop the memoized canvases (jsdom has no 2d context anyway). */
export function _clearBakeCache(): void {
  bakeCache.clear();
}

function cacheKey(feature: { properties?: { iso_a2?: string } }, image: SourceImage & { src?: string }): string {
  const iso = String(feature?.properties?.iso_a2 ?? "?").toUpperCase();
  return `${iso}|${image.src ?? ""}|${image.width}x${image.height}`;
}

/**
 * Rasterize the country's boundary into a bbox-sized canvas and draw the
 * matching (brightened) crop of the equirectangular `image` through it, so the
 * result is map imagery inside the country and transparent outside. Returns null
 * where there's no 2d context (SSR / jsdom) — the caller just omits the fill.
 */
function bakeMaskedCanvas(polys: Poly[], bbox: Bbox, image: SourceImage): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const { cw, ch } = canvasSizeFor(bbox, image.width, image.height, MAX_TEX);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Clip to every ring of every part (evenodd cuts holes out).
  ctx.beginPath();
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach((pt, i) => {
        const [x, y] = projectPoint(pt, bbox, cw, ch);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
  ctx.clip("evenodd");

  // Source window in the full equirectangular image (north row first).
  const [w, s, e, n] = bbox;
  const sx = ((w + 180) / 360) * image.width;
  const sy = ((90 - n) / 180) * image.height;
  const sw = ((e - w) / 360) * image.width;
  const sh = ((n - s) / 180) * image.height;
  // Lift it so the country reads as lit, not just recoloured. `filter` is
  // unsupported in jsdom but this path only runs in the browser.
  try {
    ctx.filter = "brightness(1.4) saturate(1.25)";
  } catch {
    /* older/headless canvas — draw ungraded */
  }
  ctx.drawImage(image as unknown as CanvasImageSource, sx, sy, sw, sh, 0, 0, cw, ch);
  return canvas;
}

function maskedCanvasFor(
  feature: { geometry?: Geometry; properties?: { iso_a2?: string } },
  image: SourceImage,
): { canvas: HTMLCanvasElement; bbox: Bbox } | null {
  const allPolys = polysOf(feature.geometry);
  if (!allPolys.length) return null;
  let bbox = unionBbox(allPolys);
  if (!bbox) return null;
  let polys = allPolys;
  if (spansAntimeridian(bbox)) {
    const lp = largestPoly(allPolys);
    if (!lp) return null;
    polys = [lp];
    bbox = unionBbox([lp]);
    if (!bbox) return null;
  }
  const key = cacheKey(feature, image);
  let canvas = bakeCache.get(key);
  if (!canvas) {
    const baked = bakeMaskedCanvas(polys, bbox, image);
    if (!baked) return null;
    canvas = baked;
    bakeCache.set(key, canvas);
  }
  return { canvas, bbox };
}

// DEPTH_PAINT + back-face cull: a country-bbox BitmapLayer is a coarse patch of
// globe quads; depth-testing it diamond-culls the quad centres (satimg.ts's
// documented artifact), so paint over the already-correct depth sphere and drop
// the far-facing triangles geometrically.
const GLOW_PARAMS = { ...DEPTH_PAINT, cullMode: "back" };

/**
 * A breathing map-imagery fill clipped to each spotlighted country. Returns []
 * when there's nothing to glow or the source image hasn't loaded yet (the caller
 * then keeps countryGlow's own cyan fill as a graceful fallback). Recreated each
 * frame with a fresh opacity for the breathe; the canvas underneath is cached.
 */
export function countryMapGlowLayers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[],
  image: SourceImage | null | undefined,
  now: number,
): unknown[] {
  if (!features.length || !image) return [];
  const opacity = 0.7 + 0.3 * glowBreath(now);
  const layers: unknown[] = [];
  for (let i = 0; i < features.length; i++) {
    const baked = maskedCanvasFor(features[i], image);
    if (!baked) continue;
    layers.push(
      new BitmapLayer({
        id: `country-map-glow-${i}`,
        image: baked.canvas,
        bounds: baked.bbox,
        opacity,
        parameters: GLOW_PARAMS,
      }),
    );
  }
  return layers;
}

/** URL → loaded <img>, cached module-wide so every Globe shares one decode. The
 *  source images are same-origin (/data/*.jpg) so the canvas never taints. */
const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadMapImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}
