import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getFocusBundle } from "../../../lib/focus/getFocusBundle";
import { buildFocusKey } from "../../../lib/focus/focusKey";
import { focusCache } from "../../../lib/focus/focus-cache";
import type { FocusBundle, FocusDetail, FocusRequest } from "../../../lib/focus/types";
import type { SegmentKind } from "@photonsurge/shared/director";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DETAILS: FocusDetail[] = ["broadcast", "admin", "full"];

/**
 * In-flight compose de-duplication (single-flight). When `/watch` opens on
 * several tabs / OBS sources at once they all request the SAME on-air focus key;
 * without this each fires its own getFocusBundle — N parallel composes, each
 * holding history texture frames in RAM (this is what let public spike to ~6GB).
 * Coalescing them onto ONE compose bounds memory to a single compose regardless
 * of viewer count. NOT a cache: entries are deleted the instant the compose
 * settles (finally), so the map only ever holds the handful of keys composing
 * right now — no unbounded growth over a 24/7 run.
 */
const inflight = new Map<string, Promise<FocusBundle>>();

async function composeAndCache(key: string, focusReq: FocusRequest): Promise<FocusBundle> {
  const bundle = await getFocusBundle(focusReq);
  await focusCache.set(key, bundle, 60);
  return bundle;
}

/**
 * GET /api/focus?kind=&lng=&lat=&zoom=&detail=broadcast&subject=
 *
 * The single aggregate endpoint for one on-air "thing" — replaces the 30–80
 * uncoordinated requests a broadcast cut used to fire. Composed once server-side
 * (getFocusBundle), then cached in Redis by the canonical focusKey so recurring
 * cuts are served without re-hitting Mongo. Mongo stays the source of truth;
 * Redis is a disposable, TTL-evicted copy (see focus-cache — fail-open).
 */
async function GET__impl(req: Request) {
  const url = new URL(req.url);
  // Note: parse via the raw string then Number() — `Number(null)` is 0 (finite),
  // so a missing param would otherwise slip past the guard as a valid 0.
  const lngRaw = url.searchParams.get("lng");
  const latRaw = url.searchParams.get("lat");
  const zoomRaw = url.searchParams.get("zoom");
  const kind = (url.searchParams.get("kind") ?? "") as SegmentKind;
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  const zoom = Number(zoomRaw);
  if (
    !kind ||
    lngRaw === null || !Number.isFinite(lng) ||
    latRaw === null || !Number.isFinite(lat) ||
    zoomRaw === null || !Number.isFinite(zoom)
  ) {
    return NextResponse.json({ error: "kind, lng, lat and zoom are required" }, { status: 400 });
  }
  const rawDetail = url.searchParams.get("detail") as FocusDetail | null;
  const detail: FocusDetail = rawDetail && DETAILS.includes(rawDetail) ? rawDetail : "broadcast";
  const subject = url.searchParams.get("subject");

  const focusReq: FocusRequest = { kind, center: [lng, lat], zoom, detail, subject };
  const key = buildFocusKey(focusReq);

  const headers = {
    "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
  };

  const cached = await focusCache.get(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { ...headers, "X-Focus-Cache": "hit" } });
  }

  // Single-flight: reuse an in-flight compose for this key if one exists, else
  // start one. Concurrent viewers of the same on-air shot share ONE compose.
  let coalesced = true;
  let pending = inflight.get(key);
  if (!pending) {
    coalesced = false;
    pending = composeAndCache(key, focusReq).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const bundle = await pending;
  return NextResponse.json(bundle, {
    headers: { ...headers, "X-Focus-Cache": coalesced ? "wait" : "miss" },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
