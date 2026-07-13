/**
 * Redis result-cache for composed focus bundles. Mongo stays the source of
 * truth; this holds a disposable, TTL-evicted copy so recurring cuts (the
 * director cycles the same "things" back on air) are served sub-ms without
 * re-composing from Mongo.
 *
 * Reuses the BullMQ ioredis connection (`getQueue().client`) — no new
 * dependency. This is the repo's first cache helper.
 *
 * MEMORY DISCIPLINE (this runs 24/7):
 *   - Every write uses `EX` (TTL) — keys evict themselves, never SET without
 *     expiry. Live-key count is bounded by things-on-air-per-minute.
 *   - No in-process cache/Map — the only store is Redis.
 *   - FAIL-OPEN: any Redis error is treated as a miss (get) or no-op (set), so a
 *     Redis outage degrades to composing from Mongo, never an error.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { logDataFetch } from "../api-log";

async function client() {
  // BullMQ Queue.client resolves to the shared ioredis instance.
  return getQueue().client;
}

export async function get<T>(key: string): Promise<T | null> {
  try {
    const raw = await (await client()).get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[focus-cache] get failed for ${key}:`, err);
    return null;
  }
}

export async function set(key: string, value: unknown, ttlSec: number): Promise<void> {
  try {
    await (await client()).set(key, JSON.stringify(value), "EX", ttlSec);
  } catch (err) {
    console.warn(`[focus-cache] set failed for ${key}:`, err);
  }
}

export const focusCache = { get, set };

/**
 * In-process single-flight for withCache computes. Concurrent callers that MISS
 * the same key share ONE compute instead of each running their own.
 *
 * Without this, a cold/just-expired cache triggers a THUNDERING HERD: every
 * overlay poll, world-watch, OBS source and tab hits the same heavy feed key at
 * once, and each independently loads its full result into the heap — for
 * `/api/alerts?active=1&limit=5000` that's every active alert's polygon geometry,
 * ×N concurrent requests. A fresh `public` (cold Redis) made the whole fleet miss
 * simultaneously → millions of coordinate arrays retained by the parked compute
 * closures → OOM in seconds. Coalescing bounds it to ONE compute per key
 * regardless of fan-in. Entries are deleted the instant the compute settles, so
 * the map only ever holds the handful of keys computing right now.
 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Default TTL (seconds) for the always-on global feed caches (alerts / quakes /
 * volcanoes). Short by design: those feeds refresh on worker-ingest socket beats
 * (minutes apart), so a ~10m Redis hold keeps staleness bounded while collapsing
 * repeated polls, nearby recurring camera cuts, overlay/world-watch duplicate
 * fetches, and every
 * extra tab/OBS source onto one sub-ms read instead of a fresh Mongo query (and,
 * for alerts, the O(n²) cross-source clustering). Tune with FEED_CACHE_TTL_SEC.
 */
export const FEED_TTL_SEC = Number(process.env.FEED_CACHE_TTL_SEC || 600);

/**
 * Read-through cache: return the cached value for `key`, else run `compute`,
 * cache it for `ttlSec`, and return it. FAIL-OPEN end to end — a Redis outage
 * just runs `compute` (so the route degrades to a live Mongo read, never errors
 * on the cache). `compute` errors propagate (the caller keeps its own error
 * handling); only successful values are cached. Returns `hit` so the route can
 * stamp an `X-Cache` header.
 */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  compute: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const cached = await get<T>(key);
  if (cached !== null) return { value: cached, hit: true };

  // MISS. Coalesce onto an in-flight compute for this key if one exists, so a
  // herd of simultaneous misses can't each load the full result into the heap.
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return { value: await existing, hit: false };

  // We're the leader: run the real work ONCE, cache it, and let the followers
  // above ride our promise. Time the compute (the "time to do the request") and
  // log it; hits stay silent (sub-ms Redis reads, nothing happened upstream).
  const p = (async (): Promise<T> => {
    const t0 = Date.now();
    const value = await compute();
    logDataFetch(key, Date.now() - t0, false);
    await set(key, value, ttlSec);
    return value;
  })();
  inflight.set(key, p);
  try {
    return { value: await p, hit: false };
  } finally {
    inflight.delete(key); // settled (resolved OR rejected) → drop it, never leak keys
  }
}
