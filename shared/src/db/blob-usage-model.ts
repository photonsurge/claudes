import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { BlobUsage } from "./blob-fs";

/**
 * The last measurement of the shared blob folder.
 *
 * Measuring means a `stat` per blob across the whole tree, and the tree is now
 * hundreds of thousands of files. Doing that inline in a `/api/admin/files`
 * request took longer than the reverse proxy's read timeout, so the page that
 * exists to diagnose disk usage was the one thing disk usage broke — it got
 * nginx's HTML error page back and failed to parse it as JSON.
 *
 * So the walk moved to the worker, where heavy work belongs, and its result
 * lands here. Public reads one small document and renders it instantly. A
 * singleton: there is only ever one current answer.
 */
export const BLOB_USAGE_ID = "current";

export interface iBlobUsage extends iGeneralModel {
  id: string;
  /** The measured tree, exactly as `BlobFs.usage()` returned it. */
  usage: BlobUsage;
  measuredAt: Date;
  /** How long the walk took, so an operator can see it getting worse. */
  tookMs: number;
}

export interface iBlobUsageModel extends iBlobUsage {
  id: string;
  _id: string;
}

const BlobUsageSchema = new mongoose.Schema<iBlobUsageModel>(
  {
    id: { type: String, required: true, unique: true, default: BLOB_USAGE_ID },
    // Mixed: this is a cache of whatever `usage()` reports, and the namespace
    // list is discovered from the disk rather than declared. Mirroring its shape
    // here would just be a second place to forget to update.
    usage: { type: mongoose.Schema.Types.Mixed, required: true },
    measuredAt: { type: Date, required: true, default: () => new Date() },
    tookMs: { type: Number, required: true, default: 0 },
  },
  mongoTimestamps,
);

BlobUsageSchema.index({ id: 1 }, { unique: true, name: "blob_usage_id_ix" });

export const getBlobUsageModel = (conn: Connection) =>
  getModel<iBlobUsageModel>(conn, "BlobUsage", BlobUsageSchema);
