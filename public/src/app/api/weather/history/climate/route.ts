import { NextResponse } from "next/server";
import { fetchClimateYearCached, bucketDaily, bucketValue } from "../../../../../lib/climate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/weather/history/climate?lat=&lng=[&granularity=daily|weekly|monthly]
 *
 * The past year at a point from ERA5 reanalysis (Open-Meteo archive): daily
 * temp mean/max/min, humidity, rain and wind — optionally folded into ISO-week
 * or calendar-month buckets for the director-mode year charts. This is the
 * "before our own archive existed" companion to /point.
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

  const year = await fetchClimateYearCached(lat, lng);
  if (!year) {
    return NextResponse.json(
      { error: "climate source unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (granularity === "daily") {
    return NextResponse.json(year, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  const datasets = year.datasets.map((d) => {
    const buckets = bucketDaily(year.dates, d.values, granularity);
    return {
      variable: d.variable,
      units: d.units,
      buckets: buckets.map((b) => ({ ...b, value: bucketValue(d.variable, b) })),
    };
  });
  return NextResponse.json(
    { lat: year.lat, lng: year.lng, granularity, datasets },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
