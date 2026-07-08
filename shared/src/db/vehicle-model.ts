import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Persistent vehicle registry — ONE durable doc per aircraft/ship we've ever seen,
 * keyed by `${kind}:${code}` (ICAO24 hex / MMSI). Unlike `trackSnapshots` (the
 * ephemeral, TTL'd live feed) this NEVER expires: it's the long-lived identity +
 * enrichment + curation home for a craft, whether or not it's currently around.
 *
 * Layers:
 *  • identity/lifecycle — refreshed every sighting by the snapshot jobs (name,
 *    country/flag, firstSeen/lastSeen/timesSeen, last position).
 *  • enrichment — cached from FREE sources (Wikipedia photo+blurb, planespotters
 *    photo, hexdb type/operator via the aircraftMeta cache). Filled for flagged
 *    craft; staleness-gated.
 *  • curation — `notable`/`vip`/`enabled` flags + operator overrides. "Notable"
 *    is now just a flag on a vehicle; the director boosts notable+enabled ones.
 *  • path — a capped breadcrumb ("route") kept ONLY for flagged craft, so their
 *    full track can be plotted well beyond the live feed's 6h window.
 */
export type VehicleKind = "aircraft" | "ship";

export interface iVehiclePoint {
  lng: number;
  lat: number;
  /** epoch ms of the sighting. */
  t: number;
}

export interface iVehicle extends iGeneralModel {
  /** `${kind}:${code}` — also the document id. */
  id: string;
  kind: VehicleKind;
  /** ICAO24 hex (lowercase) for aircraft, or MMSI for ships. */
  code: string;

  // ── Identity (refreshed each sighting) ──
  /** Callsign (aircraft) / AIS ship name — latest seen. */
  name?: string;
  country?: string;
  flag?: string;
  /** Registration / tail number (aircraft). */
  registration?: string;
  /** IMO number (ships). */
  imo?: string;

  // ── Lifecycle ──
  firstSeen?: Date;
  lastSeen?: Date;
  timesSeen?: number;
  lastLng?: number;
  lastLat?: number;

  // ── Enrichment (cached from free sources) ──
  type?: string;
  operator?: string;
  manufacturer?: string;
  photoUrl?: string;
  photoCredit?: string;
  photoLink?: string;
  wikiTitle?: string;
  wikiExtract?: string;
  wikiFetchedAt?: number;
  photoFetchedAt?: number;

  // ── Curation ──
  /** Surfaced as a genuinely interesting craft (director boost + on-air card). */
  notable?: boolean;
  /** Top-tier (e.g. Air Force One) — biggest boost when live. */
  vip?: boolean;
  /** Eligible for the director when notable (operator can disable without deleting). */
  enabled?: boolean;
  category?: string;
  /** On-air display name override; falls back to wikiTitle → name → code. */
  label?: string;
  notes?: string;
  photoUrlOverride?: string;
  blurbOverride?: string;

  // ── Route (persistent breadcrumb; only kept for flagged craft) ──
  path?: iVehiclePoint[];
}

export interface iVehicleModel extends iVehicle {
  id: string;
  _id: string;
}

/** Compose the stable document id / registry key for a craft. */
export const vehicleId = (kind: VehicleKind, code: string): string =>
  `${kind}:${String(code).trim().toLowerCase()}`;

/** Best on-air display name for a vehicle doc. */
export const vehicleLabel = (v: Pick<iVehicle, "label" | "wikiTitle" | "name" | "code">): string =>
  v.label?.trim() || v.wikiTitle?.trim() || v.name?.trim() || v.code.toUpperCase();

const PointSchema = new mongoose.Schema<iVehiclePoint>(
  { lng: { type: Number, required: true }, lat: { type: Number, required: true }, t: { type: Number, required: true } },
  { _id: false },
);

const VehicleSchema = new mongoose.Schema<iVehicleModel>(
  {
    id: { type: String, required: true, unique: true },
    // kind is covered by vehicle_kind_lastseen_ix below; code lookups go through
    // the composite `id` (`kind:code`), so neither needs its own index.
    kind: { type: String, required: true, enum: ["aircraft", "ship"] },
    code: { type: String, required: true },

    name: { type: String, required: false },
    country: { type: String, required: false },
    flag: { type: String, required: false },
    registration: { type: String, required: false },
    imo: { type: String, required: false },

    firstSeen: { type: Date, required: false },
    lastSeen: { type: Date, required: false },
    timesSeen: { type: Number, required: false, default: 0 },
    lastLng: { type: Number, required: false },
    lastLat: { type: Number, required: false },

    type: { type: String, required: false },
    operator: { type: String, required: false },
    manufacturer: { type: String, required: false },
    photoUrl: { type: String, required: false },
    photoCredit: { type: String, required: false },
    photoLink: { type: String, required: false },
    wikiTitle: { type: String, required: false },
    wikiExtract: { type: String, required: false },
    wikiFetchedAt: { type: Number, required: false },
    photoFetchedAt: { type: Number, required: false },

    notable: { type: Boolean, required: false, index: true },
    vip: { type: Boolean, required: false },
    enabled: { type: Boolean, required: false },
    category: { type: String, required: false },
    label: { type: String, required: false },
    notes: { type: String, required: false },
    photoUrlOverride: { type: String, required: false },
    blurbOverride: { type: String, required: false },

    path: { type: [PointSchema], required: false },
  },
  mongoTimestamps,
);

// Sort/browse the registry by recency; the notable index above filters the catalog.
VehicleSchema.index({ lastSeen: -1 }, { name: "vehicle_lastseen_ix" });
// Admin tables: list one kind, newest-sighting first — served entirely by the index.
VehicleSchema.index({ kind: 1, lastSeen: -1 }, { name: "vehicle_kind_lastseen_ix" });

export const getVehicleModel = (conn: Connection) =>
  getModel<iVehicleModel>(conn, "Vehicle", VehicleSchema);
