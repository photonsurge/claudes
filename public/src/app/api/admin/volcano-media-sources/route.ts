import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { VOLCANO_MEDIA_SOURCES, type VolcanoMediaSource } from "@photonsurge/shared/volcanoes/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** GET /api/admin/volcano-media-sources — the media adapter registry. */
async function GET__impl() {
  const db = await getAppDb();
  return NextResponse.json({ sources: await db.volcanoMediaSources.list() }, { status: 200, headers: NO_CACHE });
}

/**
 * PATCH /api/admin/volcano-media-sources — switch a source on/off.
 *
 * The switch is what stops us fetching and storing a feed at all: some sources
 * publish imagery that simply isn't broadcast-quality, and there's no point
 * spending bandwidth and disk on pictures that will never air.
 */
async function PATCH__impl(req: Request) {
  let body: { source?: unknown; enabled?: unknown } = {};
  try {
    body = (await req.json()) as { source?: unknown; enabled?: unknown };
  } catch {
    /* empty */
  }

  if (!VOLCANO_MEDIA_SOURCES.includes(body.source as VolcanoMediaSource)) {
    return NextResponse.json(
      { error: `source must be one of ${VOLCANO_MEDIA_SOURCES.join(", ")}` },
      { status: 400, headers: NO_CACHE },
    );
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400, headers: NO_CACHE });
  }

  const db = await getAppDb();
  await db.volcanoMediaSources.setEnabled(body.source as VolcanoMediaSource, body.enabled);
  return NextResponse.json({ source: body.source, enabled: body.enabled }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PATCH = withApiLog(PATCH__impl);
