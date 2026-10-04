import { withApiLog } from "../../../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/presenters/tests/[id]/audio — one take's audio. A take's
 * audio never changes once made, so it is cached as immutable.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const audio = await db.voiceTests.getAudio(decodeURIComponent(id));
  if (!audio || !audio.data.byteLength) {
    return NextResponse.json({ error: "audio not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const body = new Uint8Array(audio.data);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": audio.contentType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
