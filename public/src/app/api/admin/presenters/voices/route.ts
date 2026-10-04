import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * POST /api/admin/presenters/voices — refresh the cached OpenRouter speech
 * models now (the worker fetches; public never calls OpenRouter) and return
 * the new catalog. Always 200 with `{ ok, error? }` so the page can show why.
 */
async function POST__impl() {
  let error: string | undefined;
  try {
    await sendToQueueAndWait("presenter", "presenter", "refreshVoices", {}, 30_000);
  } catch (e) {
    error = String((e as Error)?.message ?? e);
  }
  const db = await getAppDb();
  const catalog = await db.speechCatalog.get();
  return NextResponse.json({ ok: !error, error, catalog }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const POST = withApiLog(POST__impl);
