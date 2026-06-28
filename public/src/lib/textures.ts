/**
 * Texture loading + caching for WeatherLayers.
 *
 * Textures are immutable per run (the URL embeds the texture id), so we cache by
 * URL forever within a page session. WeatherLayers accepts an HTMLImageElement /
 * ImageBitmap as its `image` prop; we load PNGs into ImageBitmap when available,
 * falling back to HTMLImageElement.
 */
"use client";

export type LoadedTexture = ImageBitmap | HTMLImageElement;

const cache = new Map<string, Promise<LoadedTexture>>();

async function loadImage(url: string): Promise<LoadedTexture> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`texture fetch failed: ${url} (${res.status})`);
  const blob = await res.blob();
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  // Fallback for environments without createImageBitmap.
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image decode failed: ${url}`));
    img.src = URL.createObjectURL(blob);
  });
}

/** Load (or return cached) texture for a URL. */
export function loadTexture(url: string): Promise<LoadedTexture> {
  let p = cache.get(url);
  if (!p) {
    p = loadImage(url).catch((err) => {
      cache.delete(url); // allow retry on failure
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
