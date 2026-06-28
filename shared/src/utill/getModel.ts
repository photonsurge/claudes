import { Connection, Model, Schema } from "mongoose";

/**
 * Resolve (or register) a Mongoose model on a specific connection.
 *
 * In dev we overwrite the cached model so schema edits take effect on hot
 * reload; in production we reuse the already-registered model. Single-domain:
 * there is exactly one connection, so callers never pass a tenant/context.
 */
export function getModel<T>(
  conn: Connection,
  name: string,
  schema: Schema<T>,
  options?: { overwriteInDev?: boolean },
): Model<T> {
  const overwriteInDev = options?.overwriteInDev ?? process.env.NODE_ENV !== "production";

  if (overwriteInDev && conn.models[name]) {
    conn.deleteModel(name);
  }

  return (conn.models[name] as Model<T>) || conn.model<T>(name, schema);
}
