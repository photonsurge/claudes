import type { Model } from "mongoose";
import { defaultShortFormat, sanitizeShortFormat, type ShortFormat } from "../short-format";
import type { iShortFormatModel } from "./short-format-model";

/**
 * Canonical wire shape from a lean doc: run through the sanitiser onto the
 * defaults, so `_id`/`__v`/timestamps drop and a doc written before a setting
 * existed reads back with that setting's default.
 */
function toShortFormat(doc: iShortFormatModel): ShortFormat {
  return sanitizeShortFormat(doc, defaultShortFormat(doc.id, doc.name)) ?? defaultShortFormat(doc.id, doc.name);
}

/** Fields an upsert writes — everything but the id. */
const setDoc = ({ id: _id, ...rest }: ShortFormat) => rest;

/**
 * Short-format persistence (`db.shortFormats`) — the short settings only. The
 * format's scene (look, director config) is an ordinary scene doc with the same
 * id; shared/src/db/short-format-copy.ts creates and re-copies it. Callers pass
 * already-sanitised formats (see `sanitizeShortFormat`).
 */
export function makeShortFormatRepo(model: Model<iShortFormatModel>) {
  return {
    model,

    /** All formats, by name. */
    async list(): Promise<ShortFormat[]> {
      const docs = await model.find({}).sort({ name: 1 }).lean().exec();
      return docs.map((d) => toShortFormat(d as iShortFormatModel));
    },

    /** One format by id, or null. */
    async get(id: string): Promise<ShortFormat | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? toShortFormat(doc as iShortFormatModel) : null;
    },

    /** Create or replace a format by id; returns the stored wire shape. */
    async upsert(format: ShortFormat): Promise<ShortFormat> {
      await model
        .updateOne({ id: format.id }, { $set: setDoc(format), $setOnInsert: { id: format.id } }, { upsert: true })
        .exec();
      const doc = await model.findOne({ id: format.id }).lean().exec();
      return doc ? toShortFormat(doc as iShortFormatModel) : format;
    },

    /** Delete a format's settings by id (not its scene). Returns true if one was removed. */
    async remove(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      return (res.deletedCount ?? 0) > 0;
    },
  };
}

export type ShortFormatRepo = ReturnType<typeof makeShortFormatRepo>;
