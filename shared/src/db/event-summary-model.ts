import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { SeverityRank } from "./alert-model";

/**
 * A generated "round-up": a point-in-time summary of globally-active weather
 * events (alerts, quakes, cyclones, tracks) for one cadence. The worker appends
 * one document per generation — history is kept so a round-up can later feed a
 * broadcast scene. Deterministic `stats`/`hotspots`/`topEvents` are always
 * present; `narrative` is the LLM prose (empty when the LLM is skipped/errors).
 */

export type SummaryPeriod = "hourly" | "12h" | "daily";
export type NarrativeStatus = "ok" | "skipped" | "error";

/** 0 = keep every round-up forever (history feeds broadcast); >0 = expire old ones. */
const TTL_SEC = Number(process.env.SUMMARY_TTL_SEC || 0);

/** A geographic cluster of nearby events across all kinds. */
export interface iSummaryHotspot {
  /** Human label, e.g. "Southern Europe" or a lng/lat cell fallback. */
  label: string;
  /** Cluster centroid. */
  lng: number;
  lat: number;
  /** Events in the cluster. */
  count: number;
  /** Highest severity in the cluster (quakes mapped onto the same 0–4 scale). */
  maxSeverity: SeverityRank;
  /** Distinct hazard categories present. */
  hazards: string[];
  /** Distinct event kinds present, e.g. ["alert","quake"]. */
  kinds: string[];
}

/** A single notable event surfaced in the round-up. */
export interface iSummaryTopEvent {
  kind: "alert" | "quake" | "track";
  /** Source id — alert.id / quakeId / track externalId. */
  refId: string;
  title: string;
  severity: SeverityRank;
  hazard?: string;
  lng?: number;
  lat?: number;
  /** ISO onset/time. */
  at?: string;
  source?: string;
}

export interface iSummaryStats {
  alertsActive: number;
  /** Counts keyed by severity rank "0".."4". */
  alertsBySeverity: Record<string, number>;
  /** Counts keyed by hazard category. */
  alertsByHazard: Record<string, number>;
  /** Counts keyed by source adapter. */
  alertsBySource: Record<string, number>;
  quakeCount: number;
  quakeMaxMag: number;
  /** Alerts classified as tropical cyclones. */
  cyclones: number;
  /** Live tracks flagged notable. */
  tracksNotable: number;
}

/** LLM call metadata (present when a narrative was attempted). */
export interface iSummaryLlm {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface iEventSummary extends iGeneralModel {
  period: SummaryPeriod;
  /** Aggregation window (ISO). */
  windowStart: string;
  windowEnd: string;
  /** When this round-up was produced. */
  generatedAt: Date;
  stats: iSummaryStats;
  hotspots: iSummaryHotspot[];
  topEvents: iSummaryTopEvent[];
  /** LLM prose; "" when skipped/errored. */
  narrative: string;
  narrativeStatus: NarrativeStatus;
  /** Collections/adapters aggregated, for provenance. */
  sources: string[];
  llm?: iSummaryLlm;
}

export interface iEventSummaryModel extends iEventSummary {
  id: string;
  _id: string;
}

const SummaryHotspotSchema = new mongoose.Schema<iSummaryHotspot>(
  {
    label: { type: String, required: true, default: "" },
    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    count: { type: Number, required: true, default: 0 },
    maxSeverity: { type: Number, required: true, min: 0, max: 4, default: 0 },
    hazards: { type: [String], default: [] },
    kinds: { type: [String], default: [] },
  },
  { _id: false },
);

const SummaryTopEventSchema = new mongoose.Schema<iSummaryTopEvent>(
  {
    kind: { type: String, required: true },
    refId: { type: String, required: true, default: "" },
    title: { type: String, required: true, default: "" },
    severity: { type: Number, required: true, min: 0, max: 4, default: 0 },
    hazard: { type: String, required: false },
    lng: { type: Number, required: false },
    lat: { type: Number, required: false },
    at: { type: String, required: false },
    source: { type: String, required: false },
  },
  { _id: false },
);

const SummaryStatsSchema = new mongoose.Schema<iSummaryStats>(
  {
    alertsActive: { type: Number, required: true, default: 0 },
    alertsBySeverity: { type: mongoose.Schema.Types.Mixed, default: {} },
    alertsByHazard: { type: mongoose.Schema.Types.Mixed, default: {} },
    alertsBySource: { type: mongoose.Schema.Types.Mixed, default: {} },
    quakeCount: { type: Number, required: true, default: 0 },
    quakeMaxMag: { type: Number, required: true, default: 0 },
    cyclones: { type: Number, required: true, default: 0 },
    tracksNotable: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const EventSummarySchema = new mongoose.Schema<iEventSummaryModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    period: { type: String, required: true, enum: ["hourly", "12h", "daily"] },
    windowStart: { type: String, required: true },
    windowEnd: { type: String, required: true },
    generatedAt: { type: Date, required: true, default: () => new Date() },
    stats: { type: SummaryStatsSchema, required: true, default: {} },
    hotspots: { type: [SummaryHotspotSchema], default: [] },
    topEvents: { type: [SummaryTopEventSchema], default: [] },
    narrative: { type: String, required: true, default: "" },
    narrativeStatus: { type: String, required: true, default: "skipped" },
    sources: { type: [String], default: [] },
    llm: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  mongoTimestamps,
);

// Latest-by-period read + history newest-first.
EventSummarySchema.index({ period: 1, generatedAt: -1 }, { name: "summary_period_gen_ix" });
// Optional retention: expire old round-ups when SUMMARY_TTL_SEC > 0.
if (TTL_SEC > 0)
  EventSummarySchema.index({ generatedAt: 1 }, { name: "summary_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getEventSummaryModel = (conn: Connection) =>
  getModel<iEventSummaryModel>(conn, "EventSummary", EventSummarySchema);
