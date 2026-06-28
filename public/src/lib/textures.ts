/**
 * Texture loading + caching for WeatherLayers.
 *
 * WeatherLayers' `image` prop is a `TextureData` ({ data: Uint8Array, width,
 * height }) — NOT an ImageBitmap. `imageUnscale` (how we decode wind u/v and
 * scalar values from the PNG bytes) only works on Uint8 TextureData, so we load
 * via WeatherLayers' own `loadTextureData`, which decodes a PNG URL into that
 * shape. Textures are immutable per run (the URL embeds the texture id), so we
 * cache the promise by URL for the page session.
 */
"use client";

// Type-only import is erased at compile time, so this file is safe to evaluate
// on the server (it's pulled in by server-rendered Timeline/ControlPanel). The
// actual weatherlayers-gl module references `Worker` at import time and must
// never load during SSR — so we import it lazily, only in the browser.
import type { TextureData } from "weatherlayers-gl";

export type LoadedTexture = TextureData;

const cache = new Map<string, Promise<LoadedTexture>>();

let loaderPromise: Promise<(url: string) => Promise<TextureData>> | null = null;
function getLoader(): Promise<(url: string) => Promise<TextureData>> {
  if (!loaderPromise) {
    loaderPromise = import("weatherlayers-gl").then(
      (m) => m.loadTextureData as unknown as (url: string) => Promise<TextureData>,
    );
  }
  return loaderPromise;
}

/** Load (or return cached) texture for a URL as WeatherLayers TextureData. */
export function loadTexture(url: string): Promise<LoadedTexture> {
  let p = cache.get(url);
  if (!p) {
    p = getLoader()
      .then((load) => load(url))
      .catch((err) => {
        cache.delete(url); // allow a future retry
        throw err;
      });
    cache.set(url, p);
  }
  return p;
}

/** Is this URL already resolved/in-flight in cache? */
export function isTextureCached(url: string): boolean {
  return cache.has(url);
}

/** Warm the cache for a list of URLs (e.g. neighbouring timeline steps). */
export function preloadTextures(urls: Array<string | undefined>): void {
  for (const url of urls) {
    if (url && !cache.has(url)) void loadTexture(url);
  }
}

/** Test/SSR hook: clear the cache. */
export function clearTextureCache(): void {
  cache.clear();
}
