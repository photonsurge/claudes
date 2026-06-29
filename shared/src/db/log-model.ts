import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Backend log entries — the persistent "back log" the admin views. Adapted from
 * hydra's PublicBackLogger, but single-domain (no siteID/session) and saved
 * DIRECTLY here, not pushed through the queue. A TTL index expires old lines.
 */
const TTL_SEC = Number(process.env.LOG_TTL_SEC || 7 * 24 * 60 * 60);

export interface iLog extends iGeneralModel {
  level: string; // log | event | info | warn | error
  /** Which service emitted it: worker | public | socket | shared. */
  system?: string;
  /** Free instance label (process/host). */
  instance: string;
  tag: string;
  message: string;
  /** Domain/type, e.g. "alerts", "tracks". */
  type: string;
  targetID: string;
  /** Structured extras (JSON-safe). */
  stuff?: unknown;
  timestamp: string;
}

export interface iLogModel extends iLog {
  id: string;
  _id: string;
}

const LogSchema = new mongoose.Schema<iLogModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    level: { type: String, required: true, default: "info" },
    system: { type: String, required: false },
    instance: { type: String, required: true, default: "unknown" },
    tag: { type: String, required: true, default: "" },
    message: { type: String, required: true, default: "" },
    type: { type: String, required: true, default: "unknown" },
    targetID: { type: String, required: true, default: "unknown" },
    stuff: { type: mongoose.Schema.Types.Mixed, required: false },
    timestamp: { type: String, required: true, default: () => new Date().toISOString() },
  },
  mongoTimestamps,
);

LogSchema.index({ created: -1 }, { name: "log_created_ix" });
LogSchema.index({ level: 1, created: -1 }, { name: "log_level_ix" });
LogSchema.index({ type: 1, created: -1 }, { name: "log_type_ix" });
// Auto-expire old log lines.
LogSchema.index({ created: 1 }, { name: "log_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getLogModel = (conn: Connection) => getModel<iLogModel>(conn, "Log", LogSchema);
