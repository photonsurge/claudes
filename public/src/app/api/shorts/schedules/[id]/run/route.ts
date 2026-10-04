import { withApiLog } from "../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import type { ShortRender } from "@photonsurge/shared/short-render";
import { sanitizePublishAs } from "@photonsurge/shared/short-schedule";
import { requireAdmin } from "../../../../../../lib/require-admin";
import { NO_CACHE } from "../../../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** How long to wait for the worker to queue the batch (it only writes renders). */
const RUN_TIMEOUT_MS = 30_000;

type RunBatchResult =
  | { ok: true; scheduleId: string; batchId: string; n: number; renders: ShortRender[] }
  | { ok: false; error: string };

/**
 * POST /api/shorts/schedules/:id/run { publishAs? } — "Run batch now" (§6.7,
 * §8.1 step 5): queue the schedule's videos immediately, enabled or not,
 * without touching its next time. `publishAs` (public · unlisted · private)
 * overrides every video's privacy for this batch only — the first trial run of
 * a new schedule goes out unlisted. The worker queues (`short-video.runBatch`);
 * the renders then run like any other.
 *  • 201 `{ ok, batchId, n, renders }` · 400 bad publishAs, no videos · 404 · 504 no answer
 */
async function POST__impl(req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "admin only" }, { status: 401, headers: NO_CACHE });
  }
  const { id } = await params;
  let body: { publishAs?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* no body: no override */
  }
  const publishAs = sanitizePublishAs(body.publishAs);
  if (body.publishAs != null && body.publishAs !== "" && !publishAs) {
    return NextResponse.json({ error: "publishAs must be public, unlisted or private" }, { status: 400, headers: NO_CACHE });
  }
  try {
    const result = await sendToQueueAndWait<RunBatchResult>(
      "shorts",
      "short-video",
      "runBatch",
      { scheduleId: id, ...(publishAs ? { publishAs } : {}) },
      RUN_TIMEOUT_MS,
    );
    if (!result?.ok) {
      const error = result?.error ?? "the worker did not queue the batch";
      return NextResponse.json({ error }, { status: error === "no such schedule" ? 404 : 400, headers: NO_CACHE });
    }
    return NextResponse.json(result, { status: 201, headers: NO_CACHE });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/timed out before finishing/i.test(msg)) {
      return NextResponse.json(
        { error: `No answer from the worker after ${RUN_TIMEOUT_MS / 1000}s — it may be busy or not running.` },
        { status: 504, headers: NO_CACHE },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
