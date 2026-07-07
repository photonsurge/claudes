import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached Smithsonian/USGS Weekly Volcanic Activity Report entries. Unlike
 * earthquakes/fires (discrete point-in-time detections), a volcano persists
 * across many polls while it keeps reporting, so the worker UPSERTS on the
 * stable Smithsonian VOTW `volcanoId` and bumps `fetchedAt` every time it's
 * still in the current bulletin. The TTL is on `fetchedAt`, not the report's
 * own dates — the source bulletin only republishes weekly, so the window is
 * ~2 cycles (14 days) rather than a few days, or a volcano would wrongly age
 * out between one week's poll and the next.
 */
const TTL_SEC = Number(process.env.VOLCANO_TTL_SEC || 14 * 24 * 60 * 60);

export interface iVolcano extends iGeneralModel {
  /** Stable Smithsonian VOTW volcano number, e.g. "gvp:211060" (the upsert key). */
  volcanoId: string;
  name: string;
  country?: string;
  lat: number;
  lng: number;
  status: string;
  firstDate: Date;
  lastDate: Date;
  /** When `status` last actually changed (not just re-reported) — see Volcano.statusChangedAt. */
  statusChangedAt: Date;
  sourceUrl?: string;
  latestReport?: string;
  reportDateRange?: string;
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
  /** Wikipedia enrichment (see worker/src/jobs/volcanoes.ts#enrichWiki). */
  wikiTitle?: string;
  wikiThumb?: string;
  wikiExtract?: string;
  wikiFetchedAt?: Date;
}

export interface iVolcanoModel extends iVolcano {
  id: string;
  _id: string;
}

const VolcanoSchema = new mongoose.Schema<iVolcanoModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    volcanoId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    country: { type: String, required: false },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    status: { type: String, required: true },
    firstDate: { type: Date, required: true },
    lastDate: { type: Date, required: true },
    statusChangedAt: { type: Date, required: true, default: () => new Date() },
    sourceUrl: { type: String, required: false },
    latestReport: { type: String, required: false },
    reportDateRange: { type: String, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
    wikiTitle: { type: String, required: false },
    wikiThumb: { type: String, required: false },
    wikiExtract: { type: String, required: false },
    wikiFetchedAt: { type: Date, required: false },
  },
  { timestamps: false },
);

VolcanoSchema.index({ volcanoId: 1 }, { unique: true, name: "volcano_id_ix" });
VolcanoSchema.index({ lastDate: -1 }, { name: "volcano_last_date_ix" });
VolcanoSchema.index({ loc: "2dsphere" }, { name: "volcano_geo_ix", sparse: true });
// Auto-expire volcanoes that have stopped showing up in the weekly bulletin.
VolcanoSchema.index({ fetchedAt: 1 }, { name: "volcano_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getVolcanoModel = (conn: Connection) =>
  getModel<iVolcanoModel>(conn, "Volcano", VolcanoSchema);
