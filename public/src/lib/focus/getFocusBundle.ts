/**
 * getFocusBundle — the composer. "Get the relevant data for X with X params."
 *
 * One transport-agnostic async function that assembles a FocusBundle from Mongo,
 * kind-branched so it only computes what that kind's panels need. The HTTP route,
 * the debug page, and (later) the worker pre-warm are all thin wrappers around
 * this. It reuses the exact builders the individual /api routes already call — it
 * does NOT re-implement any query.
 *
 * MEMORY DISCIPLINE (runs 24/7): stateless — no module-scope cache, builds the
 * bundle, returns it, retains nothing. All caching is Redis (see focus-cache).
 */
import { getAppDb } from "@photonsurge/shared/db/index";
import { pointInPolygon, type SimpleGeometry } from "@photonsurge/shared/geo/pointInPolygon";
import { bucketDaily, bucketValue } from "@photonsurge/shared/climate/buckets";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";

import { buildHistorySeries, buildAreaHistorySeries } from "../weather-history";
import { buildForecastDays, buildAreaForecastDays } from "../weather-forecast";
import { alertsToFeatures, type Alert, type AlertFeature } from "../alerts";
import { isTargetedEvent, hasRealLocation } from "../../components/broadcast/kinds";
import { haversineKm } from "../geo";
import { regionMinPop } from "../cities";
import { normalizeFocus, buildFocusKey } from "./focusKey";
import type {
  FocusBundle,
  FocusRequest,
  FocusTarget,
  FocusCity,
  FocusNearbyCity,
} from "./types";
import type { ClimateBucketedDataset } from "../history-client";
import type { CountryAt } from "../countries";
import type { Quake } from "@photonsurge/shared/tracks/types";

/** The bbox the area-scoped panels frame — mirrors bboxForCamera in
 *  history-client (inlined so a server module never pulls the client hooks). */
function bboxForCamera(center: [number, number], zoom: number): [number, number, number, number] {
  const lngSpan = Math.min(120, Math.max(6, 360 / Math.pow(2, zoom)));
  const latSpan = lngSpan / 2;
  const [lng, lat] = center;
  const wrap = (l: number) => ((l + 540) % 360) - 180;
  return [wrap(lng - lngSpan / 2), Math.max(-90, lat - latSpan / 2), wrap(lng + lngSpan / 2), Math.min(90, lat + latSpan / 2)];
}

/** Forecast variables the daily card strip + hazard rules need (matches
 *  /api/weather/forecast/point's DEFAULT_VARIABLES). */
const FORECAST_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];

/** The variables the on-air history panels actually chart — mirrors
 *  history-client's HISTORY_VARIABLE_ORDER MINUS `radar` (a slow nowcast, ~3.6s
 *  per var to sample, not a real time series). `broadcast` detail limits the
 *  history fan-out to these so a country/region compose doesn't pay for the ~8
 *  niche archive layers (sst-depths, cin, soil, dewpoint, visibility…) the deck
 *  never shows. Keep in sync with HISTORY_VARIABLE_ORDER. */
const BROADCAST_HISTORY_VARS = new Set([
  "temp",
  "humidity",
  "wind",
  "gust",
  "rain",
  "storm",
  "pressure",
  "cloud",
  "snow",
  "sst",
  "current",
  "salinity",
  "wave",
]);

/** Nearest cached climate → the monthly bucketed datasets the spark charts render. */
async function climateFor(
  db: Awaited<ReturnType<typeof getAppDb>>,
  lng: number,
  lat: number,
): Promise<ClimateBucketedDataset[]> {
  const near = await db.climateYears.nearest({ lng, lat, maxKm: 250 });
  if (!near) return [];
  const { climate } = near;
  return climate.datasets.map((d) => {
    const buckets = bucketDaily(climate.dates, d.values, "monthly");
    return {
      variable: d.variable,
      units: d.units,
      buckets: buckets.map((b) => ({ ...b, value: bucketValue(d.variable, b) })),
    };
  });
}

function bboxArea(b: [number, number, number, number]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/** Smallest country whose real geometry contains the point (mirrors /api/countries/at). */
async function resolveCountryAt(
  db: Awaited<ReturnType<typeof getAppDb>>,
  lng: number,
  lat: number,
): Promise<CountryAt | null> {
  const countries = await db.countries.list();
  const candidates = countries
    .filter(
      (c) =>
        c.bbox && lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3] && c.geometry,
    )
    .sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox));
  for (const c of candidates) {
    if (pointInPolygon(lng, lat, c.geometry as unknown as SimpleGeometry)) {
      const { geometry: _drop, ...rest } = c as iCountryModel;
      return rest as CountryAt;
    }
  }
  return null;
}

function mapQuake(r: {
  quakeId: string;
  mag: number;
  place?: string;
  time: number | Date;
  lng: number;
  lat: number;
  depthKm: number;
  url?: string;
  tsunami?: boolean;
}): Quake {
  return {
    id: r.quakeId,
    mag: r.mag,
    place: r.place,
    time: new Date(r.time).getTime(),
    lng: r.lng,
    lat: r.lat,
    depthKm: r.depthKm,
    url: r.url,
    tsunami: r.tsunami || undefined,
  };
}

/**
 * Compose the bundle for one on-air "thing". Empty arrays / null when a field
 * doesn't apply to the kind — never omitted, so consumers + tests stay
 * branch-free.
 */
export async function getFocusBundle(req: FocusRequest): Promise<FocusBundle> {
  const n = normalizeFocus(req);
  const [lng, lat] = n.center;
  const { zoom, kind, detail, subject } = n;
  const bbox = bboxForCamera(n.center, zoom);
  const key = buildFocusKey(req);

  const targeted = isTargetedEvent(kind);
  const hasLoc = hasRealLocation(kind);
  // TOP CITIES + framed WEATHER (area forecast) render for ANY located shot,
  // targeted events included (their deck pushes those slides over histBbox, which
  // === this bbox). The bundle stamps `bbox` unconditionally, so it MUST carry
  // these or a covering selector serves an intentionally-empty array (blank slide)
  // instead of falling back.
  const wantAreaFrame = hasLoc;
  // Area HISTORY (the AREA HISTORY deck slide) is only ever requested with a bbox
  // by wide/country/region shots; targeted events render POINT history in the
  // event reticle (bbox=null) and never call useAreaHistorySeries with a bbox — so
  // skip the expensive per-variable area-pixel scan for them.
  const wantAreaHistory = !targeted && hasLoc;
  const isRegion = kind === "region";

  const db = await getAppDb();

  // Weather variables for the point/area history fan-out (resolved once — kills
  // the client's /variables waterfall).
  //
  // BROADCAST breadth-gate: the archive now carries ~22 variables (the GFS
  // expansion added visibility/dewpoint/cin/soil + ocean sst-depth layers, plus
  // the slow `radar` nowcast). Fanning getSeries over ALL of them — each pulling
  // 72h of frames WITH texture bytes, for point AND area — made a country/region
  // compose ~16s and the panels never chart the niche layers anyway. So
  // `broadcast` detail limits history to the charted set (mirrors history-client's
  // HISTORY_VARIABLE_ORDER) minus `radar` (a 3.6s-per-var nowcast, not a
  // meaningful time series); admin/full keep the full archive for deep dives.
  const allVars = hasLoc ? await db.weatherFrames.variables() : [];
  const histVars =
    detail === "broadcast" ? allVars.filter((v) => BROADCAST_HISTORY_VARS.has(v)) : allVars;

  // History frames fetched ONCE per variable and shared by the point + area
  // builders — they sample the same archive frames, so fetching twice (the old
  // ~2×N getSeries fan-out) doubled the DB work for nothing.
  //
  // CRITICAL: bound to the same rolling window the client renders
  // (HISTORY_WINDOW_HOURS, mirrors history-client's fromParam). Without `from`,
  // getSeries scans the ENTIRE never-pruned WeatherFrame archive — bytes and all —
  // per variable, which was the dominant cost of a cache-miss compose.
  const HISTORY_WINDOW_HOURS = 72;
  const historyFrom = new Date(Date.now() - HISTORY_WINDOW_HOURS * 3600 * 1000);
  const historyFrames: Record<string, Awaited<ReturnType<typeof db.weatherFrames.getSeries>>> = {};
  if (hasLoc) {
    await Promise.all(
      histVars.map(async (v) => {
        historyFrames[v] = await db.weatherFrames.getSeries({ variable: v, from: historyFrom });
      }),
    );
  }

  // Forecast frames fetched once, shared by point + area builders.
  const forecastFrames: Record<string, unknown[]> = {};
  if (hasLoc) {
    await Promise.all(
      FORECAST_VARIABLES.map(async (v) => {
        forecastFrames[v] = await db.weatherForecastFrames.getSeries({ variable: v });
      }),
    );
  }

  const [
    pointHistory,
    areaHistory,
    pointForecastSeries,
    areaForecastSeries,
    climate,
    topCities,
    nearbyCities,
    areaAlerts,
    areaQuakes,
    areaVolcanoes,
    country,
    region,
    seismoStations,
    tideStations,
  ] = await Promise.all([
    // pointHistory — reuse the shared per-variable frames (no re-fetch)
    hasLoc
      ? Promise.all(histVars.map((v) => buildHistorySeries(v, historyFrames[v], lat, lng)))
      : Promise.resolve([]),
    // areaHistory — same shared frames; skipped for targeted events
    wantAreaHistory
      ? Promise.all(histVars.map((v) => buildAreaHistorySeries(v, historyFrames[v], bbox)))
      : Promise.resolve([]),
    // pointForecast
    hasLoc ? buildForecastDays(forecastFrames as never, lat, lng) : Promise.resolve(null),
    // areaForecast
    wantAreaFrame ? buildAreaForecastDays(forecastFrames as never, bbox) : Promise.resolve(null),
    // climate (focus point)
    hasLoc ? climateFor(db, lng, lat) : Promise.resolve([]),
    // topCities (located shots — incl. targeted CLOSE CITIES)
    wantAreaFrame ? topCitiesFor(db, bbox, zoom) : Promise.resolve([]),
    // nearbyCities (targeted events)
    targeted ? nearbyCitiesFor(db, lng, lat) : Promise.resolve([]),
    // areaAlerts
    hasLoc
      ? db.alerts
          .list({ activeOnly: true, bbox })
          .then((rows) => alertsToFeatures(rows as unknown as Alert[]))
      : Promise.resolve([] as AlertFeature[]),
    // areaQuakes
    hasLoc ? db.quakes.list({ bbox, limit: 50 }).then((rows) => rows.map(mapQuake)) : Promise.resolve([]),
    // areaVolcanoes
    hasLoc
      ? db.volcanoes
          .list({})
          .then((vs) =>
            vs.filter((v) => v.lng >= bbox[0] && v.lng <= bbox[2] && v.lat >= bbox[1] && v.lat <= bbox[3]),
          )
      : Promise.resolve([]),
    // country (land shots)
    hasLoc && kind !== "ocean" && kind !== "orbital"
      ? resolveCountryAt(db, lng, lat)
      : Promise.resolve(null),
    // region (by subject id)
    isRegion && subject ? db.regions.get(subject) : Promise.resolve(null),
    // seismoStations
    (kind === "quake" || hasLoc)
      ? db.seismoSeries.nearMany({ lng, lat, maxKm: 1500, limit: 6 }).then((near) =>
          near.map(({ series, distanceKm }) => ({
            net: series.net,
            sta: series.sta,
            loc: series.loc,
            cha: series.cha,
            siteName: series.siteName,
            lat: series.lat,
            lng: series.lng,
            distanceKm,
            sampleRateHz: series.sampleRateHz,
            samples: series.samples,
            latest: series.latest,
            updatedAt: series.updatedAt,
          })),
        )
      : Promise.resolve([]),
    // tideStations
    (kind === "storm" || kind === "quake")
      ? db.tideSeries.nearMany({ lng, lat, maxKm: 400, limit: 4 }).then((near) =>
          near.map(({ series, distanceKm }) => ({
            stationId: series.stationId,
            provider: series.provider,
            name: series.name,
            lat: series.lat,
            lng: series.lng,
            distanceKm,
            unit: series.unit,
            samples: series.samples,
            latest: series.latest,
            updatedAt: series.updatedAt,
          })),
        )
      : Promise.resolve([]),
  ]);

  // Roundups + area-weather report key off the resolved place.
  const countryRoundup = country ? await db.countryRoundups.latestForPlace(country.countryId) : null;
  const regionRoundup = region ? await db.regionRoundups.latestForPlace(region.regionId) : null;
  const areaWeatherReport = isRegion && region
    ? await db.areaWeatherReports.latest("region", region.regionId)
    : country
      ? await db.areaWeatherReports.latest("country", country.countryId)
      : null;

  // The on-air target — loaded by subject id, the full doc.
  let target: FocusTarget = null;
  if (subject) {
    if (kind === "quake") {
      const q = await db.quakes.get(subject);
      if (q) target = { kind: "quake", quake: mapQuake(q) };
    } else if (kind === "volcano") {
      const v = await db.volcanoes.get(subject);
      if (v) target = { kind: "volcano", volcano: v };
    } else if (kind === "storm") {
      const match = areaAlerts.find(
        (f) => f.properties.identifier === subject || f.properties.id === subject,
      );
      if (match) target = { kind: "storm", alert: match };
    }
  }

  return {
    key,
    kind,
    detail,
    subject,
    center: n.center,
    zoom,
    bbox,
    generatedAt: Date.now(),

    pointHistory,
    areaHistory,
    pointForecast: pointForecastSeries?.days ?? [],
    areaForecast: areaForecastSeries?.days ?? [],
    climate,

    topCities,
    nearbyCities,
    cityConditions: [], // TODO(phase-3): bake CityConditionsPanel's /api/cities/weather read

    target,
    areaAlerts,
    areaQuakes,
    areaVolcanoes,

    country,
    countryRoundup,
    region,
    regionRoundup,
    areaWeather: areaWeatherReport,

    seismoStations,
    tideStations,
    nearbyCams: [], // TODO(phase-3): cams already load globally via useCams
    depthProfile: null, // TODO: ocean-kind depth profile
  };
}

/** Top cities in view (population-sorted) with climate baked in — kills the N+1. */
async function topCitiesFor(
  db: Awaited<ReturnType<typeof getAppDb>>,
  bbox: [number, number, number, number],
  zoom: number,
): Promise<FocusCity[]> {
  const [w, s, e, nth] = bbox;
  const query: Record<string, unknown> = { population: { $gte: regionMinPop(zoom) } };
  query.lat = { $gte: Math.max(s, -90), $lte: Math.min(nth, 90) };
  if (w <= e) query.lng = { $gte: w, $lte: e };
  else query.$or = [{ lng: { $gte: w } }, { lng: { $lte: e } }];
  const res = await db.cities.getAll(query, { sort: { population: -1 }, limit: 8 });
  const cities = (res?.data ?? []) as FocusCity["city"][];
  return Promise.all(
    cities.map(async (city) => ({ city, climate: await climateFor(db, city.lng, city.lat) })),
  );
}

/** Cities near a point (targeted events), with distance + baked climate. */
async function nearbyCitiesFor(
  db: Awaited<ReturnType<typeof getAppDb>>,
  lng: number,
  lat: number,
): Promise<FocusNearbyCity[]> {
  const half = 3; // degrees — a tight box around the event
  const query: Record<string, unknown> = {
    lat: { $gte: lat - half, $lte: lat + half },
    lng: { $gte: lng - half, $lte: lng + half },
  };
  const res = await db.cities.getAll(query, { sort: { population: -1 }, limit: 6 });
  const cities = (res?.data ?? []) as FocusNearbyCity["city"][];
  return Promise.all(
    cities.map(async (city) => ({
      city,
      distanceKm: haversineKm([lng, lat], [city.lng, city.lat]),
      climate: await climateFor(db, city.lng, city.lat),
    })),
  );
}
