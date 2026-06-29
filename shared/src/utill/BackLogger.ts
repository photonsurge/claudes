/**
 * Back logger — adapted from hydra's PublicBackLogger. Changes vs hydra:
 *  - NO queue: the entry is saved DIRECTLY to the Mongo `logs` collection.
 *  - Single-domain: dropped siteID / session / multi-tenant fields.
 * Logs to console too, and never throws (a logging failure must not break the
 * caller). Use the per-service wrappers (WorkerBackLogger etc.) so `system` is set.
 */
import type { LOG_LEVEL, SYSTEM_TYPE } from "../index";
import { getDb } from "./mongoose";
import { getLogModel } from "../db/log-model";

export interface iLogEntry {
  level: LOG_LEVEL;
  system?: SYSTEM_TYPE;
  instance: string;
  tag: string;
  message: string;
  stuff?: unknown;
  type: string;
  targetID: string;
  timestamp: string;
}

const formatLog = (e: iLogEntry): string => {
  const base = `{${e.level}} [${e.timestamp}] [${e.instance}] [${e.tag}] ${e.message}`;
  const stuff =
    e.stuff && typeof e.stuff === "object" && Object.keys(e.stuff).length
      ? `\n${JSON.stringify(e.stuff, null, 2)}`
      : "";
  return base + stuff;
};

/** event → info; everything else passes through. */
const normalizeLevel = (level: LOG_LEVEL): LOG_LEVEL => (level === "event" ? "info" : level);

export const BackLogger = async (
  instance: string,
  level: LOG_LEVEL,
  tag: string,
  message: string,
  stuff: unknown = {},
  type: string = "unknown",
  targetID: string = "unknown",
  system?: SYSTEM_TYPE,
): Promise<void> => {
  // Strip anything non-JSON-serialisable (functions, cycles, BigInt…).
  let safeStuff: unknown = stuff;
  try {
    safeStuff = stuff ? JSON.parse(JSON.stringify(stuff)) : {};
  } catch {
    safeStuff = { note: "unserialisable stuff dropped" };
  }

  const entry: iLogEntry = {
    level: normalizeLevel(level),
    system,
    instance,
    tag,
    message,
    stuff: safeStuff,
    type,
    targetID,
    timestamp: new Date().toISOString(),
  };

  console.log(formatLog(entry));

  try {
    const conn = await getDb();
    await getLogModel(conn).create({ ...entry });
  } catch (err) {
    // Last resort — never throw out of a logger.
    console.error("[BackLogger] save failed:", String(err));
  }
};

const wrap = (system: SYSTEM_TYPE) =>
  (
    instance: string,
    level: LOG_LEVEL,
    tag: string,
    message: string,
    stuff: unknown = {},
    type: string = "unknown",
    targetID: string = "unknown",
  ) => BackLogger(instance, level, tag, message, stuff, type, targetID, system);

export const WorkerBackLogger = wrap("worker");
export const PublicBackLogger = wrap("public");
export const SocketBackLogger = wrap("socket");

export default BackLogger;
