import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { NAME_MAX, TEST_TEXT_MAX, sanitizeVoice } from "@photonsurge/shared/presenter";
import { getSession } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
/** How long the request waits for the worker before handing back a still-speaking take for the page to poll. */
const WAIT_MS = 60_000;

/** GET /api/admin/presenters/tests?presenterId=…&limit=… — recent takes, newest first. ?id=… for one. */
async function GET__impl(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = await getAppDb();
  const id = q.get("id");
  if (id) {
    const take = await db.voiceTests.get(id);
    return NextResponse.json({ take }, { status: take ? 200 : 404, headers: NO_CACHE });
  }
  const [takes, stats] = await Promise.all([
    db.voiceTests.list({ presenterId: q.get("presenterId") || undefined, limit: Number(q.get("limit") || 30) }),
    db.voiceTests.stats(),
  ]);
  return NextResponse.json({ takes, stats }, { status: 200, headers: NO_CACHE });
}

/**
 * POST /api/admin/presenters/tests — speak one take.
 * Body `{ text, presenterId?, voice?, label?, fresh? }`. With a `voice` the take
 * uses it as given (unsaved bench settings); without, the presenter's saved
 * voice. An identical earlier take is reused at no charge unless `fresh`.
 * Waits for the worker; 200 with the finished take, or 202 with a take still
 * speaking when the wait runs out.
 */
async function POST__impl(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { text?: unknown; presenterId?: unknown; voice?: unknown; label?: unknown; fresh?: unknown }
    | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, TEST_TEXT_MAX) : "";
  if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400, headers: NO_CACHE });

  const db = await getAppDb();
  const presenterId = typeof body?.presenterId === "string" && body.presenterId ? body.presenterId : null;
  const presenter = presenterId ? await db.presenters.get(presenterId) : null;
  if (presenterId && !presenter && !body?.voice) {
    return NextResponse.json({ ok: false, error: "unknown presenter" }, { status: 404, headers: NO_CACHE });
  }
  const voice = sanitizeVoice(body?.voice ?? presenter?.voice);
  const label =
    (typeof body?.label === "string" && body.label.trim().slice(0, NAME_MAX)) || presenter?.name || "Bench take";
  const session = await getSession().catch(() => null);

  const created = await db.voiceTests.create({
    presenterId,
    label,
    text,
    voice,
    createdBy: session?.email ?? "",
    source: "admin",
    fresh: body?.fresh === true,
  });

  try {
    await sendToQueueAndWait("presenter", "presenter", "test", { testId: created.id }, WAIT_MS, undefined, { dedupe: false });
  } catch (e) {
    const take = await db.voiceTests.get(created.id);
    // The job may still be running (slow model) — the page polls. A take never
    // picked up (worker down) is marked so it does not sit "queued" forever.
    if (take?.status === "queued") {
      await db.voiceTests.update(created.id, { status: "error", error: `worker did not pick up the take: ${String((e as Error)?.message ?? e)}` });
    }
    return NextResponse.json({ ok: true, take: await db.voiceTests.get(created.id) }, { status: 202, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, take: await db.voiceTests.get(created.id) }, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/admin/presenters/tests?id=… — remove a take and its audio. */
async function DELETE__impl(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400, headers: NO_CACHE });
  const db = await getAppDb();
  const ok = await db.voiceTests.delete(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const POST = withApiLog(POST__impl);
export const DELETE = withApiLog(DELETE__impl);
