import mongoose, { Connection } from "mongoose";
import { logError, logWarn } from "./logger";

const MONGODB_URI = process.env.MONGODB_URI as string;

// While Mongo is unreachable a failed attempt clears connPromise (so we retry),
// but a burst of concurrent callers would then each spin up its own
// serverSelectionTimeoutMS attempt and surface an identical timeout error. Hold
// the last failure for this window so callers arriving inside it fail fast on
// the shared error instead of stampeding the (still-down) server.
const FAIL_COOLDOWN_MS = Number(process.env.MONGO_FAIL_COOLDOWN_MS || 1000);

interface MongooseCache {
  conn: Connection | null;
  connPromise: Promise<Connection> | null;
  lastError: Error | null;
  lastFailAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache =
  global.__mongooseCache ??
  (global.__mongooseCache = {
    conn: null,
    connPromise: null,
    lastError: null,
    lastFailAt: 0,
  });

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

/**
 * Close the shared connection and clear the cache so a subsequent getDb()
 * reconnects. Used by long-running services (the worker) to release the pool
 * tidily on shutdown instead of relying on process.exit to reap the sockets.
 * No-op if nothing is connected.
 */
export async function closeDb(): Promise<void> {
  const conn = cached.conn;
  cached.conn = null;
  cached.connPromise = null;
  if (conn) await conn.close();
}
