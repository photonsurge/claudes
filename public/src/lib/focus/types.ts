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
import type { Quake } from "@photonsurge/shared/tracks/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { Cam } from "@photonsurge/shared/cams/types";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";
import type { iAreaWeatherReport } from "@photonsurge/shared/db/area-weather-report-model";

import type { HistorySeries, AreaHistorySeries } from "../weather-history";
import type { ForecastDay, AreaForecastDay } from "../weather-forecast";
import type { ClimateBucketedDataset } from "../history-client";
import type { City, CityCondition } from "../cities";
import type { CountryAt } from "../countries";
import type { SeismoStationReading } from "../seismo/types";
import type { TideStationReading } from "../tides/types";
import type { DepthProfilePoint } from "../depthProfile";
import type { AlertFeature } from "../alerts";
import type { PlaceRoundup } from "../placeRoundups";

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
export interface FocusCity {
  city: City;
  climate: ClimateBucketedDataset[];
}

/** A nearby city (targeted-event decks) with distance + baked climate. */
export interface FocusNearbyCity {
  city: City;
  distanceKm: number;
  climate: ClimateBucketedDataset[];
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
  nearbyCities: FocusNearbyCity[];
  cityConditions: CityCondition[];

  // the thing on air + area context
  target: FocusTarget;
  areaAlerts: AlertFeature[];
  areaQuakes: Quake[];
  areaVolcanoes: Volcano[];

  // place + roundup (country & region)
  country: CountryAt | null;
  countryRoundup: PlaceRoundup | null;
  region: iRegionModel | null;
  regionRoundup: PlaceRoundup | null;
  areaWeather: iAreaWeatherReport | null;

  // geophysics / media
  seismoStations: SeismoStationReading[];
  tideStations: TideStationReading[];
  nearbyCams: Cam[];
  depthProfile: DepthProfilePoint[] | null;
}
