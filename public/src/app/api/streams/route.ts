import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { MAIN_SCENE_ID } from "@photonsurge/shared/control";
import {
  ENV_ENCODER_ID,
  toEncoderInfo,
  toRunState,
  type CreateRunRequest,
  type Run,
  type YoutubePrivacy,
} from "@photonsurge/shared/runs";
import { requireAdmin } from "../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const PRIVACIES: YoutubePrivacy[] = ["public", "unlisted", "private"];

/** Platform-config status the operator UI needs to render its controls. */
function platformStatus() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_SECRET || process.env.YOUTUBE_CLIENT_SECRET;
  return {
    youtubeConfigured: !!(clientId && clientSecret),
    obsConfigured: !!process.env.OBS_WEBSOCKET_URL,
  };
}

/**
 * GET /api/streams — cold-start snapshot for /admin/streams + the /control panel:
 * every run (secret-free projection), connected YouTube channels, the encoder
 * registry (no password material), persistent slots, and whether OBS / YouTube
 * are configured. Live updates thereafter arrive over the socket (run:state).
 */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const [runs, accounts, encoders, slots] = await Promise.all([
    db.listRuns(),
    db.listYoutubeAccounts(),
    db.listStreamEncoders(),
    db.listStreamSlots(),
  ]);
  const status = platformStatus();
  return NextResponse.json(
    {
      ...status,
      // "Configured" now means EITHER the legacy env OBS or a registered encoder.
      obsConfigured: status.obsConfigured || encoders.some((e) => e.enabled),
      accounts: accounts.map((a) => ({ channelId: a.id, channelTitle: a.channelTitle, connectedAt: a.connectedAt })),
      encoders: encoders.map(toEncoderInfo),
      slots,
      runs: runs.map((r) => toRunState(r as Run)),
    },
    { status: 200, headers: NO_CACHE },
  );
}

/**
 * POST /api/streams — create + start a run on a scene. Persists the Run doc, then
 * enqueues the worker `run-lifecycle.goLive` job (the worker holds the OBS/YouTube
 * credentials; public only enqueues). One active run per scene.
 */
async function POST__impl(req: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }

  let body: CreateRunRequest = { sceneId: "" };
  try {
    body = (await req.json()) ?? { sceneId: "" };
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

  // One active run per scene — a second would fight over the scene's control state.
  const active = await db.activeRunForScene(sceneId);
  if (active) {
    return NextResponse.json(
      { error: "a run is already active on this scene", runId: active.id },
      { status: 409, headers: NO_CACHE },
    );
  }

  // Encoder pick: explicit request → validated registry entry; otherwise the
  // encoder whose OBS instance captures this scene; otherwise unset, which the
  // worker resolves to the legacy env OBS (or a manual key handoff).
  let encoderId = body.encoderId ? String(body.encoderId).trim() : undefined;
  if (encoderId && encoderId !== ENV_ENCODER_ID) {
    const enc = await db.getStreamEncoder(encoderId);
    if (!enc) {
      return NextResponse.json({ error: `no such encoder "${encoderId}"` }, { status: 400, headers: NO_CACHE });
    }
    if (!enc.enabled) {
      return NextResponse.json({ error: `encoder "${encoderId}" is disabled` }, { status: 400, headers: NO_CACHE });
    }
  } else if (!encoderId) {
    encoderId = (await db.encoderForScene(sceneId))?.id;
  }

  // YouTube channel pick: explicit request → that connected account; otherwise the
  // default (most-recently-connected) account. Resolved once and reused below.
  const requestedAccountId = body.accountId ? String(body.accountId).trim() : undefined;
  const publishYoutube = body.platforms?.youtube === true;
  let publishAccountId: string | undefined;
  if (publishYoutube) {
    // One OBS instance = one streaming output. Concurrency comes from publishing
    // through DIFFERENT encoders (the registry) — a second run on the same one
    // would silently hijack its stream key, so it is refused per encoder.
    const encoderBusy = await db.activeRunForEncoder(encoderId ?? ENV_ENCODER_ID);
    if (encoderBusy) {
      return NextResponse.json(
        {
          error:
            `Encoder "${encoderId ?? ENV_ENCODER_ID}" is already streaming scene "${encoderBusy.sceneId}" — ` +
            `one OBS instance supports one concurrent stream. Stop that run or pick another encoder.`,
          runId: encoderBusy.id,
        },
        { status: 409, headers: NO_CACHE },
      );
    }
    if (!platformStatus().youtubeConfigured) {
      return NextResponse.json({ error: "YouTube is not configured on the server" }, { status: 400, headers: NO_CACHE });
    }
    const account = await db.getYoutubeAccount(requestedAccountId);
    if (!account) {
      return NextResponse.json(
        {
          error: requestedAccountId
            ? `YouTube channel "${requestedAccountId}" is not connected`
            : "connect a YouTube channel first",
        },
        { status: 400, headers: NO_CACHE },
      );
    }
    publishAccountId = account.id;
  }

  const durationMs =
    typeof body.durationMs === "number" && body.durationMs > 0 ? Math.floor(body.durationMs) : null;
  const privacy: YoutubePrivacy = PRIVACIES.includes(body.privacy as YoutubePrivacy)
    ? (body.privacy as YoutubePrivacy)
    : "unlisted";

  const platforms: Run["platforms"] = {};
  if (publishYoutube) {
    platforms.youtube = { accountId: publishAccountId, monitorStream: !!body.monitorStream };
  }
  if (body.platforms?.twitch) platforms.twitch = { channelLogin: String(body.platforms.twitch), chatOnly: true };
  if (body.platforms?.kick) platforms.kick = { channelSlug: String(body.platforms.kick), chatOnly: true };

  const run = await db.createRun({
    sceneId,
    encoderId,
    status: "scheduled",
    phase: "created",
    title: body.title ? String(body.title).slice(0, 100) : undefined,
    privacy,
    durationMs,
    platforms,
    chat: { enabled: !!body.chat?.enabled, promoteToTicker: !!body.chat?.promoteToTicker },
    createdBy: session.email,
  });
  if (!run) {
    return NextResponse.json({ error: "failed to create run" }, { status: 500, headers: NO_CACHE });
  }

  await sendToFore("stream", "run-lifecycle", "goLive", { runId: run.id });
  return NextResponse.json(toRunState(run as Run), { status: 201, headers: NO_CACHE });
}

export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
