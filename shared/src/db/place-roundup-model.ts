import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A generated per-place "round-up": a point-in-time AI narrative of what the
 * weather + hazards are doing across ONE country or region, produced on a 12h
 * cadence. Unlike the global EventSummary round-ups, each call is fed the
 * PREVIOUS round-up for the same place so the model writes continuity ("since
 * our last update 12h ago…"), and the inputs are place-scoped: the top cities'
 * conditions, the country/region area-weather aggregate, every active alert and
 * volcano inside the place, and the nearest tide/seismograph gauge readings.
 *
 * Stored in TWO collections — `CountryRoundup` and `RegionRoundup` — because
 * these accrue forever (enabled-countries × every 12h), so keeping them apart
 * from each other (and from the global summaries) keeps each history lean.
 * History is kept — never overwritten — same convention as EventSummary /
 * AreaWeatherReport.
 */
export type PlaceRoundupKind = "country" | "region";
export type RoundupNarrativeStatus = "ok" | "skipped" | "error";

/** 0 = keep every round-up forever; >0 = expire old ones (env escape hatch). */
const TTL_SEC = Number(process.env.PLACE_ROUNDUP_TTL_SEC || 0);

/** One of the place's biggest cities with its cached current conditions. */
export interface iRoundupCity {
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
  /** True for the country's capital — always included even below the top-10 cut. */
  isCapital?: boolean;
  /** Latest reading — the city "meter" (temp °C, wind m/s, rain mm). */
  temp?: number;
  wind?: number;
  rain?: number;
  /** Today's daily hi/lo (°C) from the 3-day forecast, when available. */
  hi?: number;
  lo?: number;
}

/** One variable's area-weather aggregate over the whole place (mean/min/max). */
export interface iRoundupAreaStat {
  variable: string;
  units: string;
  mean: number;
  min: number;
  max: number;
}

/** A hazard flag derived for the place from this hour's area-weather. */
export interface iRoundupHazard {
  hazard: string;
  severityRank: number;
  label: string;
}

/** One active alert whose footprint falls inside the place. */
export interface iRoundupAlert {
  event: string;
  headline?: string;
  severityRank: number;
  hazard?: string;
  onset?: string;
  source?: string;
  lng?: number;
  lat?: number;
}

/** One active (erupting/unrest) volcano inside the place. */
export interface iRoundupVolcano {
  name: string;
  status: string;
  lng: number;
  lat: number;
}

/** A nearest-gauge reading (tide or seismograph) associated with the place. */
export interface iRoundupGauge {
  name: string;
  /** Latest sample value (m for tide gauges; ground velocity counts for seismo). */
  latest: number;
  distanceKm?: number;
}

/** The full deterministic fact-set fed to the LLM, stored for audit/replay. */
export interface iPlaceRoundupInputs {
  topCities: iRoundupCity[];
  area?: { stats: iRoundupAreaStat[]; hazards: iRoundupHazard[] } | null;
  /** Most-severe active alerts inside the place — bounded so the LLM prompt stays
   *  within token limits; `alertsTotal` is the true count before the cap. */
  alerts: iRoundupAlert[];
  alertsTotal?: number;
  volcanoes: iRoundupVolcano[];
  tideGauges: iRoundupGauge[];
  seismoStations: iRoundupGauge[];
}

/** LLM call metadata (present when a narrative was attempted). */
export interface iRoundupLlm {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface iPlaceRoundup extends iGeneralModel {
  placeKind: PlaceRoundupKind;
  /** Country.countryId or Region.regionId. */
  placeId: string;
  name: string;
  generatedAt: Date;
  /** Aggregation window (ISO). */
  windowStart: string;
  windowEnd: string;
  /** Exactly what the LLM saw. */
  inputs: iPlaceRoundupInputs;
  /** LLM prose; "" when skipped/errored. */
  narrative: string;
  narrativeStatus: RoundupNarrativeStatus;
  /** The round-up this one was told about (continuity chain), if any. */
  prevRoundupId?: string;
  llm?: iRoundupLlm;
}

export interface iPlaceRoundupModel extends iPlaceRoundup {
  id: string;
  _id: string;
}

const PlaceRoundupSchema = new mongoose.Schema<iPlaceRoundupModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    placeKind: { type: String, required: true, enum: ["country", "region"] },
    placeId: { type: String, required: true },
    name: { type: String, required: true },
    generatedAt: { type: Date, required: true, default: () => new Date() },
    windowStart: { type: String, required: true },
    windowEnd: { type: String, required: true },
    // The input snapshot is a nested, evolving shape read only for audit/display
    // — Mixed keeps it whole (same precedent as EventSummary.llm / satImgFeeds).
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    // NOT required: "" is the documented skipped/errored case, and Mongoose's
    // String required-check rejects "" — the default already guarantees a value.
    narrative: { type: String, default: "" },
    narrativeStatus: { type: String, required: true, default: "skipped" },
    prevRoundupId: { type: String, required: false },
    llm: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  mongoTimestamps,
);

// Latest-per-place read + history newest-first.
PlaceRoundupSchema.index({ placeKind: 1, placeId: 1, generatedAt: -1 }, { name: "place_roundup_place_gen_ix" });
if (TTL_SEC > 0)
  PlaceRoundupSchema.index({ generatedAt: 1 }, { name: "place_roundup_ttl_ix", expireAfterSeconds: TTL_SEC });

/** The country round-up collection. */
export const getCountryRoundupModel = (conn: Connection) =>
  getModel<iPlaceRoundupModel>(conn, "CountryRoundup", PlaceRoundupSchema);

/** The region round-up collection (same shape, separate table). */
export const getRegionRoundupModel = (conn: Connection) =>
  getModel<iPlaceRoundupModel>(conn, "RegionRoundup", PlaceRoundupSchema);
