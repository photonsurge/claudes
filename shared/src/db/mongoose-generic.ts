import type { Model, FilterQuery } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { tGeneralResponse } from "../interfaces/tGeneralResponse";
import { logError } from "../utill/logger";

/**
 * Generic CRUD over a strongly-typed Mongoose model, returning the standard
 * `{ success, data?, errors? }` envelope used across the stack. Mirrors the
 * native-driver `makeCollection` contract so call sites read the same, but is
 * backed by a real schema (validation, defaults, indexes).
 *
 * Everything is keyed by the string `id` (UUID), never Mongo `_id`. Reads use
 * `.lean()` and strip `_id`/`__v` so callers only ever see plain typed data.
 */

export interface iGetAllOptions<T> {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

const strip = <T>(doc: any): T | undefined => {
  if (!doc) return undefined;
  const { _id, __v, ...rest } = doc;
  return rest as T;
};

const fail = (op: string, error: unknown): tGeneralResponse<never> => {
  logError(`[db] ${op} failed`, error);
  return { success: false, errors: { _: [String(error)] } };
};

export function mongoCrud<T extends { id?: string }>(model: Model<T>) {
  const name = model.modelName;

  return {
    model,

    async getByID(id: string): Promise<tGeneralResponse<T>> {
      try {
        const doc = await model.findOne({ id } as FilterQuery<T>).lean().exec();
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.getByID`, err);
      }
    },

    async getByQuery(query: FilterQuery<T>): Promise<tGeneralResponse<T>> {
      try {
        const doc = await model.findOne(query).lean().exec();
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.getByQuery`, err);
      }
    },

    async getAll(
      query: FilterQuery<T> = {} as FilterQuery<T>,
      opts: iGetAllOptions<T> = {},
    ): Promise<tGeneralResponse<T[]>> {
      try {
        let q = model.find(query).sort((opts.sort ?? { created: -1 }) as any);
        if (typeof opts.skip === "number") q = q.skip(opts.skip);
        if (typeof opts.limit === "number") q = q.limit(opts.limit);
        const docs = await q.lean().exec();
        return {
          success: true,
          data: docs.map((d) => strip<T>(d)!).filter(Boolean),
          totalCount: docs.length,
        };
      } catch (err) {
        return fail(`${name}.getAll`, err);
      }
    },

    async create(input: Partial<T>): Promise<tGeneralResponse<T>> {
      try {
        const doc = { id: input.id ?? uuidv4(), ...input } as T;
        const created = await model.create(doc as any);
        return { success: true, data: strip<T>(created.toObject()) };
      } catch (err) {
        return fail(`${name}.create`, err);
      }
    },

    async updateByID(id: string, patch: Partial<T>): Promise<tGeneralResponse<T>> {
      try {
        const { _id, id: _ignore, ...rest } = patch as any;
        const doc = await model
          .findOneAndUpdate({ id } as FilterQuery<T>, { $set: rest }, { new: true })
          .lean()
          .exec();
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.updateByID`, err);
      }
    },

    /** Insert-or-update by id (used for singleton docs like broadcast state). */
    async upsertByID(id: string, patch: Partial<T>): Promise<tGeneralResponse<T>> {
      try {
        const { _id, id: _ignore, ...rest } = patch as any;
        const doc = await model
          .findOneAndUpdate(
            { id } as FilterQuery<T>,
            { $set: rest, $setOnInsert: { id } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
          )
          .lean()
          .exec();
        return { success: !!doc, data: strip<T>(doc) };
      } catch (err) {
        return fail(`${name}.upsertByID`, err);
      }
    },

    async deleteByID(id: string): Promise<tGeneralResponse<{ id: string }>> {
      try {
        const res = await model.deleteOne({ id } as FilterQuery<T>).exec();
        return { success: (res.deletedCount ?? 0) > 0, data: { id } };
      } catch (err) {
        return fail(`${name}.deleteByID`, err);
      }
    },

    async deleteMany(query: FilterQuery<T>): Promise<tGeneralResponse<{ count: number }>> {
      try {
        const res = await model.deleteMany(query).exec();
        return { success: true, data: { count: res.deletedCount ?? 0 } };
      } catch (err) {
        return fail(`${name}.deleteMany`, err);
      }
    },
  };
}

export type MongoCrud_<T extends { id?: string }> = ReturnType<typeof mongoCrud<T>>;
