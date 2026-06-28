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
}

export interface iAlert extends iGeneralModel {
  // identity
  source: string;
  identifier: string;
  sender: string;
  sent: string;

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
}

export interface iAlertModel extends iAlert {
  id: string;
  _id: string;
}

const AlertAreaSchema = new mongoose.Schema<iAlertArea>(
  {
    areaDesc: { type: String, required: true, default: "" },
    geometry: { type: mongoose.Schema.Types.Mixed, required: false, default: null },
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
  },
  { _id: false },
);

const AlertSchema = new mongoose.Schema<iAlertModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    source: { type: String, required: true, trim: true, maxlength: 64 },
    identifier: { type: String, required: true, trim: true, maxlength: 512 },
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
  },
  mongoTimestamps,
);

// Dedup key — the heart of upsert/supersede (spec §5).
AlertSchema.index({ source: 1, identifier: 1 }, { unique: true, name: "alert_dedup_ix" });
// "active now" queries and the expiry sweep.
AlertSchema.index({ active: 1, maxSeverityRank: -1 }, { name: "alert_active_sev_ix" });
AlertSchema.index({ expiresAt: 1 }, { name: "alert_expires_ix" });
AlertSchema.index({ source: 1, active: 1 }, { name: "alert_source_active_ix" });
// Point/region lookups ($geoIntersects). Sparse: geocode-only feeds have no geometry.
AlertSchema.index({ "info.area.geometry": "2dsphere" }, { name: "alert_geo_ix", sparse: true });

export const getAlertModel = (conn: Connection) => getModel<iAlertModel>(conn, "Alert", AlertSchema);
