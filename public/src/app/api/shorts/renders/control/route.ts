import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../lib/require-admin";
import { NO_CACHE } from "../../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTROL_TIMEOUT_MS = 20_000;
const QUEUE_ACTIONS = ["pause", "resume"] as const;
const RENDER_ACTIONS = ["cancel", "retry", "stop"] as const;

/**
 * POST /api/shorts/renders/control — the §6.7 controls:
 *   { action: "pause" | "resume", encoderId }   hold / release an encoder's queue
 *   { action: "cancel" | "retry" | "stop", renderId }
 * Handed to the worker's render queue (`run-lifecycle.renderControl`), which
 * answers with `{ ok, error?, render? }` — a refusal ("only a queued video can
 * be cancelled") comes back as 409 with the worker's reason. Stop ends the live
 * video through the same `run-lifecycle.stop` an operator stop on
 * /admin/streams uses; it records as failed, "stopped by operator".
 */
async function POST__impl(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    /* falls through to validation */
  }
  const action = String(body.action ?? "");
  const encoderId = typeof body.encoderId === "string" ? body.encoderId.trim() : "";
  const renderId = typeof body.renderId === "string" ? body.renderId.trim() : "";
  let data: Record<string, string>;
  if ((QUEUE_ACTIONS as readonly string[]).includes(action)) {
    if (!encoderId) return NextResponse.json({ error: "encoderId is required" }, { status: 400, headers: NO_CACHE });
    data = { action, encoderId };
  } else if ((RENDER_ACTIONS as readonly string[]).includes(action)) {
    if (!renderId) return NextResponse.json({ error: "renderId is required" }, { status: 400, headers: NO_CACHE });
    data = { action, renderId };
  } else {
    return NextResponse.json(
      { error: `action must be one of ${[...QUEUE_ACTIONS, ...RENDER_ACTIONS].join(", ")}` },
      { status: 400, headers: NO_CACHE },
    );
  }
  try {
    const result = await sendToQueueAndWait<{ ok: boolean; error?: string }>(
      "stream",
      "run-lifecycle",
      "renderControl",
      data,
      CONTROL_TIMEOUT_MS,
      undefined,
      { dedupe: false },
    );
    if (!result?.ok)
      return NextResponse.json({ ok: false, error: result?.error ?? "refused" }, { status: 409, headers: NO_CACHE });
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e) },
      { status: 504, headers: NO_CACHE },
    );
  }
}

export const POST = withApiLog(POST__impl);
