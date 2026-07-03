import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { bucketDaily, bucketValue } from "@photonsurge/shared/climate/buckets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far a cached climate doc may sit from the requested point. */
const NEAREST_KM = Number(process.env.CLIMATE_NEAREST_KM || 300);

/**
 * GET /api/weather/history/climate?lat=&lng=[&granularity=daily|weekly|monthly]
 *
 * The past year at a point from ERA5 reanalysis — served from the WORKER's
 * Mongo cache only (the worker's focus-driven climate job fetches Open-Meteo;
 * the browser and this route never touch the feed). Returns the nearest cached
 * doc within CLIMATE_NEAREST_KM, daily or folded into ISO-week / calendar-month
 * buckets for the director-mode year charts; 404 when nothing is cached near
 * the point yet (the panel section hides until the worker's next snapshot).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const granularity = (url.searchParams.get("granularity") ?? "daily") as
    | "daily"
    | "weekly"
    | "monthly";
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const db = await getAppDb();
  const near = await db.climateYears.nearest({ lng, lat, maxKm: NEAREST_KM });
  if (!near) {
    return NextResponse.json(
      { error: "no cached climate near this point yet" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { climate, distanceKm } = near;

  if (granularity === "daily") {
    return NextResponse.json(
      { ...climate, distanceKm },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  }

  const datasets = climate.datasets.map((d) => {
    const buckets = bucketDaily(climate.dates, d.values, granularity);
    return {
      variable: d.variable,
      units: d.units,
      buckets: buckets.map((b) => ({ ...b, value: bucketValue(d.variable, b) })),
    };
  });
  return NextResponse.json(
    { lat: climate.lat, lng: climate.lng, granularity, distanceKm, datasets },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
