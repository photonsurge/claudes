/**
 * City weather cache — samples the frame archive + rolling forecast store at
 * every "decent size" city (population ≥ CITY_POP_FLOOR) and caches, per city, a
 * 24h observed trend, the latest reading, and a 3-day daily hi/lo forecast. The
 * region dossier, broadcast slides and the slim /watch region mode read this
 * (`db.cityWeather`) instead of sampling GFS at request time.
 *
 * Efficiency: each archived frame is a PNG that must be sharp-decoded once
 * (~ms). We decode each frame ONCE and sample all cities from the in-memory grid
 * (plain array math), NOT per-city — otherwise thousands of cities × dozens of
 * frames would be thousands of decodes.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { sampleFrame } from "@photonsurge/shared/weather/sample";
import type { iCityWeather, iCityWeatherDay } from "@photonsurge/shared/db/city-weather-model";
import { log } from "@photonsurge/shared/utill/logger";
import { decodeFrame, type DecodableFrame } from "../weather/frameDecode";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";

const TAG = "job:cityWeather";

/** The population floor for a city to get a cached weather record. */
export const CITY_POP_FLOOR = 100_000;
const HISTORY_HOURS = 24;
const FORECAST_DAYS = 3;

interface CityPoint {
  cityId: string;
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
}

/** One frame sampled at every city: its validTime + a value per city index. */
interface SampledFrame {
  t: number;
  values: (number | null)[];
}

type FrameEncoding = "scalar" | "uv";

/**
 * Group forecast steps (already sampled per city, aligned by validTime) into
 * daily hi/lo cards. Pure + exported for unit tests. `steps` oldest→newest.
 */
export function rollupForecastDays(
  steps: { t: number; temp?: number | null; gust?: number | null; rain?: number | null }[],
  maxDays = FORECAST_DAYS,
): iCityWeatherDay[] {
  const byDay = new Map<string, iCityWeatherDay>();
  const order: string[] = [];
  for (const s of steps) {
    const date = new Date(s.t).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    let day = byDay.get(date);
    if (!day) {
      day = { date };
      byDay.set(date, day);
      order.push(date);
    }
    if (s.temp != null) {
      day.hi = day.hi == null ? s.temp : Math.max(day.hi, s.temp);
      day.lo = day.lo == null ? s.temp : Math.min(day.lo, s.temp);
    }
    if (s.gust != null) day.gust = day.gust == null ? s.gust : Math.max(day.gust, s.gust);
    if (s.rain != null) day.rain = (day.rain ?? 0) + Math.max(0, s.rain);
  }
  return order.slice(0, maxDays).map((d) => byDay.get(d)!);
}

/** Sample one archived variable across all cities, decoding each frame once. */
async function sampleVar(
  frames: DecodableFrame[],
  cities: CityPoint[],
  encoding: FrameEncoding,
): Promise<SampledFrame[]> {
  const out: SampledFrame[] = [];
  for (const frame of frames as (DecodableFrame & { validTime: Date })[]) {
    const fl = await decodeFrame(frame);
    const values: (number | null)[] = new Array(cities.length);
    for (let i = 0; i < cities.length; i++) {
      const s = sampleFrame(fl, cities[i].lat, cities[i].lng);
      values[i] = s == null ? null : s.kind === "uv" ? s.speed : s.value;
    }
    out.push({ t: new Date(frame.validTime).getTime(), values });
  }
  return out;
}

const latest = (frames: SampledFrame[], i: number): number | null =>
  frames.length ? frames[frames.length - 1].values[i] : null;

export async function runCityWeather(): Promise<{ cities: number; withForecast: number; removed: number }> {
  const db = await getAppDb();

  const cityDocs = (await db.cities.model
    .find({ population: { $gte: CITY_POP_FLOOR } }, { id: 1, name: 1, cc: 1, lat: 1, lng: 1, population: 1, _id: 0 })
    .lean()
    .exec()) as any[];
  const cities: CityPoint[] = cityDocs.map((c) => ({
    cityId: c.id,
    name: c.name,
    cc: c.cc,
    lat: c.lat,
    lng: c.lng,
    population: c.population,
  }));
  if (!cities.length) {
    log(TAG, "no cities >= floor — seed cities first", { floor: CITY_POP_FLOOR });
    return { cities: 0, withForecast: 0, removed: 0 };
  }

  const now = Date.now();
  const from = new Date(now - (HISTORY_HOURS + 1) * 3_600_000);
  const to = new Date(now + 3_600_000);

  // 24h observed trend (temp + wind) and current (temp/wind/rain).
  const [hTemp, hWind, hRain] = await Promise.all([
    db.weatherFrames.getSeries({ variable: "temp", from, to }),
    db.weatherFrames.getSeries({ variable: "wind", from, to }),
    db.weatherFrames.getSeries({ variable: "rain", from, to }),
  ]);
  const tempF = await sampleVar(hTemp as any[], cities, "scalar");
  const windF = await sampleVar(hWind as any[], cities, "uv");
  const rainF = await sampleVar(hRain as any[], cities, "scalar");
  const windByT = new Map(windF.map((f) => [f.t, f.values]));

  // 3-day forecast (temp hi/lo, gust max, rain sum).
  const [fTemp, fGust, fRain] = await Promise.all([
    db.weatherForecastFrames.getSeries({ variable: "temp" }),
    db.weatherForecastFrames.getSeries({ variable: "gust" }),
    db.weatherForecastFrames.getSeries({ variable: "rain" }),
  ]);
  const fTempS = await sampleVar(fTemp as any[], cities, "scalar");
  const fGustS = await sampleVar(fGust as any[], cities, "uv");
  const fRainS = await sampleVar(fRain as any[], cities, "scalar");
  const fGustByT = new Map(fGustS.map((f) => [f.t, f.values]));
  const fRainByT = new Map(fRainS.map((f) => [f.t, f.values]));

  const rows: Omit<iCityWeather, keyof { id?: string }>[] = [];
  let withForecast = 0;

  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];

    const hourly = tempF
      .map((f) => ({ t: f.t, temp: f.values[i] ?? undefined, wind: windByT.get(f.t)?.[i] ?? undefined }))
      .filter((h) => h.temp != null || h.wind != null);

    const current = {
      temp: latest(tempF, i) ?? undefined,
      wind: latest(windF, i) ?? undefined,
      rain: latest(rainF, i) ?? undefined,
    };

    const steps = fTempS.map((f) => ({
      t: f.t,
      temp: f.values[i],
      gust: fGustByT.get(f.t)?.[i] ?? null,
      rain: fRainByT.get(f.t)?.[i] ?? null,
    }));
    const daily = rollupForecastDays(steps);
    if (daily.length) withForecast++;

    rows.push({
      cityId: c.cityId,
      name: c.name,
      cc: c.cc,
      lat: c.lat,
      lng: c.lng,
      population: c.population,
      current,
      hourly,
      daily,
      updatedAt: new Date(),
    });
  }

  await db.cityWeather.upsertMany(rows);
  const pruned = await db.cityWeather.pruneExcept(rows.map((r) => r.cityId));

  const result = { cities: rows.length, withForecast, removed: pruned.removed };
  log(TAG, "refresh done", result);
  blogInfo(
    TAG,
    `city weather: ${rows.length} cities cached (${withForecast} with forecast, ${pruned.removed} pruned)`,
    result,
    "cityWeather",
    "refresh",
  );
  return result;
}

/** Job handler: `cityWeather.refresh`. */
export async function refresh(_job: Job) {
  try {
    return await runCityWeather();
  } catch (err) {
    log(TAG, "refresh failed", summarizeForLog(err));
    blogErr(TAG, "city weather refresh failed", err, "cityWeather", "refresh");
    throw err;
  }
}
