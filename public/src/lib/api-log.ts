/**
 * Request logging for the public app — "when did it happen, and how long did the
 * request take". Writes one row to the Mongo `logs` collection per API call via
 * the shared `PublicBackLogger` (system already bound to "public"), so entries
 * show up in /admin/logs alongside worker/socket logs.
 *
 * Two hooks, matching the two sides of a request:
 *   - withApiLog(handler)  — the INBOUND side: wraps a Next App-Router route
 *                            handler and logs method / path / status / total ms.
 *   - logDataFetch(key,…)  — the OUTBOUND side: called from `withCache` on a
 *                            cache miss to log the underlying Mongo read + its ms.
 *
 * DISCIPLINE (this runs 24/7 on every request):
 *   - FIRE-AND-FORGET: the log write is never awaited on the response path, so
 *     it can't add latency. PublicBackLogger never throws; we `.catch` anyway.
 *   - KILL SWITCH: set PUBLIC_REQUEST_LOG=0 to disable entirely.
 *   - NOISE GUARD: byte-serving / health routes (textures, media, frame.png,
 *     ping) are skipped by default — they're high-volume and low-signal. Override
 *     the skip pattern with PUBLIC_REQUEST_LOG_EXCLUDE (a regex string; set it to
 *     an empty-matching pattern like "$^" to log everything).
 */
import { PublicBackLogger } from "@photonsurge/shared/utill/BackLogger";
import type { LOG_LEVEL } from "@photonsurge/shared/index";

const ENABLED = process.env.PUBLIC_REQUEST_LOG !== "0";

/** Paths we never log (unless PUBLIC_REQUEST_LOG_EXCLUDE overrides). */
const EXCLUDE = new RegExp(
  process.env.PUBLIC_REQUEST_LOG_EXCLUDE ||
    String.raw`(/tex/|/media/|/ads/[^/]+/media|frame\.png|/ping)`,
);

/**
 * Fire-and-forget write to the `logs` collection. Everything is guarded so a
 * logging problem can never surface to the caller or the response.
 */
function record(
  level: LOG_LEVEL,
  tag: string,
  message: string,
  stuff: Record<string, unknown>,
  targetID: string,
): void {
  if (!ENABLED) return;
  try {
    void Promise.resolve(
      PublicBackLogger("public", level, tag, message, stuff, "request", targetID),
    ).catch(() => {});
  } catch {
    /* never throw out of logging */
  }
}

/** Pull method / path / query off the incoming Request, defensively. */
function reqInfo(req: Request): { method: string; path: string; query: string } {
  try {
    const u = new URL(req.url);
    return {
      method: req.method || "GET",
      path: u.pathname,
      query: u.search ? u.search.slice(1) : "",
    };
  } catch {
    return { method: req?.method || "GET", path: "unknown", query: "" };
  }
}

/**
 * Wrap a Next App-Router route handler so every call logs
 * `METHOD /path → status (Nms)` to Mongo. Signature-preserving: the returned
 * handler has the exact same argument tuple as the one passed in (so dynamic
 * routes keep their typed `{ params }` context and Next's route type-check still
 * passes). The log is emitted after the handler resolves, off the response path.
 */
export function withApiLog<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    const req = args[0] as Request;
    const t0 = Date.now();
    try {
      const res = await handler(...args);
      const ms = Date.now() - t0;
      const { method, path, query } = reqInfo(req);
      if (!EXCLUDE.test(path)) {
        const status = res?.status;
        const cache = res?.headers?.get?.("X-Cache") ?? undefined;
        record(
          status && status >= 500 ? "error" : "info",
          `api:${path}`,
          `${method} ${path} → ${status} (${ms}ms)`,
          { method, path, query, status, ms, cache },
          path,
        );
      }
      return res;
    } catch (err) {
      const ms = Date.now() - t0;
      const { method, path, query } = reqInfo(req);
      if (!EXCLUDE.test(path)) {
        record(
          "error",
          `api:${path}`,
          `${method} ${path} → threw (${ms}ms)`,
          { method, path, query, ms, error: String(err) },
          path,
        );
      }
      throw err; // preserve the route's own error handling
    }
  };
}

/**
 * Log a cache-backed data read (the outbound / "time to do the request" side).
 * Called from `withCache` on a MISS, when real work (a Mongo query / compose)
 * actually ran — hits are silent (they're sub-ms Redis reads, nothing happened).
 */
export function logDataFetch(key: string, ms: number, hit: boolean): void {
  record("info", "api:data", `${key} ${hit ? "hit" : "miss"} (${ms}ms)`, { key, ms, hit }, key);
}
