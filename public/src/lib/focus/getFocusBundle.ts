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
import { cityGeoWithinBox } from "@photonsurge/shared/db/city-model";

import type { HistorySeries, AreaHistorySeries } from "@photonsurge/shared/weather/history-types";
import {
  workerPointHistory,
  workerAreaHistory,
  workerForecastPoint,
  workerForecastArea,
} from "../worker-sample";
import {
  buildForecastDays,
  buildForecastSteps,
  buildAreaForecastDays,
  DEFAULT_FORECAST_DAYS,
  forecastHorizonHours,
} from "../weather-forecast";
import {
  getWeatherPanel,
  BROADCAST_HISTORY_VARS as SHARED_BROADCAST_HISTORY_VARS,
  type WeatherPanel,
} from "@photonsurge/shared/weather/panels";
import { areaAlertFeatures, type Alert, type AlertFeature } from "../alerts";
import { buildTimeline, type AlertTimelineBeat } from "@photonsurge/shared/alerts/timeline";
import { buildEventTimeline } from "@photonsurge/shared/events/event-timeline";
import { isTargetedEvent, hasRealLocation } from "../../components/broadcast/kinds";
import { haversineKm } from "../geo";
import { regionMinPop } from "../cities";
import { getCachedCountries } from "../countries-cache";
import { normalizeFocus, buildFocusKey } from "./focusKey";
import type {
  FocusBundle,
  FocusRequest,
  FocusTarget,
  FocusCity,
  FocusNearbyCity,
  FocusRegionCountry,
} from "./types";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";
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
const BROADCAST_HISTORY_VARS = new Set(SHARED_BROADCAST_HISTORY_VARS);

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
  const countries = await getCachedCountries(db);
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

  // Point + area history are built in BOUNDED-MEMORY batches. getSeries returns
  // 72h of TEXTURE-BYTE frames per variable; the old "load every var's frames into
  // one map, then build" held ALL vars' textures at once — multiple GB per
  // compose, and a couple of concurrent country/region composes blew public's heap
  // to ~6GB and crash-looped the container. Instead we process a few vars at a
  // time: fetch a batch's frames, build their point+area series, and let those
  // frames be GC'd before the next batch. Peak memory is HISTORY_BATCH vars, not
  // all ~13. (Each var's frames still feed BOTH point + area — no double fetch.)
  //
  // The window is bounded to HISTORY_WINDOW_HOURS (mirrors history-client's
  // fromParam); without `from`, getSeries scans the ENTIRE never-pruned archive.
  const HISTORY_WINDOW_HOURS = 72;
  const historyFrom = new Date(Date.now() - HISTORY_WINDOW_HOURS * 3600 * 1000);
  const HISTORY_BATCH = Math.max(1, Number(process.env.FOCUS_HISTORY_BATCH || 3));
  const buildHistories = async (): Promise<{
    pointHistory: HistorySeries[];
    areaHistory: AreaHistorySeries[];
  }> => {
    const pointHistory: HistorySeries[] = [];
    const areaHistory: AreaHistorySeries[] = [];
    if (!hasLoc) return { pointHistory, areaHistory };
    for (let i = 0; i < histVars.length; i += HISTORY_BATCH) {
      const batch = histVars.slice(i, i + HISTORY_BATCH);
      const built = await Promise.all(
        batch.map(async (v) => {
          // Public no longer decodes — the worker samples the archive (sole frame
          // decoder, bytes from the blob store) and returns the numeric series.
          const fromMs = historyFrom.getTime();
          const pt = await workerPointHistory({ variable: v, lat, lng, from: fromMs });
          const ar = wantAreaHistory
            ? await workerAreaHistory({ variable: v, bbox, from: fromMs })
            : null;
          return { pt, ar };
        }),
      );
      for (const b of built) {
        pointHistory.push(b.pt);
        if (b.ar) areaHistory.push(b.ar);
      }
    }
    return { pointHistory, areaHistory };
  };

  // Forecast is sampled by the worker (sole decoder); public only composes the
  // day cards. Bounded to the detailed strip's horizon.
  const fcstVars = FORECAST_VARIABLES as unknown as string[];
  const fcstHours = forecastHorizonHours(DEFAULT_FORECAST_DAYS);

  // Resolve the country under the point ONCE — reused for both the bundle's
  // `country` field and the country panel lookup (was an in-parallel
  // resolveCountryAt below).
  const resolvedCountry =
    hasLoc && kind !== "ocean" && kind !== "orbital"
      ? await resolveCountryAt(db, lng, lat)
      : null;

  // Precomputed point+area history (worker → Redis) for the on-air country/region.
  // A HIT lets us skip buildHistories entirely — no request-time sharp decode.
  // Only non-targeted land/region shots have panels (targeted events render POINT
  // history live in the reticle); a miss falls through to the live builder.
  let panel: WeatherPanel | null = null;
  if (hasLoc && !targeted) {
    if (isRegion && subject) panel = await getWeatherPanel("region", subject);
    else if (resolvedCountry) panel = await getWeatherPanel("country", resolvedCountry.countryId);
  }

  const [
    histories,
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
    // point + area history — a precomputed panel (worker → Redis) when the on-air
    // country/region has one, else the live bounded-memory builder (sharp decode;
    // peak = HISTORY_BATCH vars' frames — see buildHistories above).
    panel
      ? Promise.resolve({ pointHistory: panel.pointHistory, areaHistory: panel.areaHistory })
      : buildHistories(),
    // pointForecast — worker samples, public composes the cards
    hasLoc
      ? workerForecastPoint({ lat, lng, variables: fcstVars, maxHours: fcstHours }).then((s) =>
          buildForecastDays(s, lat, lng),
        )
      : Promise.resolve(null),
    // areaForecast
    wantAreaFrame
      ? workerForecastArea({ bbox, variables: fcstVars, maxHours: fcstHours }).then((s) =>
          buildAreaForecastDays(s, bbox),
        )
      : Promise.resolve(null),
    // climate (focus point)
    hasLoc ? climateFor(db, lng, lat) : Promise.resolve([]),
    // topCities (located shots — incl. targeted CLOSE CITIES)
    wantAreaFrame ? topCitiesFor(db, bbox, zoom) : Promise.resolve([]),
    // nearbyCities (targeted events)
    targeted ? nearbyCitiesFor(db, lng, lat) : Promise.resolve([]),
    // areaAlerts — panels/counts/target-match read only `properties`, never the
    // polygon (the globe draws alert polygons from the SEPARATE overlay feed). So
    // project the coordinates out of the read: a whole-planet WMO/marine alert
    // intersects every bbox, and parsing its millions of vertices into the heap
    // on every located cut was a hard OOM. See areaAlertFeatures / omitCoordinates.
    hasLoc
      ? db.alerts
          .list({ activeOnly: true, bbox, omitCoordinates: true })
          .then((rows) => areaAlertFeatures(rows as unknown as Alert[]))
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
    // country (land shots) — resolved once above, reused for the panel lookup.
    Promise.resolve(resolvedCountry),
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
  const { pointHistory, areaHistory } = histories;

  // Roundups + area-weather report key off the resolved place.
  const countryRoundup = country ? await db.countryRoundups.latestForPlace(country.countryId) : null;
  const regionRoundup = region ? await db.regionRoundups.latestForPlace(region.regionId) : null;
  const areaWeatherReport = isRegion && region
    ? await db.areaWeatherReports.latest("region", region.regionId)
    : country
      ? await db.areaWeatherReports.latest("country", country.countryId)
      : null;

  // Region spotlight forecasts — one worker forecast sample per top member country
  // (at its biggest in-region city) for the per-country slides, plus one at the
  // region's overall biggest city for the NEXT 24H card. Composed HERE so the
  // region deck never fans out per country at cut time (empty off a region shot).
  const [regionCountries, regionNearTerm] = await Promise.all([
    isRegion && region ? regionCountriesFor(region) : Promise.resolve([] as FocusRegionCountry[]),
    isRegion && region ? regionNearTermFor(region) : Promise.resolve([] as FocusBundle["regionNearTerm"]),
  ]);

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

  // On-air alert extras — timeline + metric series + resource links + snapshot
  // metadata — all built once HERE (with the rest of the bundle, no extra per-cut
  // request) for the storm target. All indexed reads on (source, identifier),
  // storm cuts only, so /watch gets everything in the one focus call.
  let alertTimeline: AlertTimelineBeat[] = [];
  let alertSeries: FocusBundle["alertSeries"] = [];
  let alertResources: FocusBundle["alertResources"] = [];
  let alertSnapshots: FocusBundle["alertSnapshots"] = [];
  let watchedEvent: FocusBundle["watchedEvent"] = null;
  let eventTimeline: FocusBundle["eventTimeline"] = [];
  let eventResources: FocusBundle["eventResources"] = [];
  let eventSnapshots: FocusBundle["eventSnapshots"] = [];
  let eventSeries: FocusBundle["eventSeries"] = [];
  if (target?.kind === "storm") {
    const { source: alSource, identifier: alIdent, id: alId } = target.alert.properties;
    const [chain, revisions, series, resources, snapshots, evt] = await Promise.all([
      // buildTimeline reads only chain metadata (id/sent/msgType/severity) — never
      // the polygon — so keep the storm's per-message-duplicated geometry (a huge
      // whole-ocean multipolygon ×N chain messages) out of the heap.
      db.alerts.chain(alSource, alIdent, { omitCoordinates: true }),
      db.alertRevisions.listForAlert(alSource, alIdent),
      db.alertSeries.listForAlert(alSource, alIdent),
      db.alertResources.listForAlert(alSource, alIdent),
      db.alertSnapshots.listForAlert(alSource, alIdent),
      db.watchedEvents.byPrimary(alSource, alIdent),
    ]);
    const focal = chain.find((c) => c.id === alId) ?? chain[chain.length - 1];
    if (focal) alertTimeline = buildTimeline(focal, chain, revisions, new Date());
    alertSeries = series;
    alertResources = resources;
    alertSnapshots = snapshots;

    // Unified event dossier — the cross-source superset (deep-GDACS + later
    // ReliefWeb/Copernicus…). Loaded in the SAME focus call so /watch never fans
    // out per-cut. Empty until the alert was promoted (EVENTS_UNIFIED_ENABLED).
    if (evt?.id) {
      watchedEvent = evt;
      const [updates, evRes, evSnaps, evSeries] = await Promise.all([
        db.eventTimeline.listForEvent(evt.id),
        db.eventResources.listForEvent(evt.id),
        db.eventSnapshots.listForEvent(evt.id),
        db.eventSeries.listForEvent(evt.id),
      ]);
      eventTimeline = buildEventTimeline(evt, updates);
      eventResources = evRes;
      eventSnapshots = evSnaps;
      eventSeries = evSeries;
    }
  } else if (target?.kind === "volcano") {
    // Volcano observation dossier — the WatchedEvent (type VOLCANO) the volcano
    // was promoted to, plus its stored status timeline and any captured
    // media/plots (P2/P3). Keyed on ("gvp", volcanoId); same one-focus-call
    // discipline. Empty until promoted (EVENTS_UNIFIED_ENABLED).
    const evt = await db.watchedEvents.byPrimary("gvp", target.volcano.id);
    if (evt?.id) {
      watchedEvent = evt;
      const [updates, evRes, evSnaps, evSeries] = await Promise.all([
        db.eventTimeline.listForEvent(evt.id),
        db.eventResources.listForEvent(evt.id),
        db.eventSnapshots.listForEvent(evt.id),
        db.eventSeries.listForEvent(evt.id),
      ]);
      eventTimeline = buildEventTimeline(evt, updates);
      eventResources = evRes;
      eventSnapshots = evSnaps;
      eventSeries = evSeries;
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
    alertTimeline,
    alertSeries,
    alertResources,
    alertSnapshots,
    watchedEvent,
    eventTimeline,
    eventResources,
    eventSnapshots,
    eventSeries,
    areaAlerts,
    areaQuakes,
    areaVolcanoes,

    country,
    countryRoundup,
    region,
    regionRoundup,
    regionCountries,
    regionNearTerm,
    areaWeather: areaWeatherReport,

    seismoStations,
    tideStations,
    nearbyCams: [], // TODO(phase-3): cams already load globally via useCams
    depthProfile: null, // TODO: ocean-kind depth profile
  };
}

/** How many of a region's biggest member countries get a per-country slide. */
const REGION_COUNTRY_LIMIT = 5;
/** Forecast track horizon for the region slides (the detailed 3-hourly window). */
const REGION_STEP_HOURS = 72;

/** The region's biggest member countries (population-ranked from the enriched
 *  dossier), each with a 72h forecast sampled at its biggest in-region city.
 *  Countries with no sampleable city in the dossier are dropped. */
async function regionCountriesFor(region: iRegionModel): Promise<FocusRegionCountry[]> {
  const cities = region.topCities ?? [];
  const top = [...(region.countries ?? [])]
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .slice(0, REGION_COUNTRY_LIMIT);
  const built = await Promise.all(
    top.map(async (c): Promise<FocusRegionCountry | null> => {
      const cc = c.cc?.toLowerCase();
      const sample = cities
        .filter((ci) => cc && ci.cc && ci.cc.toLowerCase() === cc)
        .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
      if (!sample) return null;
      const series = await workerForecastPoint({
        lat: sample.lat,
        lng: sample.lng,
        variables: FORECAST_VARIABLES,
        maxHours: REGION_STEP_HOURS,
      });
      const { steps } = await buildForecastSteps(series, sample.lat, sample.lng);
      return {
        cc: (c.cc ?? "").toLowerCase(),
        name: c.name,
        population: c.population,
        sampleName: sample.name,
        lat: sample.lat,
        lng: sample.lng,
        steps,
      };
    }),
  );
  return built.filter((x): x is FocusRegionCountry => x != null);
}

/** The region's 72h forecast at its single biggest city (else bbox centre) — the
 *  NEXT 24H near-term card's data. */
async function regionNearTermFor(region: iRegionModel): Promise<FocusBundle["regionNearTerm"]> {
  const top = (region.topCities ?? [])[0];
  const lat = top ? top.lat : (region.bbox[1] + region.bbox[3]) / 2;
  const lng = top ? top.lng : (region.bbox[0] + region.bbox[2]) / 2;
  const series = await workerForecastPoint({
    lat,
    lng,
    variables: FORECAST_VARIABLES,
    maxHours: REGION_STEP_HOURS,
  });
  const { steps } = await buildForecastSteps(series, lat, lng);
  return steps;
}

/** Top cities in view (population-sorted) with climate baked in — kills the N+1. */
async function topCitiesFor(
  db: Awaited<ReturnType<typeof getAppDb>>,
  bbox: [number, number, number, number],
  zoom: number,
): Promise<FocusCity[]> {
  const [w, s, e, nth] = bbox;
  const query: Record<string, unknown> = { population: { $gte: regionMinPop(zoom) } };
  query.loc = cityGeoWithinBox(w, s, e, nth);
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
    loc: cityGeoWithinBox(lng - half, lat - half, lng + half, lat + half),
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
