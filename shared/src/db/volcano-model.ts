import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * The volcano CATALOG — a permanent record per Smithsonian VOTW volcano, upserted
 * on the stable `volcanoId` (`gvp:<vnum>`).
 *
 * This collection used to be "the weekly-bulletin cache" and carried a 14-day TTL
 * on `fetchedAt`, so any volcano that stopped being re-reported was DELETED. That
 * is wrong for a catalog: a volcano is a permanent geographic feature, and an
 * inactive one still has stats worth showing (type, elevation, rock, tectonic
 * setting, eruption history, photo). The TTL is gone (see P7 in
 * docs/volcano-observation-plan.md).
 *
 * Identity is therefore separated from activity:
 *   - the ROW is permanent and never expires;
 *   - `bulletinAt` — set ONLY by the GVP weekly snapshot — answers "is it in the
 *     current bulletin?" (within ~2 cycles/14d). Never infer that from row
 *     existence, and never infer "quiet" from a missing row.
 *   - `fetchedAt` still means "last touched by any writer" but no longer governs
 *     lifetime.
 *
 * NOTE: dropping a TTL requires an explicit `dropIndex` — Mongo will not remove it
 * just because the declaration disappeared here. Run the `volcanoes-migrate-catalog`
 * admin job once against an existing database.
 */
/** Window in which a volcano still counts as "in the current weekly bulletin". */
export const BULLETIN_WINDOW_SEC = Number(process.env.VOLCANO_BULLETIN_WINDOW_SEC || 14 * 24 * 60 * 60);

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
  /** Last time the GVP WEEKLY bulletin listed this volcano. Only the weekly
   *  snapshot writes it; `bulletinAt` within BULLETIN_WINDOW_SEC = currently
   *  reported. Replaces the old "row still exists ⇒ in the bulletin" inference. */
  bulletinAt?: Date;
  /**
   * Operator opt-in: keep a HISTORICAL camera-frame archive + timelapse for this
   * volcano ("keep latest of all, history only of the ones we choose"). Default
   * off; never auto-enabled. Latest-frame capture is unaffected — it runs for
   * every enabled camera regardless. See P7 §7.11.
   */
  archiveEnabled?: boolean;
  loc?: { type: "Point"; coordinates: [number, number] };
  // ── GVP VOTW catalog facts (permanent; written by the catalog seed) ──────────
  /** Which catalog wrote the fields below, e.g. "gvp-wfs". */
  catalogSource?: string;
  catalogFetchedAt?: Date;
  volcanicLandform?: string;
  region?: string;
  subregion?: string;
  tectonicSetting?: string;
  /** "Holocene" | "Pleistocene". */
  geologicEpoch?: string;
  evidenceCategory?: string;
  majorRockTypes?: string[];
  /** GVP's authoritative geology prose (richer than Wikipedia for this). */
  geologicalSummary?: string;
  /** GVP's own primary photo — a catalog FACT fetched once, not a media stream. */
  primaryPhotoUrl?: string;
  primaryPhotoCaption?: string;
  primaryPhotoCredit?: string;
  /**
   * Operator-set Wikipedia search term, used INSTEAD of the name-derived
   * candidates when enriching (see worker/src/jobs/volcanoes.ts#titleCandidates).
   * For the volcanoes whose GVP name doesn't resolve to the right article — a
   * name shared with a town, an article filed under a local spelling. Set it on
   * /admin/volcanoes/:id; clearing it restores the derived guesses.
   */
  searchOverride?: string;
  /** Wikipedia enrichment (see worker/src/jobs/volcanoes.ts#enrichWiki). */
  wikiTitle?: string;
  wikiThumb?: string;
  wikiPhoto?: string;
  wikiExtract?: string;
  wikiGallery?: string[];
  wikiFetchedAt?: Date;
  elevationM?: number;
  volcanoType?: string;
  lastEruptionYear?: number;
  usgsAlertLevel?: string;
  usgsColorCode?: string;
  usgsNoticeSynopsis?: string;
  usgsNoticeUrl?: string;
  usgsUpdatedAt?: Date;
  /**
   * Official observatory status from a source OTHER than USGS (e.g. GeoNet's
   * Volcanic Alert Level) — kept separate from the GVP-derived `status` so the
   * two schemes don't overwrite each other on alternating polls. Raw value is
   * preserved (national schemes aren't equivalent); normalized is for scoring.
   * Official > GVP-weekly by the source-priority rule.
   */
  officialSource?: string;
  officialAlertScheme?: string;
  officialAlertLevelRaw?: string;
  officialAlertLevelNormalized?: string;
  officialActivity?: string;
  officialUpdatedAt?: Date;
  reportVei?: number;
  reportPlumeHeightM?: number;
  reportParsedAt?: Date;
}

export interface iVolcanoModel extends iVolcano {
  id: string;
  _id: string;
}

export const VolcanoSchema = new mongoose.Schema<iVolcanoModel>(
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
    bulletinAt: { type: Date, required: false },
    archiveEnabled: { type: Boolean, required: false },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
    catalogSource: { type: String, required: false },
    catalogFetchedAt: { type: Date, required: false },
    volcanicLandform: { type: String, required: false },
    region: { type: String, required: false },
    subregion: { type: String, required: false },
    tectonicSetting: { type: String, required: false },
    geologicEpoch: { type: String, required: false },
    evidenceCategory: { type: String, required: false },
    majorRockTypes: { type: [String], required: false },
    geologicalSummary: { type: String, required: false },
    primaryPhotoUrl: { type: String, required: false },
    primaryPhotoCaption: { type: String, required: false },
    primaryPhotoCredit: { type: String, required: false },
    searchOverride: { type: String, required: false },
    wikiTitle: { type: String, required: false },
    wikiThumb: { type: String, required: false },
    wikiPhoto: { type: String, required: false },
    wikiExtract: { type: String, required: false },
    wikiGallery: { type: [String], required: false },
    wikiFetchedAt: { type: Date, required: false },
    elevationM: { type: Number, required: false },
    volcanoType: { type: String, required: false },
    lastEruptionYear: { type: Number, required: false },
    usgsAlertLevel: { type: String, required: false },
    usgsColorCode: { type: String, required: false },
    usgsNoticeSynopsis: { type: String, required: false },
    usgsNoticeUrl: { type: String, required: false },
    usgsUpdatedAt: { type: Date, required: false },
    officialSource: { type: String, required: false },
    officialAlertScheme: { type: String, required: false },
    officialAlertLevelRaw: { type: String, required: false },
    officialAlertLevelNormalized: { type: String, required: false },
    officialActivity: { type: String, required: false },
    officialUpdatedAt: { type: Date, required: false },
    reportVei: { type: Number, required: false },
    reportPlumeHeightM: { type: Number, required: false },
    reportParsedAt: { type: Date, required: false },
  },
  { timestamps: false },
);

VolcanoSchema.index({ volcanoId: 1 }, { unique: true, name: "volcano_id_ix" });
VolcanoSchema.index({ lastDate: -1 }, { name: "volcano_last_date_ix" });
VolcanoSchema.index({ loc: "2dsphere" }, { name: "volcano_geo_ix", sparse: true });
// The old `volcano_ttl_ix` (expireAfterSeconds on fetchedAt) is DELIBERATELY gone —
// the catalog is permanent (see the header). Removing the declaration does NOT drop
// an index that already exists in Mongo: run `volcanoes-migrate-catalog` once.
// Status/epoch reads scan the whole catalog now that dormant volcanoes are kept.
VolcanoSchema.index({ status: 1 }, { name: "volcano_status_ix" });
VolcanoSchema.index({ archiveEnabled: 1 }, { name: "volcano_archive_ix", sparse: true });

export const getVolcanoModel = (conn: Connection) =>
  getModel<iVolcanoModel>(conn, "Volcano", VolcanoSchema);
