/**
 * Client geocode wrapper around `/api/geocode`, with a small in-memory cache and
 * a debounced search helper. The normalisation shape mirrors the API route.
 */
"use client";

export interface GeocodeResult {
  /** [lng, lat] */
  center: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  label: string;
}

const cache = new Map<string, GeocodeResult | null>();

/** Fetch + cache a single geocode hit (or null when no result). */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q) ?? null;

  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      cache.set(q, null);
      return null;
    }
    const json = await res.json();
    const result = json && json.center ? (json as GeocodeResult) : null;
    cache.set(q, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Returns a debounced geocode caller. `wait` ms after the last call, the latest
 * query is geocoded and the callback invoked.
 */
export function makeDebouncedGeocode(
  cb: (result: GeocodeResult | null) => void,
  wait = 350,
): (query: string) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (query: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      cb(await geocode(query));
    }, wait);
  };
}
