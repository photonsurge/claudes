import { NextResponse } from "next/server";
import { getQueue } from "@photonsurge/shared/bull/bull";

/**
 * Short-TTL Redis response cache for read-only GET routes.
 *
 * WHY: the public Next server is a single process. Every uncached
 * `force-dynamic` read re-queries Mongo AND re-serializes the result on every
 * request — so N live clients polling the same feed cost N× the Mongo reads and
 * N× the JSON work, which is what pegs the process. This collapses that to ONE
 * Mongo read + serialize per `ttlSec`, no matter how many clients ask.
 *
 * KEY DETAIL: the cache stores the *already-stringified JSON*. On a hit we hand
 * that string straight back as the body — no Mongo, and crucially no re-parse /
 * re-stringify (the dominant CPU cost for big payloads like the 300-city set or
 * the manifest). Mongo stays the source of truth; Redis is a disposable,
 * TTL-evicted copy — every write uses EX so keys evict themselves.
 *
 * FAIL-OPEN: any Redis error degrades to building fresh, never an error. Reuses
 * the shared BullMQ ioredis connection (same client focus-cache uses).
 */
async function redis() {
  return getQueue().client;
}

export async function cachedJson(
  key: string,
  ttlSec: number,
  build: () => Promise<unknown>,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Let a shared cache (nginx/CDN) and the browser reuse it too — an edge hit
    // never even reaches Node. stale-while-revalidate keeps it serving instantly
    // across the TTL boundary.
    "Cache-Control": `public, max-age=${ttlSec}, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 4}`,
  };

  try {
    const hit = await (await redis()).get(key);
    if (hit) {
      return new NextResponse(hit, { headers: { ...headers, "X-Cache": "hit" } });
    }
  } catch (err) {
    console.warn(`[response-cache] get failed for ${key}:`, err);
  }

  const data = await build();
  const body = JSON.stringify(data);
  try {
    await (await redis()).set(key, body, "EX", ttlSec);
  } catch (err) {
    console.warn(`[response-cache] set failed for ${key}:`, err);
  }
  return new NextResponse(body, { headers: { ...headers, "X-Cache": "miss" } });
}
