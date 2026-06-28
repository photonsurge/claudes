import type { Connection } from "mongoose";
import { getDb } from "../utill/mongoose";
import { iEntity, makeCollection } from "./generic";

/** Sample entity for the ping demo feature. Replace/extend with real models. */
export interface iPing extends iEntity {
  message: string;
  source: string;
  processedAt?: string;
}

/**
 * Wire all collections here. Each collection follows the standard CRUD contract
 * from `makeCollection` and is keyed by string `id` (never `_id`).
 */
export function createDb(conn: Connection) {
  return {
    conn,
    pings: makeCollection<iPing>(conn, "pings"),
  };
}

export type AppDb = ReturnType<typeof createDb>;

/** Convenience: open (or reuse) the single connection and build the DB facade. */
export async function getAppDb(): Promise<AppDb> {
  const conn = await getDb();
  return createDb(conn);
}
