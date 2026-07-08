import type { Job } from "bullmq";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import { pointInPolygon, type SimpleGeometry } from "@photonsurge/shared/geo/pointInPolygon";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { decodeFrame } from "../weather/frameDecode";
import { reportForPlace, type VariableFrame } from "../areaWeather/aggregate";

const TAG = "job:areaWeather";

/** Same variable ids the forecast hazard rules key off (shared/src/weather/forecastHazard.ts). */
const VARIABLES: { variable: string; units: string }[] = [
  { variable: "temp", units: "°C" },
  { variable: "gust", units: "m/s" },
  { variable: "rain", units: "mm" },
];

/** Current-conditions frames don't refresh every minute — a few hours' grace
 *  covers a slow ingest cycle without ever reporting genuinely stale data. */
const FRAME_LOOKBACK_MS = 6 * 3_600_000;

/** The freshest archived frame (highest validTime) per tracked variable, decoded and ready to sample. */
async function latestVariableFrames(db: AppDb): Promise<VariableFrame[]> {
  const from = new Date(Date.now() - FRAME_LOOKBACK_MS);
  const out: VariableFrame[] = [];
  for (const v of VARIABLES) {
    const series = await db.weatherFrames.getSeries({ variable: v.variable, from });
    if (!series.length) continue;
    const newest = series.reduce((a, b) => (b.validTime > a.validTime ? b : a));
    out.push({ variable: v.variable, units: v.units, frame: await decodeFrame(newest) });
  }
  return out;
}

/**
 * Hourly area-weather snapshot: for every Country (real-boundary mask) and
 * Region (bbox-only), reduce the latest temp/gust/rain frames to mean/min/max
 * + forecast-hazard flags and append a report. Skips entirely (no-op, not an
 * error) when no tracked variable has a recent-enough frame — an idle/fresh
 * install with no weather data ingested yet.
 */
export async function runAreaWeather(): Promise<{ countries: number; regions: number }> {
  const db = await getAppDb();
  const frames = await latestVariableFrames(db);
  if (!frames.length) {
    log(TAG, "no current frames available — skipping");
    return { countries: 0, regions: 0 };
  }

  const countries = await db.countries.list();
  let countryReports = 0;
  for (const c of countries) {
    const geometry = c.geometry as SimpleGeometry;
    const mask = (lat: number, lng: number) => pointInPolygon(lng, lat, geometry);
    const { stats, hazards } = reportForPlace(c.bbox, mask, frames);
    if (!stats.length) continue;
    await db.areaWeatherReports.create({
      placeKind: "country",
      placeId: c.countryId,
      name: c.name,
      generatedAt: new Date(),
      stats,
      hazards,
    });
    countryReports++;
  }

  const regions = await db.regions.list();
  let regionReports = 0;
  for (const r of regions) {
    const { stats, hazards } = reportForPlace(r.bbox, null, frames);
    if (!stats.length) continue;
    await db.areaWeatherReports.create({
      placeKind: "region",
      placeId: r.regionId,
      name: r.name,
      generatedAt: new Date(),
      stats,
      hazards,
    });
    regionReports++;
  }

  const result = { countries: countryReports, regions: regionReports };
  log(TAG, "run done", result);
  blogInfo(
    TAG,
    `area-weather: ${countryReports} country + ${regionReports} region reports`,
    result,
    "areaWeather",
    "run",
  );
  return result;
}

/** Job handler: `areaWeather.run`. */
export async function run(_job: Job) {
  try {
    return await runAreaWeather();
  } catch (err) {
    log(TAG, "run failed", summarizeForLog(err));
    blogErr(TAG, "area-weather run failed", err, "areaWeather", "run");
    throw err;
  }
}
