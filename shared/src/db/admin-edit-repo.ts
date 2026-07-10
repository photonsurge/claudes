import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AdminEntityType, AdminEdit, AdminTextOverrides } from "../admin-content/types";
import { pruneOverrides } from "../admin-content/types";
import type { iAdminEditModel } from "./admin-edit-model";

/** Map a stored doc to the wire `AdminEdit`. */
function toAdminEdit(doc: iAdminEditModel): AdminEdit {
  return {
    entityType: doc.entityType,
    entityId: doc.entityId,
    text: (doc.text ?? {}) as AdminTextOverrides,
    updatedAt: doc.updated ? new Date(doc.updated).getTime() : undefined,
  };
}

/**
 * Manual text-override persistence — one doc per `(entityType, entityId)`,
 * upserted. `setText` REPLACES the whole override map (the editor always submits
 * every editable field), pruning empties so a cleared field falls back to the
 * base entity value.
 */
export function makeAdminEditRepo(model: Model<iAdminEditModel>) {
  return {
    model,

    /** The overrides for one entity, or null if none saved. */
    async get(entityType: AdminEntityType, entityId: string): Promise<AdminEdit | null> {
      const doc = await model.findOne({ entityType, entityId }).lean().exec();
      return doc ? toAdminEdit(doc as iAdminEditModel) : null;
    },

    /** Just the text map for one entity (empty object if none). */
    async textFor(entityType: AdminEntityType, entityId: string): Promise<AdminTextOverrides> {
      const doc = await this.get(entityType, entityId);
      return doc?.text ?? {};
    },

    /** Batch: text overrides for many entities of one type, keyed by entityId. */
    async textForEntities(
      entityType: AdminEntityType,
      entityIds: string[],
    ): Promise<Map<string, AdminTextOverrides>> {
      const out = new Map<string, AdminTextOverrides>();
      if (!entityIds.length) return out;
      const docs = await model
        .find({ entityType, entityId: { $in: entityIds } })
        .lean()
        .exec();
      for (const d of docs) {
        out.set((d as iAdminEditModel).entityId, ((d as iAdminEditModel).text ?? {}) as AdminTextOverrides);
      }
      return out;
    },

    /**
     * Replace an entity's text overrides (upsert). Empties are pruned; if the
     * result is empty the doc is removed so "no overrides" is the clean state.
     */
    async setText(
      entityType: AdminEntityType,
      entityId: string,
      text: AdminTextOverrides,
    ): Promise<AdminEdit | null> {
      const pruned = pruneOverrides(text);
      if (Object.keys(pruned).length === 0) {
        await model.deleteOne({ entityType, entityId }).exec();
        return null;
      }
      const doc = await model
        .findOneAndUpdate(
          { entityType, entityId },
          { $set: { text: pruned }, $setOnInsert: { id: uuidv4(), entityType, entityId } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .lean()
        .exec();
      return doc ? toAdminEdit(doc as iAdminEditModel) : null;
    },

    /** Drop an entity's overrides entirely. */
    async clear(entityType: AdminEntityType, entityId: string): Promise<boolean> {
      const res = await model.deleteOne({ entityType, entityId }).exec();
      return (res.deletedCount ?? 0) > 0;
    },
  };
}

export type AdminEditRepo = ReturnType<typeof makeAdminEditRepo>;
