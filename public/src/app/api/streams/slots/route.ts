import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAppDb } from "@photonsurge/shared/db/index";
import { MAIN_SCENE_ID } from "@photonsurge/shared/control";
import { ENV_ENCODER_ID, SLOT_RESTART_MIN_MS, type StreamSlot, type YoutubePrivacy } from "@photonsurge/shared/runs";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const PRIVACIES: YoutubePrivacy[] = ["public", "unlisted", "private"];

/** GET /api/streams/slots — every persistent-stream slot (no secrets on a slot). */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const slots = await (await getAppDb()).listStreamSlots();
  return NextResponse.json({ slots }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/streams/slots — create or update a persistent-stream slot. Toggling
 * `enabled` here IS the on/off switch for the constant stream: the worker
 * reconciler starts a run for an enabled slot within a sweep, and ends the
 * slot's run when disabled.
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: Partial<StreamSlot> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* falls through to validation */
  }

  const sceneId = String(body.sceneId ?? "").trim();
  if (!sceneId) {
    return NextResponse.json({ error: "sceneId is required" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const scene = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  if (!scene) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }

  const encoderId = body.encoderId ? String(body.encoderId).trim() : undefined;
  if (encoderId && encoderId !== ENV_ENCODER_ID && !(await db.getStreamEncoder(encoderId))) {
    return NextResponse.json({ error: `no such encoder "${encoderId}"` }, { status: 400, headers: NO_CACHE });
  }

  // Scheduled recycle cadence; 0 / absent = never. Clamped to the floor so a
  // tiny interval can't outrun the reconciler's health/backoff bookkeeping.
  const restartRaw = Number(body.restartEveryMs ?? 0);
  const restartEveryMs =
    Number.isFinite(restartRaw) && restartRaw > 0 ? Math.max(restartRaw, SLOT_RESTART_MIN_MS) : null;

  const saved = await db.saveStreamSlot({
    id: String(body.id ?? "").trim() || randomUUID(),
    name: body.name ? String(body.name).slice(0, 80) : undefined,
    sceneId,
    encoderId,
    accountId: body.accountId ? String(body.accountId).trim() : undefined,
    title: body.title ? String(body.title).slice(0, 100) : undefined,
    privacy: PRIVACIES.includes(body.privacy as YoutubePrivacy) ? (body.privacy as YoutubePrivacy) : "public",
    enabled: body.enabled === true,
    monitorStream: !!body.monitorStream,
    chat: { enabled: body.chat?.enabled !== false, promoteToTicker: !!body.chat?.promoteToTicker },
    restartEveryMs,
  });
  if (!saved) {
    return NextResponse.json({ error: "failed to save slot" }, { status: 500, headers: NO_CACHE });
  }
  return NextResponse.json(saved, { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
