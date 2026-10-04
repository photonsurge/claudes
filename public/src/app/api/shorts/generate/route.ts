import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { sanitizeInclude, sanitizeScope } from "@photonsurge/shared/short-script";
import { requireAdmin } from "../../../../lib/require-admin";
import type { GenerateShortResult } from "../../../../lib/shorts";
import { NO_CACHE } from "../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long the operator waits on the worker. Generating is a handful of Mongo
 * reads, but the job queues on the mid tier behind normal ingest, and a failing
 * job is retried (attempts: 3) before its error comes back.
 */
const GENERATE_TIMEOUT_MS = 90_000;

/** BullMQ's waitUntilFinished timeout ("Job wait … timed out before finishing …"). */
const isWaitTimeout = (msg: string) => /timed out before finishing/i.test(msg);

/**
 * POST /api/shorts/generate { scope, include?, budgetMs?, title? } — write a
 * draft script from the lineup template. The worker does the work
 * (`short-video.generate`); this enqueues it and waits for the result.
 *
 *  • 200 `{ id, title, clips, durationMs }` — the saved draft.
 *  • 422 `{ error }` — the job failed; `error` is the worker's message verbatim
 *    ("No usable round-up for Japan …"), since it says what to fix.
 *  • 504 `{ error }` — no answer in time. The job may still finish and save.
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

  const scope = sanitizeScope(body.scope);
  if (!scope) {
    return NextResponse.json(
      { error: 'scope must be { type: "country" | "area", id } or { type: "globe" }' },
      { status: 400, headers: NO_CACHE },
    );
  }
  const data: Record<string, unknown> = { scope, include: sanitizeInclude(body.include) };
  if (typeof body.budgetMs === "number" && Number.isFinite(body.budgetMs) && body.budgetMs > 0) data.budgetMs = body.budgetMs;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title) data.title = title;

  try {
    const result = await sendToQueueAndWait<GenerateShortResult>("shorts", "short-video", "generate", data, GENERATE_TIMEOUT_MS);
    return NextResponse.json(result, { status: 200, headers: NO_CACHE });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (isWaitTimeout(msg)) {
      return NextResponse.json(
        {
          error:
            `No answer from the worker after ${GENERATE_TIMEOUT_MS / 1000}s — it may be busy or not running. ` +
            `If the job finishes later, the script appears in the list.`,
        },
        { status: 504, headers: NO_CACHE },
      );
    }
    return NextResponse.json({ error: msg }, { status: 422, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
