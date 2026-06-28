import mongoose, { Connection } from "mongoose";
import { logError, logWarn } from "./logger";

const MONGODB_URI = process.env.MONGODB_URI as string;

interface MongooseCache {
  conn: Connection | null;
  connPromise: Promise<Connection> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache =
  global.__mongooseCache ??
  (global.__mongooseCache = { conn: null, connPromise: null });

/**
 * Single-domain DB connection. There is exactly one database, so there is no
 * master/tenant split — callers just get the one shared connection.
 */
export async function getDb(): Promise<Connection> {
  if (cached.conn) return cached.conn;

  if (!cached.connPromise) {
    if (!MONGODB_URI) {
      throw new Error("Please define the MONGODB_URI environment variable in .env");
    }
    cached.connPromise = mongoose
      .createConnection(MONGODB_URI, {
        bufferCommands: false,
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
      })
      .asPromise()
      .then((conn) => {
        conn.on("error", (err) => logError("[mongo] connection error", err));
        conn.on("disconnected", () => {
          logWarn("[mongo] connection disconnected — clearing cache");
          cached.conn = null;
          cached.connPromise = null;
        });
        return conn;
      })
      .catch((err) => {
        logWarn("[mongo] connection attempt failed — clearing cache");
        cached.conn = null;
        cached.connPromise = null;
        throw err;
      });
  }

  cached.conn = await cached.connPromise;
  return cached.conn;
}
