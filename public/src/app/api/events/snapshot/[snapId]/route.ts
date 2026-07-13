import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/events/snapshot/<snapId>[.png]
 * Streams one unified-event snapshot's bytes (satellite/compare/camera/render)
 * from the shared FS blob store, keyed by the snapshot id. Callers append
 * `&v=<capturedAt>` for an immutable per-frame URL. 404 until the worker has
 * captured it. Mirror of /api/alerts/snapshot — worker-only sharp, public just
 * serves the bytes.
 */
async function GET__impl(_req: Request, { params }: { params: Promise<{ snapId: string }> }) {
  try {
    const { snapId } = await params;
    const id = snapId.replace(/\.png$/i, "");
    const db = await getAppDb();
    const snap = await db.eventSnapshots.getPng(id);
    if (!snap) {
      return NextResponse.json(
        { error: `no snapshot ${id}` },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new NextResponse(new Uint8Array(snap.data), {
      status: 200,
      headers: {
        "Content-Type": snap.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
