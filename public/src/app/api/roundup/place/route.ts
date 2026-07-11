import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { PlaceRoundupKind } from "@photonsurge/shared/db/place-roundup-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const KINDS: PlaceRoundupKind[] = ["country", "region"];

/**
 * GET /api/roundup/place?kind=country|region&placeId=<id> — the latest per-place
 * round-up for the broadcast frame's region-mode deck slide. A public,
 * single-doc cousin of /api/admin/place-roundups (which also returns the index +
 * history for the admin screen). Reads whichever collection matches `kind`
 * (countryRoundups / regionRoundups); `region` is wired for the forthcoming
 * Regions mode. Returns `{ latest: null }` when the place has no round-up yet.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get("kind") as PlaceRoundupKind | null;
  const kind: PlaceRoundupKind = raw && KINDS.includes(raw) ? raw : "country";
  const placeId = q.get("placeId");
  if (!placeId) {
    return NextResponse.json({ error: "placeId is required" }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  const repo = kind === "country" ? db.countryRoundups : db.regionRoundups;
  const latest = await repo.latestForPlace(placeId);

  return NextResponse.json({ kind, placeId, latest }, { status: 200, headers: NO_CACHE });
}
