import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { encoderUse, toRunState, type Run } from "@photonsurge/shared/runs";
import {
  ANY_ENCODER,
  renderIsFinished,
  sanitizeRenderRequest,
  type ShortRender,
} from "@photonsurge/shared/short-render";
import { playFor, type ShortScript } from "@photonsurge/shared/short-script";
import { requireAdmin } from "../../../../lib/require-admin";
import type { RenderQueueRow, RenderRow, RendersResponse } from "../../../../lib/renders";
import { scopeLabel } from "../../../../lib/shorts-labels";
import { NO_CACHE } from "../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many finished renders the list keeps (§6.7 "recent renders stay listed"). */
export const RECENT_RENDERS = 40;
/** How long the operator waits on the worker to queue a video. */
const QUEUE_TIMEOUT_MS = 30_000;

const isWaitTimeout = (msg: string) => /timed out before finishing/i.test(msg);

/**
 * GET /api/shorts/renders — the Renders section (§6.7): every unfinished
 * render plus the recent finished ones, newest first, each with its run
 * (secret-free) and, while it plays, the script's play on the run's scene;
 * and one queue header per video encoder (plus any encoder or pool with videos
 * in it), with its pause flag.
 */
async function GET__impl() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const [open, recent, paused, encoders] = await Promise.all([
    db.shortRenders.list({ status: ["queued", "preparing", "live"] }),
    db.shortRenders.list({ recent: RECENT_RENDERS }),
    db.shortRenders.pausedEncoders(),
    db.listStreamEncoders(),
  ]);
  const byId = new Map<string, ShortRender>();
  for (const r of [...open, ...recent]) byId.set(r.id, r);
  const renders = [...byId.values()].sort((a, b) => b.queuedAt - a.queuedAt);

  const scripts = new Map<string, ShortScript | null>();
  const scriptOf = async (id: string) => {
    if (!scripts.has(id)) scripts.set(id, await db.shortScripts.get(id).catch(() => null));
    return scripts.get(id) ?? null;
  };

  const rows: RenderRow[] = [];
  for (const r of renders) {
    const row: RenderRow = { ...r };
    const scriptId = r.scriptId ?? (r.what.type === "script" ? r.what.scriptId : undefined);
    const script = scriptId ? await scriptOf(scriptId) : null;
    if (script) row.label = script.title;
    else if (r.what.type === "generate")
      row.label = r.what.scope.type === "auto" ? `Busiest ${r.what.scope.of}` : scopeLabel(r.what.scope);
    const run = r.runId ? ((await db.getRun(r.runId).catch(() => null)) as Run | null) : null;
    if (run) {
      row.run = toRunState(run);
      const play = script ? playFor(script, run.sceneId) : undefined;
      // The play is this run's only when it answered the run's nonce (or names the run).
      if (
        play &&
        (play.runId === run.id || (run.script?.playNonce != null && play.playNonce === run.script.playNonce))
      ) {
        row.play = {
          startedAt: play.startedAt,
          endedAt: play.endedAt,
          clips: play.clips.map((c) => ({ startMs: c.startMs, durationMs: c.durationMs })),
        };
      }
    }
    rows.push(row);
  }

  // Queue headers: every video encoder, then any other encoder or pool that has videos waiting or rendering.
  const pausedSet = new Set(paused);
  const queues: RenderQueueRow[] = encoders
    .filter((e) => encoderUse(e) === "videos")
    .map((e) => ({ encoderId: e.id, name: e.name, use: "videos" as const, paused: pausedSet.has(e.id) }));
  const listed = new Set(queues.map((q) => q.encoderId));
  for (const r of renders) {
    if (renderIsFinished(r.status)) continue;
    const key = r.encoderId || ANY_ENCODER;
    if (listed.has(key)) continue;
    listed.add(key);
    const enc = encoders.find((e) => e.id === key);
    queues.push({
      encoderId: key,
      name: key === ANY_ENCODER ? "Any video encoder" : enc?.name,
      use: enc ? encoderUse(enc) : undefined,
      paused: pausedSet.has(key),
    });
  }

  const body: RendersResponse = { renders: rows, queues };
  return NextResponse.json(body, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/shorts/renders — queue a video (the Render form, §6.1). The body
 * is a ShortRenderRequest, sanitised here and again by the worker; the
 * worker's render queue stores it and advances at once.
 *
 *  • 201 `{ ok: true, render }` — queued (it may already be preparing).
 *  • 400 — not a render request.  • 422 — the worker refused it.
 *  • 504 — no answer in time (the worker may be down).
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* falls through to validation */
  }
  const request = sanitizeRenderRequest(body);
  if (!request) {
    return NextResponse.json(
      { error: 'a render needs what to make: { type: "script", scriptId } or { type: "generate", formatId, scope }' },
      { status: 400, headers: NO_CACHE },
    );
  }
  try {
    // Never deduplicated: queuing the same script twice is two videos.
    const result = await sendToQueueAndWait<{ ok: boolean; error?: string; render?: ShortRender }>(
      "stream",
      "run-lifecycle",
      "renderQueue",
      { request },
      QUEUE_TIMEOUT_MS,
      undefined,
      { dedupe: false },
    );
    if (!result?.ok)
      return NextResponse.json(
        { error: result?.error ?? "the worker refused the render" },
        { status: 422, headers: NO_CACHE },
      );
    return NextResponse.json(result, { status: 201, headers: NO_CACHE });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (isWaitTimeout(msg)) {
      return NextResponse.json(
        { error: `No answer from the worker after ${QUEUE_TIMEOUT_MS / 1000}s — it may be busy or not running.` },
        { status: 504, headers: NO_CACHE },
      );
    }
    return NextResponse.json({ error: msg }, { status: 422, headers: NO_CACHE });
  }
}

export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
