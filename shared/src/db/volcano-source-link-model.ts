import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Crosswalk from our canonical volcano (`gvp:<vnum>`) to an external monitoring
 * source's own id — so we NEVER re-fuzzy-match the same volcano every poll. A
 * GeoNet volcano is `taupo`, an observatory may key differently; once resolved
 * (by GVP number, coordinate proximity, or a manual pin) the link is stored and
 * subsequent polls resolve by it. This is the spec's Stage-1 source registry,
 * and the shared join the later camera / scientific-plot sources reuse.
 */

/** How the external id was matched to our volcano. */
export type VolcanoLinkMatchMethod = "gvp_id" | "coordinate" | "name" | "manual";

export interface iVolcanoSourceLink extends iGeneralModel {
  /** Our canonical `gvp:<vnum>` id. */
  volcanoId: string;
  /** Source id, e.g. "geonet" / "usgs-vhp" / "ingv". */
  source: string;
  /** The source's own volcano id (GeoNet `taupo`, USGS code…). */
  externalId: string;
  /** A secondary source code where the source carries one. */
  externalCode?: string;
  externalUrl?: string;
  matchMethod: VolcanoLinkMatchMethod;
  /** 0–1 confidence (1 for exact/manual; distance-scaled for coordinate). */
  matchScore?: number;
  enabled: boolean;
  linkedAt: string;
}

export interface iVolcanoSourceLinkModel extends iVolcanoSourceLink {
  id: string;
  _id: string;
}

export const VolcanoSourceLinkSchema = new mongoose.Schema<iVolcanoSourceLinkModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    volcanoId: { type: String, required: true },
    source: { type: String, required: true },
    externalId: { type: String, required: true },
    externalCode: { type: String, required: false },
    externalUrl: { type: String, required: false },
    matchMethod: { type: String, required: true, default: "manual" },
    matchScore: { type: Number, required: false },
    enabled: { type: Boolean, required: true, default: true },
    linkedAt: { type: String, required: true, default: () => new Date().toISOString() },
  },
  mongoTimestamps,
);

// One link per external id (a source id maps to exactly one volcano), + reverse lookup.
VolcanoSourceLinkSchema.index({ source: 1, externalId: 1 }, { unique: true, name: "volcano_link_external_ix" });
VolcanoSourceLinkSchema.index({ volcanoId: 1, source: 1 }, { name: "volcano_link_volcano_ix" });

export const getVolcanoSourceLinkModel = (conn: Connection) =>
  getModel<iVolcanoSourceLinkModel>(conn, "VolcanoSourceLink", VolcanoSourceLinkSchema);
