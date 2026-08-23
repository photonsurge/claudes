import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
import {
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  slugifySceneId,
  MAIN_SCENE_ID,
  type ControlState,
} from "@photonsurge/shared/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/scenes — every broadcast scene as `{ id, name, updatedAt }`. Called
 * unauthenticated by /watch/:id (to resolve a display name), so `watchToken`
 * is only included for an admin session — never leaked to anonymous callers.
 */
async function GET__impl() {
  const db = await getAppDb();
  // Ensure the main scene exists so the list is never empty on a fresh db.
  await db.getOrInitBroadcastState();
  const scenes = await db.listScenes();

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken ? readSession(sessionToken) : null;
  const out = isAdmin(session) ? scenes : scenes.map(({ watchToken: _t, ...rest }) => rest);

  return NextResponse.json({ scenes: out }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/scenes { name, copyFrom? } — create a named scene. The id is slugged
 * from the name; new scenes seed from `copyFrom` (another scene's state) or the
 * current main scene. 409 if the slug already exists, 400 on bad/empty name.
 */
async function POST__impl(req: Request) {
  let body: { name?: string; copyFrom?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body → 400 below */
  }

  const name = String(body.name ?? "").trim();
  const id = slugifySceneId(name);
  if (!name || !id) {
    return NextResponse.json({ error: "a non-empty name is required" }, { status: 400, headers: NO_CACHE });
  }
  if (id === MAIN_SCENE_ID) {
    return NextResponse.json({ error: "that name is reserved" }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  if (await db.getScene(id)) {
    return NextResponse.json({ error: "a scene with that id already exists" }, { status: 409, headers: NO_CACHE });
  }

  // Seed from the requested source scene (default: main), stripped to ControlState.
  const sourceId = body.copyFrom || MAIN_SCENE_ID;
  const source =
    sourceId === MAIN_SCENE_ID
      ? await db.getOrInitBroadcastState()
      : await db.getScene(sourceId);
  const seed: ControlState = mergeControlState(
    DEFAULT_CONTROL_STATE,
    (source ?? {}) as Partial<ControlState>,
  );

  const created = await db.createScene(id, name, seed);

  // Clone the source's director setup too (kinds, countries, areas, holds,
  // looks) — runtime fields stripped: skipNonce reset and mode forced off so a
  // fresh channel never starts auto-piloting itself on air.
  const srcDirector = await db.getOrInitDirectorConfig(sourceId);
  await db.saveDirectorConfig(id, { ...srcDirector, mode: "off", skipNonce: 0 });

  return NextResponse.json(
    { id, name, scene: mergeControlState(DEFAULT_CONTROL_STATE, (created ?? {}) as Partial<ControlState>) },
    { status: 201, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
