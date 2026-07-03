import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Curated "notable tracks" catalog — the handful of genuinely interesting aircraft
 * and ships we want to surface on air (Air Force One, aircraft carriers, famous
 * liners, research vessels), keyed by ICAO24 hex (aircraft) or MMSI (ship).
 *
 * Two layers of fields:
 *  • curated — hand-maintained via the seed list + /admin (label, category, the
 *    exact Wikipedia title to enrich from, operator overrides). Small + stable.
 *  • enriched — worker-filled and cached (photo, blurb, type/operator/flag). Filled
 *    gently from FREE keyless sources (Wikipedia REST summary, planespotters.net)
 *    and the existing aircraftMeta cache — never re-hammered (staleness-gated).
 *
 * The director joins this by `${kind}:${code}` to boost catalogued craft onto air
 * and to hang the on-air Track Info card off the segment. Deliberately tiny: only
 * the notable ones, so free enrichment (which needs a Wikipedia article) works.
 */
export type NotableKind = "aircraft" | "ship";

export interface iNotableTrack extends iGeneralModel {
  /** `${kind}:${code}` — also the document id (unique per craft). */
  id: string;
  kind: NotableKind;
  /** ICAO24 hex (lowercase) for aircraft, or MMSI for ships. */
  code: string;
  /** On-air display name, e.g. "Air Force One". */
  label: string;
  /** Loose grouping for tinting/filtering, e.g. "government" | "military" |
   *  "research" | "cruise" | "cargo" | "historic" | "special". */
  category?: string;
  /** Exact Wikipedia article title to enrich the photo + blurb from. */
  wikiTitle?: string;
  /** Operator can hide an entry without deleting it (skips scoring + enrichment). */
  enabled: boolean;
  /**
   * Top-tier flag: a genuine VIP (e.g. Air Force One). When it's actually live —
   * airborne / transmitting / moving — it should take priority outright over
   * ordinary notable craft. Carried on the segment for on-air emphasis; the
   * director gives it the biggest scoring boost.
   */
  vip?: boolean;
  /** Freeform operator note. */
  notes?: string;

  // ── Operator overrides (win over enrichment when set) ──
  photoUrlOverride?: string;
  blurbOverride?: string;

  // ── Curated-or-enriched descriptive fields ──
  /** Aircraft type / vessel type, e.g. "Boeing VC-25A". Seed may pre-fill it;
   *  enrichment fills it from the aircraftMeta cache only when still empty. */
  type?: string;
  operator?: string;
  registration?: string;
  flag?: string;
  country?: string;
  /** IMO number (ships), when known. */
  imo?: string;

  // ── Enriched (worker-filled, cached) ──
  photoUrl?: string;
  photoCredit?: string;
  photoLink?: string;
  wikiExtract?: string;
  /** epoch ms of the last Wikipedia lookup (incl. misses, to throttle retries). */
  wikiFetchedAt?: number;
  /** epoch ms of the last planespotters photo lookup (incl. misses). */
  photoFetchedAt?: number;
}

export interface iNotableTrackModel extends iNotableTrack {
  id: string;
  _id: string;
}

/** Compose the stable document id / catalog key for a craft. */
export const notableId = (kind: NotableKind, code: string): string =>
  `${kind}:${String(code).trim().toLowerCase()}`;

const NotableTrackSchema = new mongoose.Schema<iNotableTrackModel>(
  {
    id: { type: String, required: true, unique: true },
    kind: { type: String, required: true, enum: ["aircraft", "ship"], index: true },
    code: { type: String, required: true, index: true },
    label: { type: String, required: true },
    category: { type: String, required: false },
    wikiTitle: { type: String, required: false },
    enabled: { type: Boolean, required: true, default: true },
    vip: { type: Boolean, required: false },
    notes: { type: String, required: false },

    photoUrlOverride: { type: String, required: false },
    blurbOverride: { type: String, required: false },

    type: { type: String, required: false },
    operator: { type: String, required: false },
    registration: { type: String, required: false },
    flag: { type: String, required: false },
    country: { type: String, required: false },
    imo: { type: String, required: false },

    photoUrl: { type: String, required: false },
    photoCredit: { type: String, required: false },
    photoLink: { type: String, required: false },
    wikiExtract: { type: String, required: false },
    wikiFetchedAt: { type: Number, required: false },
    photoFetchedAt: { type: Number, required: false },
  },
  mongoTimestamps,
);

export const getNotableTrackModel = (conn: Connection) =>
  getModel<iNotableTrackModel>(conn, "NotableTrack", NotableTrackSchema);
