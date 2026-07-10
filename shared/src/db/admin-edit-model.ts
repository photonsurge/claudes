import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AdminEntityType, AdminTextOverrides } from "../admin-content/types";

/**
 * One entity's manual TEXT overrides. Stored in its own collection (not on the
 * entity doc) so edits survive feed refreshes — keyed by `(entityType, entityId)`
 * where `entityId` is the entity's stable id. `text` is a field-keyed map: keys
 * are the `field` ids from the entity's edit schema; a non-empty value replaces
 * the base field at read time. One doc per entity (upserted).
 */
export interface iAdminEdit extends iGeneralModel {
  entityType: AdminEntityType;
  entityId: string;
  text: AdminTextOverrides;
}

export interface iAdminEditModel extends iAdminEdit {
  id: string;
  _id: string;
}

const AdminEditSchema = new mongoose.Schema<iAdminEditModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    // Free-form field→value map (keys vary per entity edit schema).
    text: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
  },
  mongoTimestamps,
);

// One overrides doc per entity — the upsert key.
AdminEditSchema.index(
  { entityType: 1, entityId: 1 },
  { unique: true, name: "admin_edit_entity_ix" },
);

export const getAdminEditModel = (conn: Connection) =>
  getModel<iAdminEditModel>(conn, "AdminEdit", AdminEditSchema);
