import { NextResponse } from "next/server";
import { collectShips } from "../../../../lib/tracks/aisstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

// Default to a busy stretch (English Channel / southern North Sea) so the
// snapshot isn't empty when no bbox is given. [w, s, e, n].
const DEFAULT_BBOX: [number, number, number, number] = [-6, 49, 6, 54];

/**
 * GET /api/tracks/ships?bbox=w,s,e,n
 * AIS snapshot via aisstream.io (a few seconds of PositionReports, deduped by
 * MMSI). Requires AISSTREAM_API_KEY; without it we return configured:false so
 * the UI can prompt instead of erroring.
 */
export async function GET(req: Request) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { configured: false, ships: [], count: 0, note: "Set AISSTREAM_API_KEY to enable AIS." },
      { status: 200, headers: NO_CACHE },
    );
  }

  const url = new URL(req.url);
  let bbox = DEFAULT_BBOX;
  const bboxRaw = url.searchParams.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = parts as [number, number, number, number];
    }
  }

  try {
    const ships = await collectShips(apiKey, bbox, 4000);
    return NextResponse.json(
      { configured: true, count: ships.length, at: new Date().toISOString(), bbox, ships },
      { status: 200, headers: NO_CACHE },
    );
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err), ships: [], count: 0 },
      { status: 502, headers: NO_CACHE },
    );
  }
}
