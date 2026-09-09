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
import { godsLog } from "./globe-log";

export type LoadedTexture = TextureData;

const cache = new Map<string, Promise<LoadedTexture>>();
/**
 * Max distinct decoded textures held at once. Sized well above the live working
 * set (all manifest vars at one step ~15-20, + the timeline's neighbour steps,
 * + a few cycling map types, + aurora/geomag) so scrubbing and map-cycling stay
 * cache-warm and never evict what's on screen — but bounded so a day-long
 * broadcast can't accumulate every run's frames.
 */
const DEFAULT_TEXTURE_CACHE_MAX = 256;
/**
 * The cache is bounded by BYTES as well as by entry count, because the entries
 * are nowhere near equal. The 2026-09-09 23:27 run's texture log:
 *
 *     4500×2250   38.6 MB  ×6
 *     4979×1913   36.3 MB  ×5
 *     1440×721     4.0 MB  ×15
 *     241×151      0.1 MB  ×1
 *
 * — a 400× spread, and ~900 MB across ~100 textures in one session. A count cap
 * alone is therefore meaningless as a memory bound: 256 of the small ones is
 * 1 GB, 256 of the big ones is 10 GB. The OBS box has 32 GB and runs 3–4
 * browser sources, so budget per source, not per entry.
 */
const DEFAULT_TEXTURE_CACHE_MB = 1536;

/**
 * Parse the `NEXT_PUBLIC_TEXTURE_CACHE_MAX` override (Next inlines it at build
 * time). Exported for the test; a missing or nonsense value keeps the default.
 */
export function cacheMaxFrom(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_TEXTURE_CACHE_MAX;
}

/** Parse `NEXT_PUBLIC_TEXTURE_CACHE_MB` into a byte budget. */
export function cacheBytesFrom(raw: string | undefined): number {
  const n = Number(raw);
  return (Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_TEXTURE_CACHE_MB) * 1048576;
}

/**
 * Raised from 96 (2026-09-10): the OBS box has 32 GB of RAM and is short of CPU
 * and disk — 3–4 browser sources max the CPU out — so a re-fetch and re-decode
 * of a texture we already had is the expensive kind of miss, and holding it is
 * the cheap kind of cost. The warm set is now every variable's base map AND
 * every regional nest at the active hour (`allTextureUrlsFor`), which alone can
 * approach the old cap and would have thrashed against it. A decoded global
 * 0.25° frame is ~4 MB, so 256 is ~1 GB worst case per source, ~4 GB across
 * four. Tune with `NEXT_PUBLIC_TEXTURE_CACHE_MAX` without a code change.
 */
const TEXTURE_CACHE_MAX = cacheMaxFrom(process.env.NEXT_PUBLIC_TEXTURE_CACHE_MAX);
const TEXTURE_CACHE_MAX_BYTES = cacheBytesFrom(process.env.NEXT_PUBLIC_TEXTURE_CACHE_MB);

/** Decoded size per cached URL, recorded as each load resolves. */
const bytesByUrl = new Map<string, number>();
export const textureBytes = (t: LoadedTexture | undefined): number =>
  (t as unknown as { data?: { byteLength?: number } } | undefined)?.data?.byteLength ?? 0;
const cachedBytes = (): number => {
  let n = 0;
  for (const b of bytesByUrl.values()) n += b;
  return n;
};

/** Mark `url` most-recently-used (Map iterates in insertion order, so delete +
 *  re-set moves it to the newest slot). Keeps the on-screen/hot set unevictable. */
function touch(url: string, p: Promise<LoadedTexture>): void {
  cache.delete(url);
  cache.set(url, p);
}

/** Drop least-recently-used entries (oldest-first) until back within BOTH caps.
 *  Bytes are only known for entries that have resolved; an in-flight load counts
 *  as zero and is bounded by the entry cap until it lands. */
function evictLru(): void {
  while (cache.size > TEXTURE_CACHE_MAX || (cachedBytes() > TEXTURE_CACHE_MAX_BYTES && cache.size > 1)) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
    bytesByUrl.delete(oldest);
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

/**
 * The two worst stalls of the 2026-09-09 raster run were a single synchronous
 * `texSubImage2D` each (368 ms and 399 ms) — one texture landing on the GPU,
 * with almost no JS beside it (docs/watch-perf-plan.md, round 32). A global GFS
 * frame is ~4 MB of RGBA and should upload in single-digit ms, so the size of
 * whatever is actually being uploaded is the question, and nothing in a CPU
 * profile or a trace carries a texture's dimensions. One `[globe]` line per
 * newly decoded URL names it: textures are immutable per URL and cached, so
 * this is one line per distinct texture, not per frame.
 */
export function textureSizeLine(url: string, t: LoadedTexture): string {
  const { width = 0, height = 0 } = t ?? {};
  // `data` is a typed array (Uint8 for our PNG decodes, Float32 for a float
  // raster — worth seeing, since that is 4× the bytes for the same grid).
  const bytes = (t as unknown as { data?: { byteLength?: number } } | undefined)?.data?.byteLength ?? 0;
  const name = url.split("?")[0].split("/").pop() || url;
  return `[globe] texture ${name} ${width}×${height} ${(bytes / 1048576).toFixed(1)} MB`;
}

const logTextureSize =
  (url: string) =>
  (t: LoadedTexture): LoadedTexture => {
    godsLog(textureSizeLine(url, t));
    // Now its real weight is known, so the byte budget can act on it.
    if (cache.has(url)) {
      bytesByUrl.set(url, textureBytes(t));
      evictLru();
    }
    return t;
  };

/** Load (or return cached) texture for a URL as WeatherLayers TextureData. */
export function loadTexture(url: string): Promise<LoadedTexture> {
  const existing = cache.get(url);
  if (existing) {
    touch(url, existing); // refresh recency so the live set never evicts
    return existing;
  }
  const p = getLoader()
    .then((load) => withTimeout(load(url), TEXTURE_LOAD_TIMEOUT_MS, url))
    .then(logTextureSize(url))
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
  bytesByUrl.clear();
}
