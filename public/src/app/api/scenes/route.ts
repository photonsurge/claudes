import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppDb } from "@photonsurge/shared/db/index";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CONTROL_STATE,
  DEFAULT_YOUTUBE_SETTINGS,
  mergeControlState,
  slugifySceneId,
  MAIN_SCENE_ID,
  isSceneSurface,
  type ControlState,
  type SceneSurface,
} from "@photonsurge/shared/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/scenes — every broadcast scene as `{ id, name, updatedAt }`. Called
 * unauthenticated by /watch/:id (to resolve a display name), so `watchToken`
 * and `youtubeAccountId` are only included for an admin session — never leaked to anonymous callers.
 */
async function GET__impl() {
  const db = await getAppDb();
  // Ensure the main scene exists so the list is never empty on a fresh db.
  await db.getOrInitBroadcastState();
  const scenes = await db.listScenes();

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken ? readSession(sessionToken) : null;
  const out = isAdmin(session) ? scenes : scenes.map(({ watchToken: _t, youtubeAccountId: _y, ...rest }) => rest);

  return NextResponse.json({ scenes: out }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/scenes { name, copyFrom?, surface? } — create a named scene. The id is
 * slugged from the name; new scenes seed from `copyFrom` (another scene's state)
 * or the current main scene. `surface` picks the kind of channel ("globe" when
 * left out). 409 if the slug already exists, 400 on bad/empty name or surface.
 */
async function POST__impl(req: Request) {
  let body: { name?: string; copyFrom?: string; surface?: unknown } = {};
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

  if (body.surface !== undefined && !isSceneSurface(body.surface)) {
    return NextResponse.json({ error: "unknown channel type" }, { status: 400, headers: NO_CACHE });
  }
  const surface: SceneSurface = isSceneSurface(body.surface) ? body.surface : "globe";

  const db = await getAppDb();
  if (await db.getScene(id)) {
    return NextResponse.json({ error: "a scene with that id already exists" }, { status: 409, headers: NO_CACHE });
  }

  // Seed from the requested source scene (default: main), stripped to ControlState.
  // A crossword channel copies nothing (plan §3, §10): weather fields stay at
  // their defaults, the music bed and chat are on, and no YouTube channel is
  // chosen (it is picked on the settings page, never guessed).
  const sourceId = surface === "crossword" ? MAIN_SCENE_ID : body.copyFrom || MAIN_SCENE_ID;
  const source =
    surface === "crossword"
      ? null
      : sourceId === MAIN_SCENE_ID
        ? await db.getOrInitBroadcastState()
        : await db.getScene(sourceId);
  const seed: ControlState =
    surface === "crossword"
      ? {
          ...DEFAULT_CONTROL_STATE,
          audio: { ...DEFAULT_AUDIO_SETTINGS, enabled: true },
          chat: { ...DEFAULT_CHAT_SETTINGS, enabled: true },
          youtube: { ...DEFAULT_YOUTUBE_SETTINGS, accountId: "" },
        }
      : mergeControlState(DEFAULT_CONTROL_STATE, (source ?? {}) as Partial<ControlState>);

  const created = await db.createScene(id, name, seed, { surface });

  // A crossword channel has no director (plan §3): its config stays absent, so
  // it reads as the default (off).
  if (surface === "crossword") {
    return NextResponse.json(
      { id, name, surface, scene: mergeControlState(DEFAULT_CONTROL_STATE, (created ?? {}) as Partial<ControlState>) },
      { status: 201, headers: NO_CACHE },
    );
  }

  // Clone the source's director setup too (kinds, countries, areas, holds,
  // looks) — runtime fields stripped: skipNonce reset and mode forced off so a
  // fresh channel never starts auto-piloting itself on air, and the source's
  // script-play trigger dropped (it belongs to the scene that played it).
  const { script: _script, ...srcDirector } = await db.getOrInitDirectorConfig(sourceId);
  await db.saveDirectorConfig(id, { ...srcDirector, mode: "off", skipNonce: 0 });

  return NextResponse.json(
    { id, name, surface, scene: mergeControlState(DEFAULT_CONTROL_STATE, (created ?? {}) as Partial<ControlState>) },
    { status: 201, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
