import { withApiLog } from "../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";

export const dynamic = "force-dynamic";

const DOMAIN = process.env.APP_DOMAIN || "default";

/**
 * Sample feature entrypoint. Enqueues a "ping" job; the worker processes it,
 * persists a record, and emits "ping:done" via the socket server, which the
 * browser receives over its live socket connection.
 */
async function POST__impl(req: Request) {
  let message = "ping";
  try {
    const body = await req.json();
    if (typeof body?.message === "string" && body.message.trim()) message = body.message.trim();
  } catch {
    // empty body is fine
  }

  // `dedupe: false`: every ping APPENDS a row, so it isn't idempotent — sending
  // the same message twice must record it twice. Dedup (the sendToQueue default)
  // would silently collapse the second one into the first's job.
  const job = await sendToQueue(DOMAIN, "ping", "create", { message }, undefined, QUEUE_PRIORITY.HIGH, {
    dedupe: false,
  });

  return NextResponse.json({ ok: true, jobId: job.id, message });
}

// --- request logging (lib/api-log) ---
export const POST = withApiLog(POST__impl);
