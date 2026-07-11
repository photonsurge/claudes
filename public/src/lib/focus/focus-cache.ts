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
