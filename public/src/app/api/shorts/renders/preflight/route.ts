import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { sanitizeRenderRequest, type ShortRenderPreflight } from "@photonsurge/shared/short-render";
import { requireAdmin } from "../../../../../lib/require-admin";
import { NO_CACHE } from "../../preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolving every clip and probing OBS can take a few seconds. */
const PREFLIGHT_TIMEOUT_MS = 45_000;

const isWaitTimeout = (msg: string) => /timed out before finishing/i.test(msg);

/**
 * POST /api/shorts/renders/preflight — the offline test's preflight report
 * (docs/short-video-plan.md §7.1) for the Render form's request: clips
 * resolved and skipped, length against the budget, the encoder probed and the
 * YouTube account's recorded state. No side effects: nothing is queued. The
 * body is the same ShortRenderRequest POST /api/shorts/renders takes; the
 * worker (`run-lifecycle.renderPreflight`) builds the report.
 *
 *  • 200 `{ ok: true, report }`  • 400 not a render request
 *  • 422 the worker could not build it  • 504 no answer in time
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
      { error: 'a preflight needs what to make: { type: "script", scriptId } or { type: "generate", formatId, scope }' },
      { status: 400, headers: NO_CACHE },
    );
  }
  try {
    const result = await sendToQueueAndWait<{ ok: boolean; error?: string; report?: ShortRenderPreflight }>(
      "stream",
      "run-lifecycle",
      "renderPreflight",
      { request },
      PREFLIGHT_TIMEOUT_MS,
      undefined,
      { dedupe: false },
    );
    if (!result?.ok || !result.report) {
      return NextResponse.json(
        { error: result?.error ?? "the worker could not build the report" },
        { status: 422, headers: NO_CACHE },
      );
    }
    return NextResponse.json({ ok: true, report: result.report }, { status: 200, headers: NO_CACHE });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (isWaitTimeout(msg)) {
      return NextResponse.json(
        { error: `No answer from the worker after ${PREFLIGHT_TIMEOUT_MS / 1000}s — it may be busy or not running.` },
        { status: 504, headers: NO_CACHE },
      );
    }
    return NextResponse.json({ error: msg }, { status: 422, headers: NO_CACHE });
  }
}

export const POST = withApiLog(POST__impl);
