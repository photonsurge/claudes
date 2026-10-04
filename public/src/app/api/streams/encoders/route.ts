import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAppDb } from "@photonsurge/shared/db/index";
import { ENCODER_USES, ENV_ENCODER_ID, toEncoderInfo, type EncoderUse, type StreamEncoder } from "@photonsurge/shared/runs";
import { encryptSecret, secretboxConfigured } from "@photonsurge/shared/utill/secretbox";
import { requireAdmin } from "../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/streams/encoders — the OBS encoder registry (client-safe projection;
 * the websocket password never leaves the server, only a hasPassword flag).
 */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const encoders = await (await getAppDb()).listStreamEncoders();
  return NextResponse.json({ encoders: encoders.map(toEncoderInfo) }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/streams/encoders — create or update an encoder. The password is
 * WRITE-ONLY: send `password` to (re)set it (stored secretbox-encrypted, same
 * scheme as the YouTube tokens), `clearPassword: true` to drop it, or neither to
 * leave it unchanged.
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: Partial<StreamEncoder> & { password?: string; clearPassword?: boolean } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* falls through to validation */
  }

  const url = String(body.url ?? "").trim();
  if (!/^wss?:\/\//.test(url)) {
    return NextResponse.json(
      { error: "url must be an obs-websocket endpoint (ws://host:port)" },
      { status: 400, headers: NO_CACHE },
    );
  }
  const id = String(body.id ?? "").trim() || randomUUID();
  if (id === ENV_ENCODER_ID) {
    return NextResponse.json(
      { error: `"${ENV_ENCODER_ID}" is reserved for the OBS_WEBSOCKET_URL instance` },
      { status: 400, headers: NO_CACHE },
    );
  }

  const patch: Partial<StreamEncoder> & { id: string } = {
    id,
    url,
    name: body.name ? String(body.name).slice(0, 80) : undefined,
    sceneId: body.sceneId ? String(body.sceneId).trim() : undefined,
    enabled: body.enabled !== false,
  };
  // Assigned to channels (default) or to rendered videos (short-video plan §6.6).
  // Omitted leaves a saved encoder's use as it is.
  if (body.use !== undefined) {
    if (!ENCODER_USES.includes(body.use as EncoderUse)) {
      return NextResponse.json({ error: `use must be one of ${ENCODER_USES.join(", ")}` }, { status: 400, headers: NO_CACHE });
    }
    patch.use = body.use as EncoderUse;
    // A video encoder is bound to no channel (§6.6): clear the binding for real
    // (an undefined key would be dropped from the update and keep the old one),
    // so an unpinned slot can never resolve to it by scene.
    if (patch.use === "videos") patch.sceneId = null as unknown as undefined;
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (!secretboxConfigured()) {
      return NextResponse.json(
        { error: "set APP_SECRET (or SECRETBOX_KEY) before storing an OBS password" },
        { status: 400, headers: NO_CACHE },
      );
    }
    patch.passwordEnc = encryptSecret(body.password);
  } else if (body.clearPassword) {
    patch.passwordEnc = undefined;
  }

  const db = await getAppDb();
  const saved = await db.saveStreamEncoder(patch);
  if (!saved) {
    return NextResponse.json({ error: "failed to save encoder" }, { status: 500, headers: NO_CACHE });
  }
  return NextResponse.json(toEncoderInfo(saved), { status: 200, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
