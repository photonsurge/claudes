import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { DirectorConfig } from "../director";

/** Single-domain → one director-config document. */
export const DIRECTOR_CONFIG_ID = "default" as const;

export interface iDirectorConfig extends iGeneralModel, DirectorConfig {}

export interface iDirectorConfigModel extends iDirectorConfig {
  id: string;
  _id: string;
}

const DirectorConfigSchema = new mongoose.Schema<iDirectorConfigModel>(
  {
    id: { type: String, required: true, unique: true, default: DIRECTOR_CONFIG_ID },
    mode: { type: String, required: true, enum: ["off", "auto"], default: "off" },
    // Per-kind hold (seconds). Quake/storm entries are the fallback only — the
    // per-level maps below drive those kinds. Defaults mirror DEFAULT_*_HOLD_SECONDS.
    kindHoldSeconds: {
      intro: { type: Number, default: 17 },
      global: { type: Number, default: 17 },
      ocean: { type: Number, default: 17 },
      orbital: { type: Number, default: 17 },
      tour: { type: Number, default: 12 },
      country: { type: Number, default: 12 },
      weather: { type: Number, default: 12 },
      storm: { type: Number, default: 12 },
      volcano: { type: Number, default: 12 },
      quake: { type: Number, default: 12 },
      flight: { type: Number, default: 12 },
      ship: { type: Number, default: 12 },
      ad: { type: Number, default: 12 },
      summary: { type: Number, default: 20 },
    },
    // Per-magnitude-class hold for quake segments (seconds).
    quakeHoldSeconds: {
      micro: { type: Number, default: 8 },
      minor: { type: Number, default: 8 },
      light: { type: Number, default: 10 },
      moderate: { type: Number, default: 12 },
      strong: { type: Number, default: 16 },
      major: { type: Number, default: 22 },
      great: { type: Number, default: 30 },
    },
    // Per-severity-level hold for storm segments (seconds).
    stormHoldSeconds: {
      info: { type: Number, default: 10 },
      minor: { type: Number, default: 10 },
      moderate: { type: Number, default: 12 },
      severe: { type: Number, default: 16 },
      extreme: { type: Number, default: 24 },
    },
    // Per-status-level hold for volcano segments (seconds).
    volcanoHoldSeconds: {
      unrest: { type: Number, default: 14 },
      erupting: { type: Number, default: 22 },
    },
    transitionSeconds: { type: Number, required: true, default: 4 },
    kinds: {
      intro: { type: Boolean, default: true },
      global: { type: Boolean, default: true },
      ocean: { type: Boolean, default: true },
      orbital: { type: Boolean, default: true },
      tour: { type: Boolean, default: true },
      country: { type: Boolean, default: true },
      weather: { type: Boolean, default: true },
      storm: { type: Boolean, default: true },
      volcano: { type: Boolean, default: true },
      quake: { type: Boolean, default: true },
      flight: { type: Boolean, default: true },
      ship: { type: Boolean, default: true },
      ad: { type: Boolean, default: false },
      summary: { type: Boolean, default: true },
    },
    countries: { type: [String], default: ["uk", "japan"] },
    minQuakeMag: { type: Number, required: true, default: 4.5 },
    minAlertSeverity: { type: Number, required: true, default: 3 },
    adEveryNShots: { type: Number, required: true, default: 6 },
    skipNonce: { type: Number, required: true, default: 0 },
    // Dynamic per-kind keys (SegmentKind → string[] / bool map) — Mixed, same
    // precedent as satImgFeeds in broadcast-state-model.ts.
    mapTypes: { type: mongoose.Schema.Types.Mixed, default: {} },
    overlayOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
    kindLooks: { type: mongoose.Schema.Types.Mixed, default: {} },
    kindSlides: { type: mongoose.Schema.Types.Mixed, default: {} },
    activeSlideId: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  mongoTimestamps,
);

export const getDirectorConfigModel = (conn: Connection) =>
  getModel<iDirectorConfigModel>(conn, "DirectorConfig", DirectorConfigSchema);
