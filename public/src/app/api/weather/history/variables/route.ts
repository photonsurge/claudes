import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/weather/history/variables — which variables the frame archive
 * holds, plus the total frame count. Discovery endpoint for history UIs.
 */
async function GET__impl() {
  const db = await getAppDb();
  const [variables, count] = await Promise.all([
    db.weatherFrames.variables(),
    db.weatherFrames.count(),
  ]);
  return NextResponse.json(
    { variables: variables.sort(), count },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
