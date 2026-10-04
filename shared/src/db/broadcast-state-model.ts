import mongoose, { Connection } from "mongoose";
import { randomBytes } from "node:crypto";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ControlState, SceneSurface } from "../control";
import {
  AUDIO_MODES,
  DEFAULT_IDLE_ORBIT_DEG,
  DEFAULT_IDLE_BREATHE,
  DEFAULT_IDLE_PERIOD_S,
} from "../control";
import { defaultSatImgFeeds } from "../satimg/types";
import { DEFAULT_SLIDE_HOLD_MS, DEFAULT_SLIDE_RUNS } from "../broadcast-slides";
import { DEFAULT_REPORT_HOLD_MS, DEFAULT_REPORT_RUNS } from "../broadcast-report";
import { DEFAULT_READ_CPS } from "../reading-pace";

/** The id of the single broadcast-state document (single-domain → one row). */
export const BROADCAST_STATE_ID = "default" as const;

/** Enum sources mirrored from control.ts TrackColorMode / TrackIconMode. */
const COLOR_MODES = ["kind", "speed", "altitude", "country", "custom"] as const;
const ICON_MODES = ["dot", "arrow", "glyph"] as const;

/** Shared TrackStyle sub-schema (per-type marker styling + display filters). */
const trackStyleSchema = {
  color: { type: String, required: true, enum: COLOR_MODES, default: "kind" },
  icon: { type: String, required: true, enum: ICON_MODES, default: "arrow" },
  customColor: { type: String, required: false, default: "#facc15" },
  opacity: { type: Number, required: false, default: 1 },
  minAltM: { type: Number, required: false, default: 0 },
  maxAltM: { type: Number, required: false, default: 0 },
  minSpeed: { type: Number, required: false, default: 0 },
  country: { type: String, required: false, default: "" },
  hideGround: { type: Boolean, required: false, default: false },
};

/** Persisted operator state. Mirrors ControlState plus the base entity fields. */
export interface iBroadcastState extends iGeneralModel, ControlState {}

export interface iBroadcastStateModel extends iBroadcastState {
  id: string;
  _id: string;
  /** Operator-facing scene name. The singleton "default" doc is "Main". */
  name?: string;
  /** Secret gating the tokened /watch URL for this scene. Not part of ControlState. */
  watchToken?: string;
  /** Kept off viewer-facing scene lists (SceneMeta.hidden). Not part of ControlState. */
  hidden?: boolean;
  /** Which kind of channel (SceneMeta.surface). Missing means "globe". Not part of ControlState. */
  surface?: SceneSurface;
}

export const BroadcastStateSchema = new mongoose.Schema<iBroadcastStateModel>(
  {
    id: { type: String, required: true, unique: true, default: BROADCAST_STATE_ID },
    /** Operator-facing scene name. The singleton "default" doc is "Main". */
    name: { type: String, required: false, default: "Main" },
    /** Secret gating the tokened /watch URL for this scene. */
    watchToken: { type: String, required: false, default: () => randomBytes(24).toString("hex") },
    /** Production scene (the short-video scenes): off the public home page and launcher. */
    hidden: { type: Boolean, required: false, default: false },
    /** Channel kind (docs/crossword-mode-plan.md §3). No default: missing reads as "globe". */
    surface: { type: String, required: false, enum: ["globe", "crossword"] },
    activeVariable: { type: String, required: false, default: "temp" },
    fhr: { type: Number, required: true, default: 0 },
    basemap: { type: String, required: true, default: "dark" },
    showWind: { type: Boolean, required: true, default: true },
    showPressure: { type: Boolean, required: true, default: false },
    showCities: { type: Boolean, required: true, default: true },
    camera: {
      center: { type: [Number], required: true, default: [0, 20] },
      zoom: { type: Number, required: true, default: 1.4 },
    },
    units: {
      wind: { type: String, required: true, enum: ["kt", "m/s"], default: "kt" },
      temp: { type: String, required: true, enum: ["C", "F"], default: "C" },
    },
    basemapColors: {
      ocean: { type: String, required: true, default: "#080e18" },
      land: { type: String, required: true, default: "#1c222e" },
      border: { type: String, required: true, default: "#dce4f0" },
    },
    wind: {
      numParticles: { type: Number, required: true, default: 6000 },
      speedFactor: { type: Number, required: true, default: 8 },
      maxAge: { type: Number, required: true, default: 30 },
      width: { type: Number, required: true, default: 2 },
      opacity: { type: Number, required: true, default: 0.9 },
      color: { type: String, required: true, default: "#ffffff" },
    },
    showContours: { type: Boolean, required: true, default: false },
    showElevation: { type: Boolean, required: true, default: false },
    elevation: {
      colorMode: { type: String, required: true, enum: ["default", "elevation", "custom"], default: "elevation" },
      color: { type: String, required: true, default: "#ffe0b2" },
      width: { type: Number, required: true, default: 1.5 },
      opacity: { type: Number, required: true, default: 1 },
      interval: { type: Number, required: true, default: 250 },
      majorInterval: { type: Number, required: true, default: 1000 },
    },
    showRadar: { type: Boolean, required: true, default: false },
    showSatellites: { type: Boolean, required: true, default: false },
    showAircraft: { type: Boolean, required: true, default: false },
    showShips: { type: Boolean, required: true, default: false },
    satelliteGroup: { type: String, required: true, default: "visual" },
    autoSpin: { type: Boolean, required: true, default: false },
    spinSpeed: { type: Number, required: true, default: 8 },
    zoomDrift: { type: Number, required: true, default: 0 },
    orbitDrift: { type: Number, required: true, default: 0 },
    idleMotion: { type: Boolean, required: true, default: false },
    idleOrbit: { type: Number, required: true, default: DEFAULT_IDLE_ORBIT_DEG },
    idleBreathe: { type: Number, required: true, default: DEFAULT_IDLE_BREATHE },
    idlePeriodS: { type: Number, required: true, default: DEFAULT_IDLE_PERIOD_S },
    spinEpoch: { type: Number, required: true, default: 0 },
    cutTransitionMs: { type: Number, required: true, default: 0 },
    showTrackLabels: { type: Boolean, required: true, default: false },
    satelliteStyle: {
      color: { type: String, required: true, enum: COLOR_MODES, default: "kind" },
      icon: { type: String, required: true, enum: ICON_MODES, default: "dot" },
      customColor: { type: String, required: false, default: "#38bdf8" },
      opacity: { type: Number, required: false, default: 1 },
      minAltM: { type: Number, required: false, default: 0 },
      maxAltM: { type: Number, required: false, default: 0 },
      minSpeed: { type: Number, required: false, default: 0 },
      country: { type: String, required: false, default: "" },
      hideGround: { type: Boolean, required: false, default: false },
    },
    aircraftStyle: { ...trackStyleSchema, customColor: { type: String, required: false, default: "#facc15" } },
    shipStyle: { ...trackStyleSchema, customColor: { type: String, required: false, default: "#22c55e" } },
    showOrbits: { type: Boolean, required: true, default: false },
    showTrails: { type: Boolean, required: true, default: false },
    trailMinutes: { type: Number, required: true, default: 30 },
    trailOpacity: { type: Number, required: true, default: 0.35 },
    showAlerts: { type: Boolean, required: true, default: false },
    alertSeverityMin: { type: Number, required: true, default: 0 },
    alertHazardsOff: { type: [String], required: true, default: [] },
    alertCycle: { type: Boolean, required: true, default: true },
    showSeismic: { type: Boolean, required: true, default: false },
    seismicMinMag: { type: Number, required: true, default: 2.5 },
    showCables: { type: Boolean, required: true, default: false },
    showCableLabels: { type: Boolean, required: true, default: false },
    showFaults: { type: Boolean, required: true, default: false },
    showAurora: { type: Boolean, required: true, default: false },
    auroraOpacity: { type: Number, required: true, default: 0.85 },
    showSatImg: { type: Boolean, required: true, default: false },
    satImgFeeds: { type: mongoose.Schema.Types.Mixed, required: true, default: () => defaultSatImgFeeds() },
    showFires: { type: Boolean, required: true, default: false },
    showVolcanoes: { type: Boolean, required: true, default: false },
    showMagneticField: { type: Boolean, required: true, default: false },
    magneticFieldOpacity: { type: Number, required: true, default: 0.8 },
    showMapSource: { type: Boolean, required: true, default: false },
    showGraticule: { type: Boolean, required: true, default: false },
    graticuleColor: { type: String, required: true, default: "#7dd3fc" },
    graticuleLabels: { type: Boolean, required: true, default: true },
    showAtmosphere: { type: Boolean, required: true, default: true },
    showDayNight: { type: Boolean, required: true, default: false },
    showBroadcastChrome: { type: Boolean, required: true, default: true },
    broadcastTheme: { type: String, required: true, default: "command" },
    widgetsOff: { type: [String], required: true, default: [] },
    slidesOff: { type: [String], required: true, default: [] },
    slideOrder: { type: [String], required: true, default: [] },
    slideHoldMs: { type: Number, required: true, default: DEFAULT_SLIDE_HOLD_MS },
    slideRuns: { type: Number, required: true, default: DEFAULT_SLIDE_RUNS },
    reportOff: { type: [String], required: true, default: [] },
    reportOrder: { type: [String], required: true, default: [] },
    reportHoldMs: { type: Number, required: true, default: DEFAULT_REPORT_HOLD_MS },
    reportRuns: { type: Number, required: true, default: DEFAULT_REPORT_RUNS },
    weatherLocations: {
      type: [
        {
          _id: false,
          label: { type: String, required: true },
          lat: { type: Number, required: true },
          lng: { type: Number, required: true },
        },
      ],
      required: true,
      default: [],
    },
    reportKindsOff: { type: [String], required: true, default: [] },
    reportHazardsOff: { type: [String], required: true, default: [] },
    readPaceCps: { type: Number, required: true, default: DEFAULT_READ_CPS },
    tickerKindsOff: { type: [String], required: true, default: [] },
    tickerHazardsOff: { type: [String], required: true, default: [] },
    pointVarsOff: { type: [String], required: true, default: [] },
    themeOverrides: { type: mongoose.Schema.Types.Mixed, required: true, default: () => ({}) },
    about: {
      title: { type: String, required: false, default: "" },
      body: { type: String, required: false, default: "" },
      sources: { type: String, required: false, default: "" },
      footer: { type: String, required: false, default: "" },
    },
    youtube: {
      title: { type: String, required: false, default: "" },
      description: { type: String, required: false, default: "" },
      thumbnailUrl: { type: String, required: false, default: "" },
      accountId: { type: String, required: false, default: "" },
    },
    audio: {
      enabled: { type: Boolean, required: true, default: false },
      mode: { type: String, required: true, enum: AUDIO_MODES, default: "auto" },
      volume: { type: Number, required: true, default: 0.7 },
      muted: { type: Boolean, required: true, default: false },
    },
    chat: {
      enabled: { type: Boolean, required: true, default: false },
      promoteToTicker: { type: Boolean, required: true, default: false },
      // Viewer chat policy (chat-policy.ts): nested, with arrays of palettes —
      // Mixed, sanitised by mergeControlState on every write.
      commands: { type: mongoose.Schema.Types.Mixed, default: undefined },
    },
    startAt: { type: Number, required: false, default: null },
  },
  mongoTimestamps,
);

export const getBroadcastStateModel = (conn: Connection) =>
  getModel<iBroadcastStateModel>(conn, "BroadcastState", BroadcastStateSchema);
