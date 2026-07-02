import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ControlState } from "../control";

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
}

const BroadcastStateSchema = new mongoose.Schema<iBroadcastStateModel>(
  {
    id: { type: String, required: true, unique: true, default: BROADCAST_STATE_ID },
    /** Operator-facing scene name. The singleton "default" doc is "Main". */
    name: { type: String, required: false, default: "Main" },
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
    windMode: { type: String, required: true, enum: ["particles", "barbs"], default: "particles" },
    showContours: { type: Boolean, required: true, default: false },
    showElevation: { type: Boolean, required: true, default: false },
    elevationInterval: { type: Number, required: true, default: 500 },
    elevationMajorInterval: { type: Number, required: true, default: 2000 },
    showRadar: { type: Boolean, required: true, default: false },
    showSatellites: { type: Boolean, required: true, default: false },
    showAircraft: { type: Boolean, required: true, default: false },
    showShips: { type: Boolean, required: true, default: false },
    satelliteGroup: { type: String, required: true, default: "visual" },
    autoSpin: { type: Boolean, required: true, default: false },
    spinSpeed: { type: Number, required: true, default: 8 },
    spinEpoch: { type: Number, required: true, default: 0 },
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
    showSeismic: { type: Boolean, required: true, default: false },
    seismicMinMag: { type: Number, required: true, default: 2.5 },
    showCables: { type: Boolean, required: true, default: false },
    showFaults: { type: Boolean, required: true, default: false },
  },
  mongoTimestamps,
);

export const getBroadcastStateModel = (conn: Connection) =>
  getModel<iBroadcastStateModel>(conn, "BroadcastState", BroadcastStateSchema);
