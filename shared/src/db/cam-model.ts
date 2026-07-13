import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { CamProvider, CamStatus, CamStreamKind } from "../cams/types";

/**
 * Catalogued live webcams. Like quakes (and unlike per-run track snapshots)
 * these are stable entities the worker UPSERTS on a provider `camId` — a
 * catalog re-poll refreshes media URLs/status without duplicating. No TTL:
 * cams persist until explicitly removed (manual entries especially). A
 * 2dsphere index on `loc` powers "cams in this area" bbox/near reads.
 */
export interface iCam extends iGeneralModel {
  /** Provider id (the upsert key). */
  camId: string;
  provider: CamProvider;
  title: string;
  lat: number;
  lng: number;
  status: CamStatus;
  place?: string;
  country?: string;
  imageUrl?: string;
  timelapseUrl?: string;
  playerUrl?: string;
  live?: { kind: CamStreamKind; url: string };
  tags?: string[];
  attribution?: { provider: string; requiredText?: string; linkUrl?: string };
  /** When the worker last refreshed this cam from its provider. */
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iCamModel extends iCam {
  id: string;
  _id: string;
}

const LiveSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["hls", "youtube", "mp4", "iframe"], required: true },
    url: { type: String, required: true },
  },
  { _id: false },
);

const AttributionSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    requiredText: { type: String, required: false },
    linkUrl: { type: String, required: false },
  },
  { _id: false },
);

const CamSchema = new mongoose.Schema<iCamModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    camId: { type: String, required: true, unique: true },
    provider: {
      type: String,
      enum: ["windy", "tfl", "national_highways", "youtube", "geonet", "manual", "other"],
      required: true,
      default: "manual",
    },
    title: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    status: {
      type: String,
      enum: ["active", "inactive", "unknown"],
      required: true,
      default: "unknown",
    },
    place: { type: String, required: false },
    country: { type: String, required: false },
    imageUrl: { type: String, required: false },
    timelapseUrl: { type: String, required: false },
    playerUrl: { type: String, required: false },
    live: { type: LiveSchema, required: false },
    tags: { type: [String], required: false },
    attribution: { type: AttributionSchema, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

CamSchema.index({ camId: 1 }, { unique: true, name: "cam_id_ix" });
// Admin list reads newest-first, filterable by status.
CamSchema.index({ status: 1, fetchedAt: -1 }, { name: "cam_status_ix" });
CamSchema.index({ loc: "2dsphere" }, { name: "cam_geo_ix", sparse: true });
// "Cameras for this volcano" — tags carry the volcano's gvp:<vnum> id(s).
CamSchema.index({ tags: 1 }, { name: "cam_tags_ix", sparse: true });

export const getCamModel = (conn: Connection) =>
  getModel<iCamModel>(conn, "Cam", CamSchema);
