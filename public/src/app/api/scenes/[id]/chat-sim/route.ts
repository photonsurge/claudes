import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scenes/:id/chat-sim { author, text, isMod? } — "say this as a
 * viewer": the worker runs it through the same handler as live chat. Replies
 * come back to the operator panel only, never to YouTube. Effects are real.
 */
async function POST__impl(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: { author?: unknown; text?: unknown; isMod?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* validated below */
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 200) : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const author = typeof body.author === "string" && body.author.trim() ? body.author.trim().slice(0, 60) : "viewer";
  await sendToFore("scenes", "viewer-chat", "inject", { sceneId: id, author, text, isMod: body.isMod === true });
  return NextResponse.json({ queued: true }, { status: 202 });
}

// --- request logging (lib/api-log) ---
export const POST = withApiLog(POST__impl);
