/**
 * Base fields shared by every Mongoose-backed entity.
 *
 * Single-domain: we deliberately drop hydra's tenant/context, `siteID`, and
 * audit/session fields. Identity is always the string `id` (UUID), never Mongo
 * `_id`. `created`/`updated` are managed by Mongoose timestamps mapped to these
 * names (see `mongoTimestamps`).
 */
export interface iGeneralModel {
  id?: string;
  created?: Date;
  updated?: Date;
}

/** Pass to a Schema's options to map Mongoose timestamps onto created/updated. */
export const mongoTimestamps = {
  timestamps: { createdAt: "created", updatedAt: "updated" },
} as const;
