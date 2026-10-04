import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Canonical, CAP-shaped weather alert. One document per CAP *message* (not per
 * logical alert — logical grouping is derived by walking `references`). Every
 * source adapter normalises its native feed onto this single shape, so adding a
 * region later means writing one adapter, not a new schema.
 *
 * See `weather-alerts-ingester-spec.md` §3. Dedup key is `(source, identifier)`.
 */

export type AlertMsgType = "Alert" | "Update" | "Cancel" | "Ack" | "Error";
export type AlertStatus = "Actual" | "Exercise" | "System" | "Test" | "Draft";
export type AlertScope = "Public" | "Restricted" | "Private";

/** Normalised cross-source severity. Native value is kept in `sourceSeverity`. */
export type SeverityRank = 0 | 1 | 2 | 3 | 4;

/** Minimal GeoJSON geometry (Polygon/MultiPolygon/Point) without a @types/geojson dep. */
export interface AlertGeometry {
  type: string;
  coordinates: unknown;
}

export interface iAlertArea {
  areaDesc: string;
  /** GeoJSON polygon/multipolygon where the source provides one, else null. */
  geometry?: AlertGeometry | null;
  /** UGC / FIPS / SAME / EMMA_ID etc. for geocode-only feeds. */
  geocodes: { valueName: string; value: string }[];
}

export interface iAlertInfo {
  language?: string;
  category: string[];
  /** Controlled vocabulary, e.g. "Thunderstorm", "Flood" — see alerts/events. */
  event: string;
  urgency?: string;
  severity?: string;
  certainty?: string;
  /** NORMALISED 0–4 rank across sources. */
  severityRank: SeverityRank;
  onset?: string;
  effective?: string;
  expires?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  web?: string;
  /** Raw native level, e.g. "orange", "amber", "level 3". */
  sourceSeverity?: string;
  /** Source-specific extras, untouched. */
  parameters?: Record<string, string>;
  area: iAlertArea[];

  // translation enrichment (worker/src/alerts/translate.ts) — filled lazily, not part of the source feed
  /** LLM-detected language of headline/description, e.g. "zh". Distinct from `language` (source-declared, often absent). */
  detectedLanguage?: string;
  translatedHeadline?: string;
  translatedDescription?: string;
  translatedInstruction?: string;
  translatedAt?: string;
  /** sha1 of `headline|description|instruction` at the time of translation — lets re-ingested-but-unchanged alerts skip re-translation. */
  translationHash?: string;
}

/**
 * A city standing inside an alert's footprint, denormalised onto the alert. The
 * same shape the dissolved blobs carry (`iBlobCity`) — a copy, not a reference,
 * so a reader gets a caption-ready answer with no second query; the City doc is
 * still loaded by `id` when a slide wants the photo and blurb.
 */
export interface iAlertCity {
  id: string;
  name: string;
  /** ISO-3166 alpha-2. */
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
}

/** How many footprint cities an alert keeps (biggest first). The on-air CITY
 *  GUIDE airs at most 8; a little headroom lets a slide skip a city with no
 *  City doc behind it without running short. */
export const ALERT_CITY_CAP = 12;

export interface iAlert extends iGeneralModel {
  // identity
  source: string;
  identifier: string;
  sender: string;
  sent: string;
  /**
   * The CANONICAL national CAP identifier this alert reports
   * ("2.49.0.0.616.0.PL.Sk20260715120207440.PL3202").
   *
   * `identifier` is per-source and can never merge — WMO keys by its `capurl`,
   * MeteoAlarm by the CAP id. But both are republishing the SAME national CAP
   * message, and this is the id that message carries, so two sources reporting
   * one warning share a `capId`. That makes cross-source dedup EXACT rather than
   * fuzzy (see docs/alert-dedup-merge-plan.md).
   *
   * Absent when a source has no national CAP behind it (GDACS) or when WMO's
   * capurl hasn't been resolved yet — so always treat it as optional.
   */
  capId?: string;

  // message-level
  msgType: AlertMsgType;
  status: AlertStatus;
  scope?: AlertScope;
  references: string[];

  info: iAlertInfo[];

  // lifecycle / derived
  ingestedAt: string;
  active: boolean;
  /** Highest `severityRank` across `info[]` — denormalised for cheap sort/filter. */
  maxSeverityRank: SeverityRank;
  /** Earliest `info.expires` across the message — for the expiry sweep. */
  expiresAt?: string;
  raw?: unknown;

  /**
   * Rough count of people under this warning: the summed population of every
   * catalogued city inside the alert's drawable footprint (see
   * worker/src/alerts/population.ts). A cities-based ESTIMATE, not a census —
   * it misses rural population, counts a whole city even when the polygon only
   * clips its edge, and only sees towns above the seeded GeoNames tier.
   *
   * Derived, not from the feed: resolved by the worker's reconcile sweep with a
   * `$geoWithin` against the cities' 2dsphere `loc`, so it stays fresh as an
   * alert's geometry is backfilled (MeteoAlarm ships EMMA codes; polygons land
   * later). Absent for a geocode-only alert that never resolves to a shape.
   */
  population?: number;
  /** How many catalogued cities `population` was summed over. */
  cityCount?: number;
  /**
   * The biggest catalogued cities INSIDE the footprint, population-desc, capped
   * at {@link ALERT_CITY_CAP} — the on-air CITY GUIDE for a storm cut. Written by
   * the same reconcile sweep as `population` (it is the same `$geoWithin`, kept
   * instead of thrown away), so the broadcast surface never runs a
   * point-in-polygon: it reads this list and loads the City docs by id. Empty
   * for a shape with nobody catalogued inside; absent for a geocode-only alert
   * or one the sweep hasn't reached yet — in both cases the focus composer falls
   * back to the nearest cities in the alert's country.
   */
  cities?: iAlertCity[];
  /**
   * Signature of the drawable footprint the last `population` was computed from
   * — `sent` plus which areas carry a geometry. The reconcile sweep recomputes
   * only when this changes (a new CAP version, or an area's polygon backfilled),
   * so a steady-state re-poll of thousands of alerts does no geo work.
   */
  populationSig?: string;
}

export interface iAlertModel extends iAlert {
  id: string;
  _id: string;
}

const AlertCitySchema = new mongoose.Schema<iAlertCity>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    cc: { type: String, required: false },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    population: { type: Number, required: false },
  },
  { _id: false },
);

const AlertAreaSchema = new mongoose.Schema<iAlertArea>(
  {
    areaDesc: { type: String, required: true, default: "" },
    // NO `default: null`. The 2dsphere index below is sparse per DOC, not per array
    // element: the moment ONE area has a geometry, Mongo indexes the doc and reads
    // every element, and an explicit `geometry: null` sibling rejects the whole
    // write ("geo element must be an array or object"). A MISSING field is skipped
    // happily. Partly-resolved alerts are now the norm (a Spanish alert has ~100
    // areas and the boundary cache fills a few at a time), so unresolved areas must
    // carry no geometry key at all rather than a null one.
    geometry: { type: mongoose.Schema.Types.Mixed, required: false },
    geocodes: {
      type: [
        new mongoose.Schema(
          { valueName: { type: String, required: true }, value: { type: String, required: true } },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const AlertInfoSchema = new mongoose.Schema<iAlertInfo>(
  {
    language: { type: String, required: false },
    category: { type: [String], default: [] },
    event: { type: String, required: true, default: "" },
    urgency: { type: String, required: false },
    severity: { type: String, required: false },
    certainty: { type: String, required: false },
    severityRank: { type: Number, required: true, min: 0, max: 4, default: 0 },
    onset: { type: String, required: false },
    effective: { type: String, required: false },
    expires: { type: String, required: false },
    headline: { type: String, required: false },
    description: { type: String, required: false },
    instruction: { type: String, required: false },
    web: { type: String, required: false },
    sourceSeverity: { type: String, required: false },
    parameters: { type: mongoose.Schema.Types.Mixed, required: false },
    area: { type: [AlertAreaSchema], default: [] },

    detectedLanguage: { type: String, required: false },
    translatedHeadline: { type: String, required: false },
    translatedDescription: { type: String, required: false },
    translatedInstruction: { type: String, required: false },
    translatedAt: { type: String, required: false },
    translationHash: { type: String, required: false },
  },
  { _id: false },
);

const AlertSchema = new mongoose.Schema<iAlertModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    source: { type: String, required: true, trim: true, maxlength: 64 },
    identifier: { type: String, required: true, trim: true, maxlength: 512 },
    capId: { type: String, required: false, trim: true, maxlength: 512 },
    sender: { type: String, required: false, default: "", maxlength: 512 },
    sent: { type: String, required: false, default: "" },

    msgType: { type: String, required: true, default: "Alert" },
    status: { type: String, required: true, default: "Actual" },
    scope: { type: String, required: false },
    references: { type: [String], default: [] },

    info: { type: [AlertInfoSchema], default: [] },

    ingestedAt: { type: String, required: true, default: () => new Date().toISOString() },
    active: { type: Boolean, required: true, default: true },
    maxSeverityRank: { type: Number, required: true, min: 0, max: 4, default: 0 },
    expiresAt: { type: String, required: false },
    raw: { type: mongoose.Schema.Types.Mixed, required: false },

    // Derived by the reconcile sweep (worker/src/alerts/population.ts), not the
    // feed — the cities-based "people under this warning" estimate + its
    // freshness signature. All optional: a geocode-only alert never gets one.
    population: { type: Number, required: false },
    cityCount: { type: Number, required: false },
    cities: { type: [AlertCitySchema], required: false },
    populationSig: { type: String, required: false },
  },
  mongoTimestamps,
);

// Dedup key — the heart of upsert/supersede (spec §5).
AlertSchema.index({ source: 1, identifier: 1 }, { unique: true, name: "alert_dedup_ix" });
// Unchanged-alert fast path: upsert() projects {sent,active} by (source,identifier)
// to skip re-writing an already-active, same-`sent` alert on a full-feed re-poll.
// Extending the dedup key with these two makes that check index-COVERED — it never
// touches the (large) geometry doc. See alerts-repo.ts#upsert.
AlertSchema.index({ source: 1, identifier: 1, sent: 1, active: 1 }, { name: "alert_ver_ix" });
// "active now" list — matches list()'s sort exactly so the polled /api/alerts
// read is fully index-served (no in-memory sort of thousands of CAP docs).
AlertSchema.index({ active: 1, maxSeverityRank: -1, sent: -1 }, { name: "alert_active_sev_sent_ix" });
// HISTORICAL day reads (/admin/archive): "which alerts were in force on date D".
// Nothing else queries this collection by time alone — every other read is scoped
// by `active` or by (source, identifier) — so without this the day view is a
// collection scan plus an in-memory sort over every alert ever ingested, which
// past a few hundred thousand documents does not just get slow, it exceeds
// Mongo's 32MB sort limit and errors. Ordered to match the day query's sort
// exactly so the read is fully index-served.
AlertSchema.index({ sent: -1, maxSeverityRank: -1 }, { name: "alert_sent_sev_ix" });
// Per-source sweeps (expiry, supersede, deactivate-missing).
AlertSchema.index({ source: 1, active: 1 }, { name: "alert_source_active_ix" });
// The director's fresh-event watch: "first seen after T" (createdSince).
AlertSchema.index({ created: 1 }, { name: "alert_created_ix" });
// Cross-source merge: find every source reporting one national CAP message.
// Sparse — GDACS has no capId, and WMO's is null until its capurl is resolved.
AlertSchema.index({ capId: 1, active: 1 }, { name: "alert_capid_ix", sparse: true });
// Point/region lookups ($geoIntersects). Sparse: geocode-only feeds have no geometry.
AlertSchema.index({ "info.area.geometry": "2dsphere" }, { name: "alert_geo_ix", sparse: true });
// Area-scoped ACTIVE-alert intersect — the focus bundle's areaAlerts + /api/alerts?bbox
// ({active:true, "info.area.geometry":$geoIntersects}). Without the active-equality
// prefix the planner prefers the active-sort index and scans EVERY active alert
// (thousands), geo-filtering in memory for a handful of hits — and keeps burning
// ~1s replanning that terrible plan. The partial filter is important: `sparse`
// only excludes documents without geometry; it would still retain every inactive
// historical alert. Keeping only active documents makes both reads and lifecycle
// updates cheaper as expired/superseded alerts leave the index.
AlertSchema.index(
  { active: 1, "info.area.geometry": "2dsphere" },
  {
    name: "alert_active_geo_ix",
    partialFilterExpression: { active: true },
  },
);

export const getAlertModel = (conn: Connection) => getModel<iAlertModel>(conn, "Alert", AlertSchema);
