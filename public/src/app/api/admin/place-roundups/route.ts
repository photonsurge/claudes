import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { PlaceRoundupKind } from "@photonsurge/shared/db/place-roundup-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const KINDS: PlaceRoundupKind[] = ["country", "region"];

/**
 * GET /api/admin/place-roundups — the per-country / per-region AI round-ups.
 *   ?kind=country|region                        → latest round-up PER place (the index list)
 *   ?kind=country&placeId=gb&history=20         → that place's latest + recent history
 * Reads whichever collection matches `kind` (countryRoundups / regionRoundups).
 */
async function GET__impl(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("kind") as PlaceRoundupKind | null;
  const kind: PlaceRoundupKind = raw && KINDS.includes(raw) ? raw : "country";
  const placeId = q.get("placeId");
  const historyN = Math.max(1, Math.min(50, Number(q.get("history") || 20)));

  const db = await getAppDb();
  const repo = kind === "country" ? db.countryRoundups : db.regionRoundups;

  if (placeId) {
    const [latest, history] = await Promise.all([
      repo.latestForPlace(placeId),
      repo.list(placeId, { limit: historyN }),
    ]);
    return NextResponse.json({ kind, placeId, latest, history }, { status: 200, headers: NO_CACHE });
  }

  const places = await repo.latestPerPlace();
  return NextResponse.json({ kind, places }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
