/**
 * FocusBundle — the single, cacheable payload for one on-air "thing".
 *
 * A broadcast cut used to fire 30–80 uncoordinated requests (a per-variable
 * history waterfall, the same point history fetched three times, one climate
 * request per visible city, the roundup/region/country fetched separately). This
 * bundle is composed once server-side (`getFocusBundle`) and pulled once per cut
 * through `FocusProvider`.
 *
 * Design rule: every field is the *exact payload the corresponding hook returns
 * today*, so the selector hooks are drop-in and the slide components' own
 * transform code stays untouched. We reuse the already-exported types and only
 * add named interfaces where the code was previously anonymous.
 *
 * Lives in `public` (not `shared`) because most reused types (HistorySeries,
 * ForecastDay, City, CountryAt, PlaceRoundup…) live under `public/src/lib`, and
 * `shared` cannot depend on `public`. When the worker pre-warm phase needs the
 * contract, the shared subset moves down then.
 */
import type { SegmentKind } from "@photonsurge/shared/director";
import type { AlertTimelineBeat } from "@photonsurge/shared/alerts/timeline";
import type { AlertNarrative } from "@photonsurge/shared/alerts/narrative";
import type { iAlertSeries } from "@photonsurge/shared/db/alert-series-model";
import type { iAlertResource } from "@photonsurge/shared/db/alert-resource-model";
import type { AlertSnapshotMeta } from "@photonsurge/shared/db/alert-snapshot-repo";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import type { iEventResource } from "@photonsurge/shared/db/event-resource-model";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { iEventSeries } from "@photonsurge/shared/db/event-series-model";
import type { Quake } from "@photonsurge/shared/tracks/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { Cam } from "@photonsurge/shared/cams/types";
import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import type { VolcanoEruption } from "@photonsurge/shared/db/volcano-eruption-repo";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";
import type { iAreaWeatherReport } from "@photonsurge/shared/db/area-weather-report-model";

import type { HistorySeries, AreaHistorySeries } from "../weather-history";
import type { ForecastDay, AreaForecastDay, ForecastStep } from "../weather-forecast";
import type { ClimateBucketedDataset } from "../history-client";
import type { City, CityCondition, CityConditionDay } from "../cities";
import type { CountryAt } from "../countries";
import type { SeismoStationReading } from "../seismo/types";
import type { TideStationReading } from "../tides/types";
import type { DepthProfilePoint } from "../depthProfile";
import type { AlertFeature } from "../alerts";
import type { AlertBlobSummary } from "@photonsurge/shared/db/alert-blob-repo";
import type { iBlobCity } from "@photonsurge/shared/db/alert-blob-model";
import type { iCityWeatherDay, iCityWeatherNow } from "@photonsurge/shared/db/city-weather-model";
import type { PlaceRoundup } from "../placeRoundups";
import type { LocalZone } from "@photonsurge/shared/time/local-zone";

/** How much depth to compose. `broadcast` = the lean slice the on-air panels
 *  render; `admin`/`full` widen the variable set + history window for /admin and
 *  future public web. */
export type FocusDetail = "broadcast" | "admin" | "full";

/** What the client asks for. `subject` is the entity id from `Segment.id`
 *  ("kind:subject", e.g. "quake:us7000abcd", "region:sahel"). */
export interface FocusRequest {
  kind: SegmentKind;
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
  detail: FocusDetail;
  subject?: string | null;
}

/** The specific on-air entity this cut is about — the *full* doc, discriminated
 *  by kind so panels get the right object typed. Loaded by `subject` id, not by
 *  nearest. `null` for wide shots / summary / anything without a subject. */
export type FocusTarget =
  | { kind: "quake"; quake: Quake }
  | { kind: "volcano"; volcano: Volcano }
  | { kind: "storm"; alert: AlertFeature }
  | null;

/** A city with its climate baked in — kills the per-row `useClimateYear` N+1. */
/**
 * A city under a dissolved warning shape, with what the weather is doing there.
 *
 * The geography is baked by the worker onto the blob; the conditions are joined
 * at compose time from the hourly `cityWeather` cache — a blob is rebuilt on its
 * own schedule, so anything weather-shaped baked into it would go stale.
 *
 * `current`/`daily` are absent for cities below the cache's population floor
 * (100k), which is most of them. A caption must handle a nameless-number city:
 * missing conditions is the normal case, not an error.
 */
export interface FocusBlobCity extends iBlobCity {
  current?: iCityWeatherNow;
  /** Next 3 days, hi/lo/rain/gust. */
  daily?: iCityWeatherDay[];
}

/** A dissolved warning shape for this view — hazard, extent, and who's under it. */
export interface FocusAlertBlob extends Omit<AlertBlobSummary, "cities"> {
  /** Cities inside BOTH the shape and the view, biggest first. */
  cities: FocusBlobCity[];
  /** How many of `cities` came back with cached conditions. */
  citiesWithConditions: number;
}

export interface FocusCity {
  city: City;
  climate: ClimateBucketedDataset[];
}

/**
 * How a bundle's `topCities` (the CITY GUIDE) were picked:
 *  • `area` — biggest cities inside the framed bbox (plain wide / region shots);
 *  • `country` — the spotlight country's own biggest cities, by ISO code;
 *  • `footprint` — the cities INSIDE a storm alert's polygon, biggest first;
 *  • `nearest` — the closest towns of ≥10k people to a targeted event (a quake,
 *    volcano, or a storm with no drawable shape — then within its country).
 * See `target-cities.ts`.
 */
export type TopCitiesBasis = "area" | "country" | "footprint" | "nearest";

/** A nearby city (targeted-event decks) with distance + baked climate. */
export interface FocusNearbyCity {
  city: City;
  distanceKm: number;
  climate: ClimateBucketedDataset[];
}

/** One of a region's biggest cities (with its cached now + 3-day forecast) shown
 *  on a country slide's city list. */
export interface FocusRegionCity {
  cityId: string;
  name: string;
  /** Current temperature (°C), from the CityWeather cache. */
  temp?: number;
  /** 3-day daily forecast (hi/lo/rain/gust), from the CityWeather cache. */
  daily?: CityConditionDay[];
}

/** One of a region's biggest member countries with its own weather — a region
 *  spotlight's per-country slide. Composed server-side (one worker forecast
 *  sample per country + cache reads) so /watch never fans out per country at cut
 *  time. */
export interface FocusRegionCountry {
  /** ISO-3166 alpha-2, lowercase. */
  cc: string;
  name: string;
  population?: number;
  /** The city the point forecast was sampled at (biggest in-region city). */
  sampleName: string;
  lat: number;
  lng: number;
  /** 3-hourly today..+72h forecast track at the sample point (buildForecastSteps). */
  steps: ForecastStep[];
  /** 3-day daily card strip at the sample point (buildForecastDays). */
  days: ForecastDay[];
  /** AI "state of the place right now" headline — the CountryRoundup's `summary`,
   *  when the country has a round-up. Absent otherwise. */
  summary?: string;
  /** AI next-24h outlook — the CountryRoundup's per-city outlook for the sample
   *  city (else its advice). Absent when the country has no round-up. */
  outlook?: string;
  /** The country's biggest in-region cities (up to ~4) with cached now + 3-day. */
  cities: FocusRegionCity[];
}

/**
 * Everything one on-air "thing" needs, in one payload. Arrays are empty (never
 * omitted) when a field doesn't apply to the kind — keeps consumers + tests
 * branch-free.
 */
export interface FocusBundle {
  // identity / provenance (drives the cache key + test assertions)
  key: string;
  kind: SegmentKind;
  detail: FocusDetail;
  subject: string | null;
  /** [lng, lat], rounded to the canonical grid */
  center: [number, number];
  zoom: number;
  bbox: [number, number, number, number];
  /** epoch ms — stamped after compose; NOT part of the key */
  generatedAt: number;

  // weather — exact hook payloads
  pointHistory: HistorySeries[];
  areaHistory: AreaHistorySeries[];
  pointForecast: ForecastDay[];
  areaForecast: AreaForecastDay[];
  climate: ClimateBucketedDataset[];

  // cities (climate baked in)
  topCities: FocusCity[];
  /** How `topCities` was chosen — the CITY GUIDE overview heading says so. */
  topCitiesBasis: TopCitiesBasis;
  nearbyCities: FocusNearbyCity[];
  cityConditions: CityCondition[];

  // the thing on air + area context
  target: FocusTarget;
  /**
   * What the on-air storm's warning actually SAYS — headline, description,
   * instruction and its named areas, translation preferred (see
   * shared/alerts/narrative). Composed from the focal CAP message the timeline
   * already loads, so it costs no extra read. Null off a storm cut, and for a
   * bulletin carrying no text at all.
   *
   * Deliberately NOT on every `areaAlerts` feature: a multi-area alert emits one
   * feature PER AREA, so a paragraph on the feature props would ride the bundle
   * a hundred times over for one Spanish warning.
   */
  alertNarrative: AlertNarrative | null;
  /** Derived change timeline for the on-air storm's alert (empty for non-storm cuts). */
  alertTimeline: AlertTimelineBeat[];
  /** The storm alert's metric series (GDACS score/severity/population), for graphs. */
  alertSeries: iAlertSeries[];
  /** Harvested official resource links for the storm alert. */
  alertResources: iAlertResource[];
  /** Captured satellite/camera snapshot metadata for the storm alert (bytes via /api/alerts/snapshot/:id). */
  alertSnapshots: AlertSnapshotMeta[];
  /** The unified WatchedEvent the storm was promoted to (null when not promoted / not a storm). */
  watchedEvent: iWatchedEvent | null;
  /** The unified (cross-source) event timeline — superset of alertTimeline once external sources contribute. */
  eventTimeline: EventTimelineBeat[];
  /** Official resources harvested from every contributing source (GDACS/ReliefWeb/Copernicus…). */
  eventResources: iEventResource[];
  /** Event snapshot metadata (bytes via /api/events/snapshot/:id). */
  eventSnapshots: EventSnapshotMeta[];
  /** Cross-source metric series for the event (deep-GDACS score/severity/population…). */
  eventSeries: iEventSeries[];
  areaAlerts: AlertFeature[];
  /**
   * The dissolved warning shapes over this view — one per hazard+severity rather
   * than one per county — each naming the cities under it.
   *
   * The companion to `areaAlerts`, not a replacement: `areaAlerts` is still the
   * per-warning truth a panel lists, while a blob answers "what weather is over
   * this place, and who's in it" without the caller unioning 550 Polish counties
   * or running a point-in-polygon to find the towns. Carries NO geometry, for the
   * same reason `areaAlerts` drops its coordinates — the globe draws shapes from
   * its own overlay feed.
   */
  areaBlobs: FocusAlertBlob[];
  areaQuakes: Quake[];
  areaVolcanoes: Volcano[];

  /**
   * The local clock at the focus point — an IANA zone read off the nearest
   * catalogued city, else a longitude estimate. Composed here (a Mongo read) so
   * the on-air LOCAL TIME row never fetches per cut; the client does the ticking
   * from this zone. Null for shots with no real ground location (global spin,
   * orbital, ocean).
   */
  localZone: LocalZone | null;

  // place + roundup (country & region)
  country: CountryAt | null;
  countryRoundup: PlaceRoundup | null;
  region: iRegionModel | null;
  regionRoundup: PlaceRoundup | null;
  /** The region's biggest member countries, each with its own 72h forecast — the
   *  region spotlight's per-country slides. Empty off a region shot. */
  regionCountries: FocusRegionCountry[];
  /** The region's 72h forecast at its single biggest city (else bbox centre) — the
   *  region spotlight's NEXT 24H near-term slide. Empty off a region shot. */
  regionNearTerm: ForecastStep[];
  areaWeather: iAreaWeatherReport | null;

  // geophysics / media
  seismoStations: SeismoStationReading[];
  tideStations: TideStationReading[];
  nearbyCams: Cam[];
  /** Latest stored camera, satellite and official imagery for the focused volcano. */
  volcanoMedia: VolcanoMedia[];
  /**
   * The focused volcano's ACTIVE cameras, already joined to OUR stored copy of
   * each one's latest frame — composed here so no panel has to do the join or
   * fetch anything per cut.
   */
  volcanoCams: FocusVolcanoCam[];
  /** The focused volcano's full GVP eruption history, newest first. */
  volcanoEruptions: VolcanoEruption[];
  depthProfile: DepthProfilePoint[] | null;
}

/**
 * One on-air volcano camera. `localImageUrl` is OUR OWN stored copy of the frame
 * (the worker already downloads every camera into `volcano_media` — see
 * `cameraRefresh`), served from `/api/volcanoes/media/:id`. Prefer it on air:
 * hot-linking the provider means a slide goes blank whenever they're down, slow,
 * or blocking us — and it re-fetches their server on every viewer's browser.
 * `upstreamImageUrl` is the fallback for a camera we haven't stored yet.
 * Cameras an operator switched off never appear here.
 */
export interface FocusVolcanoCam {
  camId: string;
  title: string;
  provider?: string;
  attribution?: string;
  localImageUrl?: string;
  upstreamImageUrl?: string;
  /** When the stored frame was actually observed (not when we fetched it). */
  observedAt?: string;
}
