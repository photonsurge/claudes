/**
 * Texture loading + caching for WeatherLayers.
 *
 * WeatherLayers' `image` prop is a `TextureData` ({ data: Uint8Array, width,
 * height }) — NOT an ImageBitmap. `imageUnscale` (how we decode wind u/v and
 * scalar values from the PNG bytes) only works on Uint8 TextureData, so we load
 * via WeatherLayers' own `loadTextureData`, which decodes a PNG URL into that
 * shape. Textures are immutable per URL (the URL embeds the texture id / a
 * `?v=` bake stamp), so we cache the decoded promise by URL.
 *
 * BOUNDED (LRU) — this is the client's dominant memory leak fix. A 24/7 stream
 * mints new texture URLs without end: every worker run embeds a fresh texture
 * id, the timeline scrubs a run's forecast steps, the map-type tour cycles
 * overlays, and aurora/geomag/satimg re-bake under a new `?v=`. Each decoded
 * value is a full RGBA grid (a global GFS frame is ~4 MB). The old "cache for
 * the page session" Map never evicted, so the tab retained every frame it had
 * ever shown and RSS climbed for the life of the broadcast. We now keep only
 * the last TEXTURE_CACHE_MAX distinct URLs (LRU): the live working set — all
 * vars at the current step + the timeline's preloaded neighbours + the cycling
 * map types + aurora/geomag — stays warm, while old runs'/steps' textures evict
 * and their bytes are freed. This is a MEMORY bound, not a product cap: an
 * evicted texture just reloads transparently on its next request, so it never
 * limits what the globe can display.
 */
"use client";

// Type-only import is erased at compile time, so this file is safe to evaluate
// on the server (it's pulled in by server-rendered Timeline/ControlPanel). The
// actual weatherlayers-gl module references `Worker` at import time and must
// never load during SSR — so we import it lazily, only in the browser.
import type { TextureData } from "weatherlayers-gl";
import { createTextureDecoder } from "./texture-decode-client";

export type LoadedTexture = TextureData;

const cache = new Map<string, Promise<LoadedTexture>>();
/**
 * Max distinct decoded textures held at once. Sized well above the live working
 * set (all manifest vars at one step ~15-20, + the timeline's neighbour steps,
 * + a few cycling map types, + aurora/geomag) so scrubbing and map-cycling stay
 * cache-warm and never evict what's on screen — but bounded so a day-long
 * broadcast can't accumulate every run's frames.
 */
const TEXTURE_CACHE_MAX = 96;

/** Mark `url` most-recently-used (Map iterates in insertion order, so delete +
 *  re-set moves it to the newest slot). Keeps the on-screen/hot set unevictable. */
function touch(url: string, p: Promise<LoadedTexture>): void {
  cache.delete(url);
  cache.set(url, p);
}

/** Drop least-recently-used entries (oldest-first) until back within the cap. */
function evictLru(): void {
  while (cache.size > TEXTURE_CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

let loaderPromise: Promise<(url: string) => Promise<TextureData>> | null = null;
/**
 * The decoder: a worker pool (fetch + decode + readback off the main thread —
 * see texture-decode.worker.ts) where the browser has Workers and
 * OffscreenCanvas, else WeatherLayers' own main-thread `loadTextureData`.
 */
function getLoader(): Promise<(url: string) => Promise<TextureData>> {
  if (!loaderPromise) {
    const worker = createTextureDecoder();
    loaderPromise = worker
      ? Promise.resolve(worker as (url: string) => Promise<TextureData>)
      : import("weatherlayers-gl").then(
          (m) => m.loadTextureData as unknown as (url: string) => Promise<TextureData>,
        );
  }
  return loaderPromise;
}

/**
 * A single texture fetch+decode is given this long before it's treated as
 * failed (dropped from the cache so the next request retries). A hung response
 * — the connection accepted, the body never arriving — has no browser-side
 * timeout at all, and one of those would wedge every "all textures loaded"
 * wait (the /watch cold-start cover) for the life of the page.
 */
export const TEXTURE_LOAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bail = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`texture load timed out after ${ms} ms: ${url}`)), ms);
  });
  return Promise.race([p, bail]).finally(() => clearTimeout(timer));
}

/** Load (or return cached) texture for a URL as WeatherLayers TextureData. */
export function loadTexture(url: string): Promise<LoadedTexture> {
  const existing = cache.get(url);
  if (existing) {
    touch(url, existing); // refresh recency so the live set never evicts
    return existing;
  }
  const p = getLoader()
    .then((load) => withTimeout(load(url), TEXTURE_LOAD_TIMEOUT_MS, url))
    .catch((err) => {
      cache.delete(url); // allow a future retry
      throw err;
    });
  cache.set(url, p);
  evictLru();
  return p;
}

/** Is this URL already resolved/in-flight in cache? */
export function isTextureCached(url: string): boolean {
  return cache.has(url);
}

/** Warm the cache for a list of URLs (e.g. neighbouring timeline steps). */
export function preloadTextures(urls: Array<string | undefined>): void {
  for (const url of urls) {
    // Best-effort cache warming: swallow failures here so a missing/unbaked
    // texture can't surface as an unhandledRejection. `loadTexture` already
    // evicts the failed entry so it retries, and the real on-demand load path
    // (Globe's per-fhr effect) will warn when the texture is actually needed.
    if (url && !cache.has(url)) void loadTexture(url).catch(() => {});
  }
}

/** Test/SSR hook: clear the cache. */
export function clearTextureCache(): void {
  cache.clear();
}
