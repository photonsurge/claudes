import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A rolling numeric series for one event metric over time — GDACS alert score /
 * modelled severity / affected population / felt-report count. One doc per
 * `(eventId, source, metric)`; samples are appended only when the value moves,
 * so it's deltas-over-time (cheap to store + graph). A TTL on `updatedAt` rolls
 * off series whose event stopped refreshing. Generic clone of alert-series.
 */
const TTL_SEC = Number(process.env.EVENT_SERIES_TTL_SEC || 30 * 24 * 60 * 60);

export interface EventSeriesSample {
  /** epoch ms */
  t: number;
  v: number;
}

export interface iEventSeries extends iGeneralModel {
  /** `${eventId}:${source}:${metric}` — the upsert key. */
  key: string;
  eventId: string;
  source: string;
  metric: string;
  unit?: string;
  samples: EventSeriesSample[];
  latest: number;
  updatedAt: Date;
}

export interface iEventSeriesModel extends iEventSeries {
  id: string;
  _id: string;
}

const SampleSchema = new mongoose.Schema<EventSeriesSample>(
  { t: { type: Number, required: true }, v: { type: Number, required: true } },
  { _id: false },
);

export const EventSeriesSchema = new mongoose.Schema<iEventSeriesModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    key: { type: String, required: true, unique: true },
    eventId: { type: String, required: true },
    source: { type: String, required: true },
    metric: { type: String, required: true },
    unit: { type: String, required: false },
    samples: { type: [SampleSchema], default: [] },
    latest: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

EventSeriesSchema.index({ key: 1 }, { unique: true, name: "event_series_key_ix" });
EventSeriesSchema.index({ eventId: 1 }, { name: "event_series_event_ix" });
EventSeriesSchema.index({ updatedAt: 1 }, { name: "event_series_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getEventSeriesModel = (conn: Connection) =>
  getModel<iEventSeriesModel>(conn, "EventSeries", EventSeriesSchema);
