import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A rolling numeric series for one alert metric over time — GDACS alert score /
 * modelled severity / affected population, promoted from the feed's `raw` each
 * poll (no extra HTTP). One doc per `(source, identifier, metric)`; samples are
 * appended only when the value actually moves (see repo), giving a cheap
 * deltas-over-time graph. A TTL on `updatedAt` rolls off series whose alert
 * stopped refreshing. Mirrors tide-series-model.ts.
 */
const TTL_SEC = Number(process.env.ALERT_SERIES_TTL_SEC || 7 * 24 * 60 * 60);

export interface AlertSeriesSample {
  /** epoch ms */
  t: number;
  v: number;
}

export interface iAlertSeries extends iGeneralModel {
  /** `${source}:${identifier}:${metric}` — the upsert key. */
  key: string;
  source: string;
  identifier: string;
  alertId?: string;
  /** The unified WatchedEvent this alert was promoted to (back-filled by the bridge). */
  eventId?: string;
  /** e.g. "alertscore" | "severity" | "population". */
  metric: string;
  samples: AlertSeriesSample[];
  latest: number;
  updatedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iAlertSeriesModel extends iAlertSeries {
  id: string;
  _id: string;
}

const SampleSchema = new mongoose.Schema<AlertSeriesSample>(
  { t: { type: Number, required: true }, v: { type: Number, required: true } },
  { _id: false },
);

export const AlertSeriesSchema = new mongoose.Schema<iAlertSeriesModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    identifier: { type: String, required: true },
    alertId: { type: String, required: false },
    eventId: { type: String, required: false },
    metric: { type: String, required: true },
    samples: { type: [SampleSchema], default: [] },
    latest: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

AlertSeriesSchema.index({ key: 1 }, { unique: true, name: "alert_series_key_ix" });
AlertSeriesSchema.index({ source: 1, identifier: 1 }, { name: "alert_series_alert_ix" });
AlertSeriesSchema.index({ eventId: 1 }, { name: "alert_series_event_ix", sparse: true });
AlertSeriesSchema.index({ loc: "2dsphere" }, { name: "alert_series_geo_ix", sparse: true });
AlertSeriesSchema.index({ updatedAt: 1 }, { name: "alert_series_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getAlertSeriesModel = (conn: Connection) =>
  getModel<iAlertSeriesModel>(conn, "AlertSeries", AlertSeriesSchema);
