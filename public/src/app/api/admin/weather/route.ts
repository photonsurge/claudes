import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/weather — every baked weather run (all models, including
 * pending/failed), newest first, with per-variable forecast-hour counts and a
 * representative thumbnail texture id. Diagnostic view: which models + variables
 * actually baked and WHEN, so a starved or partial ingest (e.g. only temp/
 * humidity present) is visible at a glance. Thumbnails render via the public
 * `/api/weather/tex/<id>.png` route.
 */
async function GET__impl(_req: Request) {
  const db = await getAppDb();
  const res = await db.weatherRuns.getAll({}, { sort: { run: -1, generatedAt: -1 }, limit: 200 });
  const rows = res.success && res.data ? res.data : [];
  const now = Date.now();

  const runs = rows.map((r: any) => {
    const variables = Object.entries(r.variables ?? {})
      .map(([id, entry]: [string, any]) => {
        const fhrs = Object.keys(entry.files ?? {})
          .map(Number)
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        const firstFhr = fhrs.length ? fhrs[0] : null;
        return {
          id,
          encoding: entry.encoding ?? "scalar",
          units: entry.units ?? "",
          fhrCount: fhrs.length,
          firstFhr,
          lastFhr: fhrs.length ? fhrs[fhrs.length - 1] : null,
          thumbTexId: firstFhr !== null ? entry.files[String(firstFhr)] : null,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const generatedAt = r.generatedAt ? new Date(r.generatedAt) : null;
    return {
      id: r.id,
      model: r.model,
      run: new Date(r.run).toISOString(),
      generatedAt: generatedAt ? generatedAt.toISOString() : null,
      ageMs: generatedAt ? now - generatedAt.getTime() : null,
      status: r.status,
      published: !!r.published,
      grid: r.grid ?? null,
      variableCount: variables.length,
      textureCount: variables.reduce((n, v) => n + v.fhrCount, 0),
      variables,
    };
  });

  return NextResponse.json(
    { runs, count: runs.length, now: new Date(now).toISOString() },
    { status: 200, headers: NO_CACHE },
  );
}

export const GET = withApiLog(GET__impl);
