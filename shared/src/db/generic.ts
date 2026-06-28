import type { Connection } from "mongoose";
import type { Collection, Filter, OptionalUnlessRequiredId } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import { tGeneralResponse } from "../interfaces/tGeneralResponse";
import { logError } from "../utill/logger";

/**
 * Every entity has its own string `id` field (UUID). NEVER use Mongo `_id` for
 * queries, links, or identity — the only place `_id` exists is internal Mongo
 * bookkeeping. Always read/write through `id`.
 */
export interface iEntity {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

const strip = <T>(doc: any): T | undefined => {
  if (!doc) return undefined;
  const { _id, ...rest } = doc;
  return rest as T;
};

const fail = (op: string, error: unknown): tGeneralResponse<never> => {
  logError(`[db] ${op} failed`, error);
  return { success: false, errors: { _: [String(error)] } };
};

/**
 * Generic CRUD factory over a single Mongo collection. Returns the standard
 * `{ success, data?, errors? }` response shape used across the stack.
 */
export function makeCollection<T extends iEntity>(conn: Connection, name: string) {
  const col = (): Collection<T> => {
    if (!conn.db) throw new Error("Mongo connection not ready");
    return conn.db.collection<T>(name);
  };

  return {
    async getByID(id: string): Promise<tGeneralResponse<T>> {
      try {
        const doc = await col().findOne({ id } as Filter<T>);
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.getByID`, err);
      }
    },

    async getByQuery(query: Filter<T>): Promise<tGeneralResponse<T>> {
      try {
        const doc = await col().findOne(query);
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.getByQuery`, err);
      }
    },

    async getAll(query: Filter<T> = {} as Filter<T>): Promise<tGeneralResponse<T[]>> {
      try {
        const docs = await col().find(query).sort({ createdAt: -1 } as any).toArray();
        return {
          success: true,
          data: docs.map((d) => strip<T>(d)!).filter(Boolean),
          totalCount: docs.length,
        };
      } catch (err) {
        return fail(`${name}.getAll`, err);
      }
    },

    async create(input: Omit<T, "id" | "createdAt" | "updatedAt"> & Partial<iEntity>): Promise<tGeneralResponse<T>> {
      try {
        const now = new Date().toISOString();
        const doc = { id: input.id ?? uuidv4(), createdAt: now, updatedAt: now, ...input } as T;
        await col().insertOne(doc as OptionalUnlessRequiredId<T>);
        return { success: true, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.create`, err);
      }
    },

    async updateByID(id: string, patch: Partial<T>): Promise<tGeneralResponse<T>> {
      try {
        const { _id, id: _ignore, ...rest } = patch as any;
        const update = { ...rest, updatedAt: new Date().toISOString() };
        const doc = await col().findOneAndUpdate(
          { id } as Filter<T>,
          { $set: update },
          { returnDocument: "after" },
        );
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.updateByID`, err);
      }
    },

    async deleteByID(id: string): Promise<tGeneralResponse<{ id: string }>> {
      try {
        const res = await col().deleteOne({ id } as Filter<T>);
        return { success: res.deletedCount > 0, data: { id } };
      } catch (err) {
        return fail(`${name}.deleteByID`, err);
      }
    },
  };
}

export type Collection_<T extends iEntity> = ReturnType<typeof makeCollection<T>>;
