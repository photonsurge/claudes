import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iUserModel } from "./user-model";

const strip = (doc: any): Omit<iUserModel, "passwordHash"> => {
  const { __v, _id, passwordHash, ...rest } = doc;
  return rest;
};

/**
 * Admin account persistence. `list()` and `findById()` never return
 * `passwordHash` — callers that need to verify a password use
 * `findByEmail()`, which is only ever called from the login route.
 */
export function makeUserRepo(model: Model<iUserModel>) {
  return {
    model,

    async create(input: { email: string; passwordHash: string; role?: string }): Promise<iUserModel> {
      const doc = await model.create({
        id: uuidv4(),
        email: input.email.toLowerCase().trim(),
        passwordHash: input.passwordHash,
        role: input.role ?? "admin",
        active: true,
      });
      return doc.toObject() as iUserModel;
    },

    /** Includes `passwordHash` — for login verification only. */
    async findByEmail(email: string): Promise<iUserModel | null> {
      return model.findOne({ email: email.toLowerCase().trim() }).lean().exec();
    },

    async findById(id: string): Promise<Omit<iUserModel, "passwordHash"> | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? strip(doc) : null;
    },

    async list(): Promise<Array<Omit<iUserModel, "passwordHash">>> {
      const docs = await model.find({}).sort({ created: 1 }).lean().exec();
      return docs.map(strip);
    },

    async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
      await model.updateOne({ id }, { $set: { passwordHash } }).exec();
    },

    async setActive(id: string, active: boolean): Promise<void> {
      await model.updateOne({ id }, { $set: { active } }).exec();
    },

    async touchLogin(id: string): Promise<void> {
      await model.updateOne({ id }, { $set: { lastLoginAt: new Date() } }).exec();
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type UserRepo = ReturnType<typeof makeUserRepo>;
