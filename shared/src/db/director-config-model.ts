import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { DirectorConfig } from "../director";
import {
  DEFAULT_DIRECTOR_POOLS,
  DEFAULT_DIRECTOR_ROTATION,
  DEFAULT_DIRECTOR_TEMPO,
  DEFAULT_DIRECTOR_TOURS,
} from "../director-tuning";
import { DEFAULT_BREAK_IN } from "../director-break-in";

/** Typed `{ type: Number, default }` paths for a flat numeric bucket. */
const numberPaths = <T extends object>(defaults: T) =>
  Object.fromEntries(
    Object.entries(defaults).map(([k, v]) => [k, { type: Number, default: v as number }]),
  );

/**
 * One director-config document PER SCENE, keyed by the scene id (see
 * getOrInitDirectorConfig in db/index.ts). This constant is only the main
 * scene's id (= MAIN_SCENE_ID) and the schema fallback default.
 */
export const DIRECTOR_CONFIG_ID = "default" as const;

export interface iDirectorConfig extends iGeneralModel, DirectorConfig {}

export interface iDirectorConfigModel extends iDirectorConfig {
  id: string;
  _id: string;
}

export const DirectorConfigSchema = new mongoose.Schema<iDirectorConfigModel>(
  {
    id: { type: String, required: true, unique: true, default: DIRECTOR_CONFIG_ID },
    mode: { type: String, required: true, enum: ["off", "auto", "script"], default: "off" },
    // Per-kind hold (seconds). Quake/storm entries are the fallback only — the
    // per-level maps below drive those kinds. Defaults mirror DEFAULT_*_HOLD_SECONDS.
    kindHoldSeconds: {
      intro: { type: Number, default: 17 },
      global: { type: Number, default: 17 },
      ocean: { type: Number, default: 17 },
      orbital: { type: Number, default: 17 },
      country: { type: Number, default: 12 },
      region: { type: Number, default: 12 },
      point: { type: Number, default: 12 },
      storm: { type: Number, default: 12 },
      volcano: { type: Number, default: 12 },
      quake: { type: Number, default: 12 },
      flight: { type: Number, default: 12 },
      ship: { type: Number, default: 12 },
      ad: { type: Number, default: 12 },
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
      country: { type: Boolean, default: true },
      region: { type: Boolean, default: false },
      point: { type: Boolean, default: false },
      storm: { type: Boolean, default: true },
      volcano: { type: Boolean, default: true },
      quake: { type: Boolean, default: true },
      flight: { type: Boolean, default: true },
      ship: { type: Boolean, default: true },
      ad: { type: Boolean, default: false },
    },
    // Sparse SegmentKind → multiplier map (absent = 1) — Mixed like mapTypes.
    kindWeights: { type: mongoose.Schema.Types.Mixed, default: {} },
    countries: { type: [String], default: ["uk", "japan"] },
    regions: { type: [String], default: [] },
    minQuakeMag: { type: Number, required: true, default: 4.5 },
    minAlertSeverity: { type: Number, required: true, default: 3 },
    alertCycleSeconds: { type: Number, required: true, default: 6 },
    adEveryNShots: { type: Number, required: true, default: 6 },
    skipNonce: { type: Number, required: true, default: 0 },
    // Script-mode play trigger (DirectorScriptPlay). No defaults: absent until a
    // script is first played on this scene, so auto-only scenes never carry one.
    script: {
      scriptId: { type: String },
      fromClip: { type: Number },
      playNonce: { type: Number },
      record: { type: Boolean },
    },
    // Dynamic per-kind keys (SegmentKind → string[] / bool map) — Mixed, same
    // precedent as satImgFeeds in broadcast-state-model.ts.
    mapTypes: { type: mongoose.Schema.Types.Mixed, default: {} },
    overlayOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
    kindLooks: { type: mongoose.Schema.Types.Mixed, default: {} },
    kindSlides: { type: mongoose.Schema.Types.Mixed, default: {} },
    activeSlideId: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Fixed-shape tuning buckets (director-tuning.ts) — typed paths, not Mixed.
    rotation: numberPaths(DEFAULT_DIRECTOR_ROTATION),
    pools: numberPaths(DEFAULT_DIRECTOR_POOLS),
    tours: numberPaths(DEFAULT_DIRECTOR_TOURS),
    tempo: numberPaths(DEFAULT_DIRECTOR_TEMPO),
    breakIn: {
      enabled: { type: Boolean, default: DEFAULT_BREAK_IN.enabled },
      interrupt: { type: String, enum: ["boundary", "immediate"], default: DEFAULT_BREAK_IN.interrupt },
      reasons: {
        quake: { type: Boolean, default: DEFAULT_BREAK_IN.reasons.quake },
        storm: { type: Boolean, default: DEFAULT_BREAK_IN.reasons.storm },
        volcano: { type: Boolean, default: DEFAULT_BREAK_IN.reasons.volcano },
        roundup: { type: Boolean, default: DEFAULT_BREAK_IN.reasons.roundup },
      },
      minQuakeMag: { type: Number, default: DEFAULT_BREAK_IN.minQuakeMag },
      minAlertSeverity: { type: Number, default: DEFAULT_BREAK_IN.minAlertSeverity },
      volcanoMin: { type: String, enum: ["erupting", "unrest"], default: DEFAULT_BREAK_IN.volcanoMin },
      windowMinutes: { type: Number, default: DEFAULT_BREAK_IN.windowMinutes },
      guardSeconds: { type: Number, default: DEFAULT_BREAK_IN.guardSeconds },
      cooldownSeconds: { type: Number, default: DEFAULT_BREAK_IN.cooldownSeconds },
      clusterMin: { type: Number, default: DEFAULT_BREAK_IN.clusterMin },
      clusterWindowSeconds: { type: Number, default: DEFAULT_BREAK_IN.clusterWindowSeconds },
      maxPending: { type: Number, default: DEFAULT_BREAK_IN.maxPending },
      roundupCooldownMinutes: { type: Number, default: DEFAULT_BREAK_IN.roundupCooldownMinutes },
      incoming: { type: String, enum: ["off", "breakIns", "allEvents"], default: DEFAULT_BREAK_IN.incoming },
      incomingSeconds: { type: Number, default: DEFAULT_BREAK_IN.incomingSeconds },
      worldRoundup: { type: Boolean, default: DEFAULT_BREAK_IN.worldRoundup },
    },
  },
  mongoTimestamps,
);

export const getDirectorConfigModel = (conn: Connection) =>
  getModel<iDirectorConfigModel>(conn, "DirectorConfig", DirectorConfigSchema);
