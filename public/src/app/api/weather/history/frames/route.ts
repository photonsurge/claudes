import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { parseTimeParam } from "../../../../../lib/weather-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/weather/history/frames?variable=temp[&from=][&to=][&model=]
 *
 * List archived frame metadata (no texture bytes) for a variable, oldest
 * first, each with the URL of its PNG — the manifest a "map at a previous
 * point in time" replay will iterate.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const variable = url.searchParams.get("variable");
  if (!variable) {
    return NextResponse.json({ error: "variable is required" }, { status: 400 });
  }

  const db = await getAppDb();
  const metas = await db.weatherFrames.listMeta({
    variable,
    model: url.searchParams.get("model") ?? undefined,
    from: parseTimeParam(url.searchParams.get("from")),
    to: parseTimeParam(url.searchParams.get("to")),
  });

  const frames = metas.map((m) => ({
    id: m.id,
    model: m.model,
    variable: m.variable,
    validTime: new Date(m.validTime).toISOString(),
    run: new Date(m.run).toISOString(),
    fhr: m.fhr,
    encoding: m.encoding,
    units: m.units,
    imageUnscale: m.imageUnscale,
    vectorUnscale: m.vectorUnscale,
    bounds: m.bounds,
    grid: m.grid,
    url: `/api/weather/history/tex/${m.id}.png`,
  }));

  return NextResponse.json(
    { variable, count: frames.length, frames },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
