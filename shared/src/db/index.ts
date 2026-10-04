import type { Connection } from "mongoose";
import { randomBytes } from "node:crypto";
import { getDb } from "../utill/mongoose";
import { iEntity, makeCollection } from "./generic";
import { mongoCrud } from "./mongoose-generic";
import { getWeatherRunModel, iWeatherRunModel } from "./weather-run-model";
import { getWeatherTextureModel } from "./weather-texture-model";
import { makeWeatherTextureRepo } from "./weather-texture-repo";
import { getWeatherFrameModel } from "./weather-frame-model";
import { makeWeatherFrameRepo } from "./weather-frame-repo";
import { getWeatherForecastFrameModel } from "./weather-forecast-frame-model";
import { makeWeatherForecastFrameRepo } from "./weather-forecast-frame-repo";
import { getBlobModel, makeBlobStore } from "./blob-store";
import { BlobFs } from "./blob-fs";
import { makeInlineBlobStore } from "./inline-blob";
import { getClimateYearModel } from "./climate-year-model";
import { makeClimateYearRepo } from "./climate-year-repo";
import { getCityModel } from "./city-model";
import { getAlertModel } from "./alert-model";
import { makeAlertsRepo } from "./alerts-repo";
import { getAlertRevisionModel } from "./alert-revision-model";
import { makeAlertRevisionRepo } from "./alert-revision-repo";
import { getAlertSeriesModel } from "./alert-series-model";
import { makeAlertSeriesRepo } from "./alert-series-repo";
import { getAlertResourceModel } from "./alert-resource-model";
import { makeAlertResourceRepo } from "./alert-resource-repo";
import { getAlertSnapshotModel } from "./alert-snapshot-model";
import { makeAlertSnapshotRepo } from "./alert-snapshot-repo";
import { getWatchedEventModel } from "./watched-event-model";
import { makeWatchedEventRepo } from "./watched-event-repo";
import { getEventSourceModel } from "./event-source-model";
import { makeEventSourceRepo } from "./event-source-repo";
import { getEventSourceRevisionModel } from "./event-source-revision-model";
import { makeEventSourceRevisionRepo } from "./event-source-revision-repo";
import { getEventTimelineUpdateModel } from "./event-timeline-update-model";
import { makeEventTimelineUpdateRepo } from "./event-timeline-update-repo";
import { getEventExternalLinkModel } from "./event-external-link-model";
import { makeEventExternalLinkRepo } from "./event-external-link-repo";
import { getEventResourceModel } from "./event-resource-model";
import { makeEventResourceRepo } from "./event-resource-repo";
import { getEventSeriesModel } from "./event-series-model";
import { makeEventSeriesRepo } from "./event-series-repo";
import { getEventSnapshotModel } from "./event-snapshot-model";
import { makeEventSnapshotRepo } from "./event-snapshot-repo";
import { getEventWatchScheduleModel } from "./event-watch-schedule-model";
import { makeEventWatchScheduleRepo } from "./event-watch-schedule-repo";
import { getSatelliteTleModel } from "./satellite-tle-model";
import { makeSatelliteTleRepo } from "./satellite-tle-repo";
import { getTrackSnapshotModel } from "./track-snapshot-model";
import { makeTrackSnapshotRepo } from "./track-snapshot-repo";
import { getQuakeModel } from "./quake-model";
import { makeQuakeRepo } from "./quake-repo";
import { getBlobUsageModel } from "./blob-usage-model";
import { makeBlobUsageRepo } from "./blob-usage-repo";
import { getQuakeArchiveModel } from "./quake-archive-model";
import { makeQuakeArchiveRepo } from "./quake-archive-repo";
import { getTideStationModel } from "./tide-station-model";
import { makeTideStationRepo } from "./tide-station-repo";
import { getTideSeriesModel } from "./tide-series-model";
import { makeTideSeriesRepo } from "./tide-series-repo";
import { getSeismoStationModel } from "./seismo-station-model";
import { makeSeismoStationRepo } from "./seismo-station-repo";
import { getSeismoSeriesModel } from "./seismo-series-model";
import { makeSeismoSeriesRepo } from "./seismo-series-repo";
import { getEventSummaryModel } from "./event-summary-model";
import { makeEventSummaryRepo } from "./event-summary-repo";
import { getCountryRoundupModel, getRegionRoundupModel } from "./place-roundup-model";
import { makePlaceRoundupRepo } from "./place-roundup-repo";
import { getRoundupSettingsModel } from "./roundup-settings-model";
import { makeRoundupSettingsRepo } from "./roundup-settings-repo";
import { getCableModel } from "./cable-model";
import { getCableLandingModel } from "./cable-landing-model";
import { makeCableRepo } from "./cable-repo";
import { getFaultModel } from "./fault-model";
import { makeFaultRepo } from "./fault-repo";
import { getAlertAreaGeomModel } from "./alert-area-geom-model";
import { getAdminAreaGeomModel } from "./admin-area-geom-model";
import { makeAdminAreaGeomRepo } from "./admin-area-geom-repo";
import { getAlertGeomSeenModel } from "./alert-geom-seen-model";
import { getAlertGeomCrawlModel } from "./alert-geom-crawl-model";
import { makeAlertAreaGeomRepo } from "./alert-area-geom-repo";
import { getCapIdModel } from "./cap-id-model";
import { makeCapIdRepo } from "./cap-id-repo";
import { getAlertBlobModel } from "./alert-blob-model";
import { makeAlertBlobRepo } from "./alert-blob-repo";
import { getAuroraModel } from "./aurora-model";
import { makeAuroraRepo } from "./aurora-repo";
import { getSatImgModel } from "./satimg-model";
import { makeSatImgRepo } from "./satimg-repo";
import { getFireModel } from "./fire-model";
import { makeFireRepo } from "./fire-repo";
import { getVolcanoModel } from "./volcano-model";
import { makeVolcanoRepo } from "./volcano-repo";
import { getVolcanoSourceLinkModel } from "./volcano-source-link-model";
import { makeVolcanoSourceLinkRepo } from "./volcano-source-link-repo";
import { getVolcanoEruptionModel } from "./volcano-eruption-model";
import { makeVolcanoEruptionRepo } from "./volcano-eruption-repo";
import { getVolcanoCameraModel } from "./volcano-camera-model";
import { makeVolcanoCameraRepo } from "./volcano-camera-repo";
import { getVolcanoMediaModel } from "./volcano-media-model";
import { makeVolcanoMediaRepo } from "./volcano-media-repo";
import { getVolcanoMediaSourceModel } from "./volcano-media-source-model";
import { makeVolcanoMediaSourceRepo } from "./volcano-media-source-repo";
import { getCountryModel } from "./country-model";
import { makeCountryRepo } from "./country-repo";
import { getRegionModel } from "./region-model";
import { makeRegionRepo } from "./region-repo";
import { getCityWeatherModel } from "./city-weather-model";
import { makeCityWeatherRepo } from "./city-weather-repo";
import { getAreaWeatherReportModel } from "./area-weather-report-model";
import { makeAreaWeatherReportRepo } from "./area-weather-report-repo";
import { getGeomagModel } from "./geomag-model";
import { makeGeomagRepo } from "./geomag-repo";
import { getCamModel } from "./cam-model";
import { makeCamRepo } from "./cam-repo";
import { getSeaPointModel } from "./sea-point-model";
import { makeSeaPointRepo } from "./sea-point-repo";
import { getShortScriptModel } from "./short-script-model";
import { makeShortScriptRepo } from "./short-script-repo";
import { getCrosswordConfigModel } from "./crossword-config-model";
import { getCrosswordPuzzleModel } from "./crossword-puzzle-model";
import { makeCrosswordPuzzleRepo } from "./crossword-puzzle-repo";
import { getCrosswordGameModel } from "./crossword-game-model";
import { makeCrosswordGameRepo } from "./crossword-game-repo";
import { getCrosswordSolveModel } from "./crossword-solve-model";
import { makeCrosswordSolveRepo } from "./crossword-solve-repo";
import { getCrosswordPlayerModel } from "./crossword-player-model";
import { makeCrosswordPlayerRepo } from "./crossword-player-repo";
import { makeCrosswordBankRepo } from "./crossword-bank-repo";
import { DEFAULT_CROSSWORD_CONFIG, mergeCrosswordConfig, type CrosswordConfig } from "../crossword";
import { getAdModel } from "./ad-model";
import { makeAdRepo } from "./ad-repo";
import { getAdExposureModel } from "./ad-exposure-model";
import { makeAdExposureRepo } from "./ad-exposure-repo";
import { getAdminImageModel } from "./admin-image-model";
import { makeAdminImageRepo } from "./admin-image-repo";
import { getAdminEditModel } from "./admin-edit-model";
import { makeAdminEditRepo } from "./admin-edit-repo";
import { getAircraftMetaModel, iAircraftMetaModel } from "./aircraft-meta-model";
import { getVehicleModel } from "./vehicle-model";
import { makeVehicleRepo } from "./vehicle-repo";
import { getLogModel } from "./log-model";
import { getAirEntryModel, getAirRunModel } from "./air-log-model";
import { makeAirLogRepo } from "./air-log-repo";
import { getUserModel } from "./user-model";
import { makeUserRepo } from "./user-repo";
import { getBroadcastStateModel, BROADCAST_STATE_ID } from "./broadcast-state-model";
import { getDirectorConfigModel } from "./director-config-model";
import { getRunModel, iRunModel } from "./run-model";
import { getChatLogMessageModel } from "./chat-log-model";
import { makeChatLogRepo } from "./chat-log-repo";
import { getDirectorCommandModel } from "./director-command-model";
import { makeDirectorCommandRepo } from "./director-command-repo";
import { getViewerStateModel } from "./viewer-state-model";
import { makeViewerStateRepo } from "./viewer-state-repo";
import { getStreamEncoderModel, iStreamEncoderModel } from "./stream-encoder-model";
import { getStreamSlotModel, iStreamSlotModel } from "./stream-slot-model";
import { getYoutubeAccountModel, iYoutubeAccountModel } from "./youtube-account-model";
import { DEFAULT_CONTROL_STATE, MAIN_SCENE_ID, isSceneSurface, sceneSurface, type SceneSurface } from "../control";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig } from "../director";
import { encoderKeyForRun, runIsActive, type Run, type StreamEncoder, type StreamSlot } from "../runs";

/** Sample entity for the ping demo feature. Replace/extend with real models. */
export interface iPing extends iEntity {
  message: string;
  source: string;
  processedAt?: string;
}

/**
 * Wire all collections here. The legacy `pings` demo uses the native-driver
 * `makeCollection`; the weather domain uses strongly-typed Mongoose models via
 * `mongoCrud`. Both share the one connection (single-domain) and the same
 * `{ success, data?, errors? }` response shape.
 */
/**
 * What each `${BLOB_DIR}` namespace directory holds, for the humans reading
 * /admin/files. Keep this in step with the `blobs` object and the two `*Data`
 * sidecar stores in `createDb` below — a directory with no entry here is
 * reported as unknown, which is the honest answer for one nothing writes.
 */
export const BLOB_NAMESPACES: Record<string, { label: string; desc: string }> = {
  tex: { label: "Weather textures", desc: "Baked GFS/model variable textures served to the globe." },
  frame: { label: "Weather frames", desc: "Long-term weather frame archive: full cadence for the recent window, then one frame per map + variable per UTC day, kept forever. Zoom-gated nests (incl. radar) drop out after their shorter window." },
  "forecast-frame": { label: "Forecast frames", desc: "Daily forecast frames; pruned as runs age out." },
  "admin-image": { label: "Admin images", desc: "Operator-uploaded on-air imagery from /admin/content." },
  ad: { label: "Ads", desc: "Sponsor images and video." },
  aurora: { label: "Aurora", desc: "SWPC OVATION oval glow PNGs." },
  geomag: { label: "Geomagnetic", desc: "Magnetic-field overlay PNGs." },
  satimg: { label: "Satellite imagery", desc: "GIBS true-colour cloud overlays." },
  "alert-snapshot": { label: "Alert snapshots", desc: "Satellite/compare/camera stills per alert: full cadence for the recent window, then one per alert + kind per UTC day, then only an aired alert's keepsake." },
  "event-snapshot": { label: "Event snapshots", desc: "Stills attached to unified watched events." },
  "volcano-media": { label: "Volcano media", desc: "Photos enriched onto the volcano catalog." },
  basemap: { label: "Basemap textures", desc: "Full-globe base images (Blue Marble / topo / night) refreshed from /admin/jobs." },
};

export function createDb(conn: Connection) {
  const weatherRuns = mongoCrud<iWeatherRunModel>(getWeatherRunModel(conn));
  const broadcastState = mongoCrud(getBroadcastStateModel(conn));
  const directorConfig = mongoCrud(getDirectorConfigModel(conn));
  const crosswordConfig = mongoCrud(getCrosswordConfigModel(conn));
  const streamRuns = mongoCrud<iRunModel>(getRunModel(conn));
  const streamEncoders = mongoCrud<iStreamEncoderModel>(getStreamEncoderModel(conn));
  const streamSlots = mongoCrud<iStreamSlotModel>(getStreamSlotModel(conn));
  const youtubeAccounts = mongoCrud<iYoutubeAccountModel>(getYoutubeAccountModel(conn));

  // Shared `${BLOB_DIR}` folder (both containers bind-mount it), or null → the
  // legacy pure-Mongo storage. Threaded into every blob store below so a single
  // env var flips the whole app between backings. See blob-fs.ts / inline-blob.ts.
  const blobFs = BlobFs.fromEnv();

  /**
   * Externalised bytes for the collections that stored their payload INLINE on
   * the doc. Read paths use `.get(id, doc.data)` (FS-first, inline fallback);
   * write paths set the doc field to `.inlineValue(bytes)` then `.put(id, bytes)`.
   * The `migrate:blobs` job copies existing inline bytes here and $unsets them.
   * Owned by the repos below (aurora/geomag/satimg/ads/adminImages) except `tex`,
   * which the texture serve route + worker bake use directly (no custom repo).
   */
  const blobs = {
    tex: makeInlineBlobStore("tex", blobFs),
    adminImage: makeInlineBlobStore("admin-image", blobFs),
    ad: makeInlineBlobStore("ad", blobFs),
    aurora: makeInlineBlobStore("aurora", blobFs),
    geomag: makeInlineBlobStore("geomag", blobFs),
    satimg: makeInlineBlobStore("satimg", blobFs),
    alertSnapshot: makeInlineBlobStore("alert-snapshot", blobFs),
    eventSnapshot: makeInlineBlobStore("event-snapshot", blobFs),
    volcanoMedia: makeInlineBlobStore("volcano-media", blobFs),
  };

  return {
    conn,
    blobFs,
    blobs,
    // Cached measurement of the blob folder. The walk is a stat per file across
    // the whole tree, which outgrew a single HTTP request — the worker measures,
    // public reads this. See blob-usage-model.ts.
    blobUsage: makeBlobUsageRepo(getBlobUsageModel(conn)),
    pings: makeCollection<iPing>(conn, "pings"),
    weatherRuns,
    weatherTextures: makeWeatherTextureRepo(getWeatherTextureModel(conn), blobs.tex),
    weatherFrames: makeWeatherFrameRepo(
      getWeatherFrameModel(conn),
      makeBlobStore(getBlobModel(conn, "WeatherFrameData"), { fs: blobFs, ns: "frame" }),
    ),
    weatherForecastFrames: makeWeatherForecastFrameRepo(
      getWeatherForecastFrameModel(conn),
      makeBlobStore(getBlobModel(conn, "WeatherForecastFrameData"), {
        fs: blobFs,
        ns: "forecast-frame",
      }),
    ),
    // Full-globe basemap base images (Blue Marble / topo / night). No metadata
    // collection — a bare key→bytes store keyed by texture id ("satellite" …),
    // written by the worker `basemap.refresh` job and read by /api/basemap/[id].
    basemapTextures: makeBlobStore(getBlobModel(conn, "BasemapTextureData"), {
      fs: blobFs,
      ns: "basemap",
    }),
    climateYears: makeClimateYearRepo(getClimateYearModel(conn)),
    cities: mongoCrud(getCityModel(conn)),
    cityWeather: makeCityWeatherRepo(getCityWeatherModel(conn)),
    alerts: makeAlertsRepo(getAlertModel(conn)),
    alertRevisions: makeAlertRevisionRepo(getAlertRevisionModel(conn)),
    alertSeries: makeAlertSeriesRepo(getAlertSeriesModel(conn)),
    alertResources: makeAlertResourceRepo(getAlertResourceModel(conn)),
    alertSnapshots: makeAlertSnapshotRepo(getAlertSnapshotModel(conn), blobs.alertSnapshot),
    // Unified cross-source event layer (WatchedEvent dossier).
    watchedEvents: makeWatchedEventRepo(getWatchedEventModel(conn)),
    eventSources: makeEventSourceRepo(getEventSourceModel(conn)),
    eventSourceRevisions: makeEventSourceRevisionRepo(getEventSourceRevisionModel(conn)),
    eventTimeline: makeEventTimelineUpdateRepo(getEventTimelineUpdateModel(conn)),
    eventLinks: makeEventExternalLinkRepo(getEventExternalLinkModel(conn)),
    eventResources: makeEventResourceRepo(getEventResourceModel(conn)),
    eventSeries: makeEventSeriesRepo(getEventSeriesModel(conn)),
    eventSnapshots: makeEventSnapshotRepo(getEventSnapshotModel(conn), blobs.eventSnapshot),
    eventWatch: makeEventWatchScheduleRepo(getEventWatchScheduleModel(conn)),
    satelliteTles: makeSatelliteTleRepo(getSatelliteTleModel(conn)),
    trackSnapshots: makeTrackSnapshotRepo(getTrackSnapshotModel(conn)),
    quakes: makeQuakeRepo(getQuakeModel(conn)),
    // The permanent seismic record. `quakes` carries a 31-day TTL, so without
    // this every earthquake older than a month was simply gone.
    quakeArchive: makeQuakeArchiveRepo(getQuakeArchiveModel(conn)),
    tideStations: makeTideStationRepo(getTideStationModel(conn)),
    tideSeries: makeTideSeriesRepo(getTideSeriesModel(conn)),
    seismoStations: makeSeismoStationRepo(getSeismoStationModel(conn)),
    seismoSeries: makeSeismoSeriesRepo(getSeismoSeriesModel(conn)),
    eventSummaries: makeEventSummaryRepo(getEventSummaryModel(conn)),
    countryRoundups: makePlaceRoundupRepo(getCountryRoundupModel(conn)),
    regionRoundups: makePlaceRoundupRepo(getRegionRoundupModel(conn)),
    roundupSettings: makeRoundupSettingsRepo(getRoundupSettingsModel(conn)),
    cables: makeCableRepo(getCableModel(conn), getCableLandingModel(conn)),
    faults: makeFaultRepo(getFaultModel(conn)),
    alertAreaGeom: makeAlertAreaGeomRepo(
      getAlertAreaGeomModel(conn),
      getAlertGeomSeenModel(conn),
      getAlertGeomCrawlModel(conn),
    ),
    adminAreaGeom: makeAdminAreaGeomRepo(getAdminAreaGeomModel(conn)),
    capIds: makeCapIdRepo(getCapIdModel(conn)),
    alertBlobs: makeAlertBlobRepo(getAlertBlobModel(conn)),
    aurora: makeAuroraRepo(getAuroraModel(conn), blobs.aurora),
    satimg: makeSatImgRepo(getSatImgModel(conn), blobs.satimg),
    fires: makeFireRepo(getFireModel(conn)),
    volcanoes: makeVolcanoRepo(getVolcanoModel(conn)),
    volcanoSourceLinks: makeVolcanoSourceLinkRepo(getVolcanoSourceLinkModel(conn)),
    volcanoEruptions: makeVolcanoEruptionRepo(getVolcanoEruptionModel(conn)),
    volcanoCameras: makeVolcanoCameraRepo(getVolcanoCameraModel(conn)),
    volcanoMedia: makeVolcanoMediaRepo(getVolcanoMediaModel(conn), blobs.volcanoMedia),
    volcanoMediaSources: makeVolcanoMediaSourceRepo(getVolcanoMediaSourceModel(conn)),
    countries: makeCountryRepo(getCountryModel(conn)),
    regions: makeRegionRepo(getRegionModel(conn)),
    areaWeatherReports: makeAreaWeatherReportRepo(getAreaWeatherReportModel(conn)),
    geomag: makeGeomagRepo(getGeomagModel(conn), blobs.geomag),
    cams: makeCamRepo(getCamModel(conn)),
    seaPoints: makeSeaPointRepo(getSeaPointModel(conn)),
    shortScripts: makeShortScriptRepo(getShortScriptModel(conn)),
    // Crossword channel (docs/crossword-mode-plan.md §9).
    crosswordConfig,
    crosswordPuzzles: makeCrosswordPuzzleRepo(getCrosswordPuzzleModel(conn)),
    crosswordGames: makeCrosswordGameRepo(getCrosswordGameModel(conn)),
    crosswordSolves: makeCrosswordSolveRepo(getCrosswordSolveModel(conn)),
    crosswordPlayers: makeCrosswordPlayerRepo(getCrosswordPlayerModel(conn)),
    crosswordBank: makeCrosswordBankRepo(conn),
    ads: makeAdRepo(getAdModel(conn), blobs.ad),
    adExposures: makeAdExposureRepo(getAdExposureModel(conn)),
    adminImages: makeAdminImageRepo(getAdminImageModel(conn), blobs.adminImage),
    adminEdits: makeAdminEditRepo(getAdminEditModel(conn)),
    aircraftMeta: mongoCrud<iAircraftMetaModel>(getAircraftMetaModel(conn)),
    vehicles: makeVehicleRepo(getVehicleModel(conn)),
    logs: mongoCrud(getLogModel(conn)),
    airLog: makeAirLogRepo(getAirRunModel(conn), getAirEntryModel(conn)),
    chatLog: makeChatLogRepo(getChatLogMessageModel(conn)),
    directorCommands: makeDirectorCommandRepo(getDirectorCommandModel(conn)),
    viewerState: makeViewerStateRepo(getViewerStateModel(conn)),
    users: makeUserRepo(getUserModel(conn)),
    broadcastState,
    directorConfig,
    streamRuns,
    youtubeAccounts,

    /** Latest published run (the one the browser should render), or null. */
    async latestPublishedRun() {
      const res = await weatherRuns.getAll(
        { published: true },
        { sort: { run: -1 }, limit: 1 },
      );
      return res.success && res.data && res.data.length ? res.data[0] : null;
    },

    /**
     * Latest published run for ONE model, or null. The GFS `check` job needs
     * this (not `latestPublishedRun`): the multi-supplier fleet (ifs/rtofs/
     * mrms…) publishes newer runs continuously, so the GLOBAL latest is almost
     * always some other model — comparing GFS availability against it made the
     * GFS ingest (and thus the forecast archive it feeds) never re-run.
     */
    async latestPublishedRunForModel(model: string) {
      const res = await weatherRuns.getAll(
        { published: true, model },
        { sort: { run: -1 }, limit: 1 },
      );
      return res.success && res.data && res.data.length ? res.data[0] : null;
    },

    /**
     * Latest published run PER model — the multi-supplier portfolio. Walks all
     * published runs newest-first and keeps the first (newest) seen for each
     * model, so the manifest route can compose one manifest per variable across
     * gfs/ifs/rtofs/gfswave-mosaic. Retention keeps only a few runs per model.
     */
    async latestPublishedRunsByModel() {
      // Tiebreak by generatedAt so that when a run is RE-baked for the same cycle
      // time (e.g. after a descriptor bbox correction), the newest bake wins over
      // the stale duplicate rather than losing an undefined same-`run` tie.
      const res = await weatherRuns.getAll({ published: true }, { sort: { run: -1, generatedAt: -1 } });
      const rows = res.success && res.data ? res.data : [];
      const byModel = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!byModel.has(r.model)) byModel.set(r.model, r);
      return [...byModel.values()];
    },

    /**
     * Backfills `watchToken` onto scene docs created before the field existed.
     * The schema `default` only populates on insert, not on pre-existing rows.
     */
    async ensureWatchToken(doc: any) {
      if (!doc || doc.watchToken) return doc;
      const watchToken = randomBytes(24).toString("hex");
      const updated = await broadcastState.updateByID(doc.id, { watchToken } as any);
      return updated.data ?? { ...doc, watchToken };
    },

    /** The singleton broadcast state, seeded with defaults if absent. */
    async getOrInitBroadcastState() {
      const existing = await broadcastState.getByID(BROADCAST_STATE_ID);
      if (existing.success && existing.data) return this.ensureWatchToken(existing.data);
      const created = await broadcastState.upsertByID(BROADCAST_STATE_ID, {
        ...DEFAULT_CONTROL_STATE,
        name: "Main",
      } as any);
      return created.data ?? null;
    },

    /**
     * Director config for one scene (one doc per scene id), seeded if absent.
     * Per-scene so any scene can be auto-piloted while others stay manual.
     */
    async getOrInitDirectorConfig(sceneId: string) {
      const existing = await directorConfig.getByID(sceneId);
      if (existing.success && existing.data) {
        return mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, existing.data as any);
      }
      await directorConfig.upsertByID(sceneId, { ...DEFAULT_DIRECTOR_CONFIG } as any);
      return { ...DEFAULT_DIRECTOR_CONFIG };
    },

    /** Persist a merged director-config patch for a scene; returns the merged config. */
    async saveDirectorConfig(sceneId: string, patch: Record<string, unknown>) {
      const current = await this.getOrInitDirectorConfig(sceneId);
      const merged = mergeDirectorConfig(current, patch as any);
      await directorConfig.upsertByID(sceneId, merged as any);
      return merged;
    },

    /**
     * Remove a scene's director-config doc (scene-deletion cleanup). The main
     * scene's config is protected like the scene doc itself.
     */
    async deleteDirectorConfig(sceneId: string) {
      if (sceneId === MAIN_SCENE_ID) return false;
      const res = await directorConfig.deleteByID(sceneId);
      return !!res.success;
    },

    /** A scene's crossword config merged over the defaults (not persisted until saved). */
    async getOrInitCrosswordConfig(sceneId: string): Promise<CrosswordConfig> {
      const existing = await crosswordConfig.getByID(sceneId);
      return mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, existing.success && existing.data ? (existing.data as any) : null);
    },

    /** Persist a merged crossword-config patch for a scene; returns the merged config. */
    async saveCrosswordConfig(sceneId: string, patch: Record<string, unknown>): Promise<CrosswordConfig> {
      const merged = mergeCrosswordConfig(await this.getOrInitCrosswordConfig(sceneId), patch as any);
      await crosswordConfig.upsertByID(sceneId, merged as any);
      return merged;
    },

    /** Remove a scene's crossword config and game (scene-deletion cleanup). */
    async deleteCrosswordScene(sceneId: string): Promise<void> {
      await crosswordConfig.deleteByID(sceneId);
      await this.crosswordGames.remove(sceneId);
    },

    /** Ids of scenes whose surface is "crossword". */
    async crosswordScenes(): Promise<string[]> {
      const res = await broadcastState.getAll({ surface: "crossword" } as any, { limit: 0 });
      const rows = (res.success && res.data ? res.data : []) as { id: string }[];
      return rows.map((r) => r.id);
    },

    /** Scene ids that currently have the director set to "auto". */
    async autoDirectorScenes(): Promise<string[]> {
      const res = await directorConfig.getAll({ mode: "auto" }, { limit: 0 });
      const rows = (res.success && res.data ? res.data : []) as { id: string }[];
      return rows.map((r) => r.id);
    },

    /** Scene ids that currently have the director playing a script ("script" mode). */
    async scriptDirectorScenes(): Promise<string[]> {
      const res = await directorConfig.getAll({ mode: "script" }, { limit: 0 });
      const rows = (res.success && res.data ? res.data : []) as { id: string }[];
      return rows.map((r) => r.id);
    },

    /**
     * All broadcast scenes (the "default" main scene + named ones), as SceneMeta
     * `{ id, name, updatedAt, watchToken, hidden, surface }` sorted with main first then
     * by name. Hidden scenes ARE listed (admin pickers need them); viewer-facing
     * lists filter on `hidden`.
     */
    async listScenes() {
      const res = await broadcastState.getAll({}, { sort: { name: 1 } });
      const docs = (res.success && res.data) || [];
      return docs
        .map((d: any) => ({
          id: d.id as string,
          name: (d.name as string) || (d.id === MAIN_SCENE_ID ? "Main" : d.id),
          updatedAt: d.updated ?? d.updatedAt,
          watchToken: d.watchToken as string | undefined,
          hidden: d.hidden === true,
          surface: sceneSurface(d),
        }))
        .sort((a: { id: string; name: string }, b: { id: string; name: string }) =>
          a.id === MAIN_SCENE_ID ? -1 : b.id === MAIN_SCENE_ID ? 1 : a.name.localeCompare(b.name),
        );
    },

    /** A single scene doc by id, or null if it doesn't exist. */
    async getScene(id: string) {
      const res = await broadcastState.getByID(id);
      return res.success && res.data ? this.ensureWatchToken(res.data) : null;
    },

    /** Rotates a scene's watch token, invalidating any previously-issued URL. */
    async rotateSceneToken(id: string): Promise<string | null> {
      const doc = id === MAIN_SCENE_ID ? await this.getOrInitBroadcastState() : await this.getScene(id);
      if (!doc) return null;
      const watchToken = randomBytes(24).toString("hex");
      await broadcastState.updateByID(id, { watchToken } as any);
      return watchToken;
    },

    /**
     * Create a named scene seeded from `seed` (defaults to the main scene's
     * current state, falling back to DEFAULT_CONTROL_STATE). No-op overwrite if
     * the id already exists is prevented by the caller checking getScene first.
     * `opts.hidden` sets the scene metadata flag; left out, an existing scene
     * keeps its flag and a new one is visible.
     */
    async createScene(
      id: string,
      name: string,
      seed?: Partial<typeof DEFAULT_CONTROL_STATE>,
      opts: { hidden?: boolean; surface?: SceneSurface } = {},
    ) {
      const base = seed ?? DEFAULT_CONTROL_STATE;
      const created = await broadcastState.upsertByID(id, {
        ...DEFAULT_CONTROL_STATE,
        ...base,
        name,
        ...(typeof opts.hidden === "boolean" ? { hidden: opts.hidden } : {}),
        ...(isSceneSurface(opts.surface) ? { surface: opts.surface } : {}),
      } as any);
      return created.data ?? null;
    },

    /**
     * Set a scene's `hidden` metadata flag (off viewer-facing lists) without
     * touching its look. Returns false for an unknown scene.
     */
    async setSceneHidden(id: string, hidden: boolean): Promise<boolean> {
      if (!(await this.getScene(id))) return false;
      const res = await broadcastState.updateByID(id, { hidden } as any);
      return !!res.success;
    },

    /** Delete a named scene. The "default" main scene is protected (returns false). */
    async deleteScene(id: string) {
      if (id === MAIN_SCENE_ID) return false;
      const res = await broadcastState.deleteByID(id);
      return !!res.success;
    },

    // ---- Streaming runs (bounded live broadcasts bound to a scene) ----

    /** Create a run (status seeded by the schema default `scheduled`). Returns the doc. */
    async createRun(input: Partial<Run>) {
      const res = await streamRuns.create(input as any);
      return res.data ?? null;
    },

    /** A run by id, or null. */
    async getRun(id: string) {
      const res = await streamRuns.getByID(id);
      return res.success && res.data ? (res.data as Run) : null;
    },

    /** The run behind a YouTube video id (its broadcast id), or null — the public /vod page's lookup. */
    async getRunByBroadcastId(broadcastId: string) {
      const res = await streamRuns.getAll({ "platforms.youtube.broadcastId": broadcastId } as any, { limit: 1 });
      const row = res.success && res.data ? res.data[0] : undefined;
      return row ? (row as Run) : null;
    },

    /** Patch a run by id; returns the updated doc. */
    async updateRun(id: string, patch: Partial<Run>) {
      const res = await streamRuns.updateByID(id, patch as any);
      return res.data ? (res.data as Run) : null;
    },

    /**
     * Runs, newest-first. Filter by `sceneId` and/or `status` (array = $in). Used by
     * the /admin/streams fleet list and the worker boot reconciler.
     */
    async listRuns(filter: { sceneId?: string; status?: Run["status"] | Run["status"][] } = {}) {
      const q: Record<string, unknown> = {};
      if (filter.sceneId) q.sceneId = filter.sceneId;
      if (filter.status) q.status = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
      const res = await streamRuns.getAll(q as any, { sort: { created: -1 } });
      return (res.success && res.data ? res.data : []) as Run[];
    },

    /** The run that currently OWNS a scene (still in a running status), or null. */
    async activeRunForScene(sceneId: string) {
      const rows = await this.listRuns({ sceneId });
      return rows.find((r) => runIsActive(r.status)) ?? null;
    },

    /**
     * The active PUBLISHING run occupying an encoder, or null. Legacy runs with
     * no encoderId collapse onto the env encoder key (see encoderKeyForRun) —
     * this is the one-output-per-OBS-instance guard, now scoped per encoder.
     */
    async activeRunForEncoder(encoderId: string, excludeRunId?: string) {
      const rows = await this.listRuns({ status: ["scheduled", "awaiting-ingest", "live", "ending"] });
      return (
        rows.find(
          (r) =>
            r.id !== excludeRunId && !!r.platforms?.youtube && encoderKeyForRun(r) === (encoderId || "env"),
        ) ?? null
      );
    },

    // ---- Stream encoders (registered OBS instances — one output each) ----

    /** All registered encoders (admin list; pass onlyEnabled for pickers). */
    async listStreamEncoders(onlyEnabled = false) {
      const res = await streamEncoders.getAll(onlyEnabled ? { enabled: true } : {}, { sort: { id: 1 } });
      return (res.success && res.data ? res.data : []) as StreamEncoder[];
    },

    /** An encoder by id, or null. */
    async getStreamEncoder(id: string) {
      const res = await streamEncoders.getByID(id);
      return res.success && res.data ? (res.data as StreamEncoder) : null;
    },

    /** The enabled encoder whose OBS instance captures this scene, or null. */
    async encoderForScene(sceneId: string) {
      const res = await streamEncoders.getAll({ sceneId, enabled: true }, { sort: { id: 1 }, limit: 1 });
      return res.success && res.data && res.data.length ? (res.data[0] as StreamEncoder) : null;
    },

    /** Insert-or-update an encoder by id. */
    async saveStreamEncoder(patch: Partial<StreamEncoder> & { id: string }) {
      const res = await streamEncoders.upsertByID(patch.id, patch as any);
      return res.data ? (res.data as StreamEncoder) : null;
    },

    /** Remove an encoder registration (does not touch the OBS instance itself). */
    async deleteStreamEncoder(id: string) {
      const res = await streamEncoders.deleteByID(id);
      return !!res.success;
    },

    // ---- Stream slots (desired-state persistent streams) ----

    /** All persistent-stream slots (admin list + the worker reconciler sweep). */
    async listStreamSlots() {
      const res = await streamSlots.getAll({}, { sort: { id: 1 } });
      return (res.success && res.data ? res.data : []) as StreamSlot[];
    },

    /** A slot by id, or null. */
    async getStreamSlot(id: string) {
      const res = await streamSlots.getByID(id);
      return res.success && res.data ? (res.data as StreamSlot) : null;
    },

    /** The slot a run is serving (by the slot's runId pointer), or null. */
    async slotForRun(runId: string) {
      const res = await streamSlots.getAll({ runId }, { limit: 1 });
      return res.success && res.data && res.data.length ? (res.data[0] as StreamSlot) : null;
    },

    /** Insert-or-update a slot by id. */
    async saveStreamSlot(patch: Partial<StreamSlot> & { id: string }) {
      const res = await streamSlots.upsertByID(patch.id, patch as any);
      return res.data ? (res.data as StreamSlot) : null;
    },

    /** Remove a slot (any run it started keeps running until stopped). */
    async deleteStreamSlot(id: string) {
      const res = await streamSlots.deleteByID(id);
      return !!res.success;
    },

    // ---- Connected YouTube channels (OAuth) ----

    /**
     * A connected YouTube account. With an id → that channel; without → the most
     * recently connected one (the de-facto default for single-channel setups).
     */
    async getYoutubeAccount(id?: string) {
      if (id) {
        const res = await youtubeAccounts.getByID(id);
        return res.success && res.data ? (res.data as iYoutubeAccountModel) : null;
      }
      const res = await youtubeAccounts.getAll({}, { sort: { connectedAt: -1 }, limit: 1 });
      return res.success && res.data && res.data.length ? (res.data[0] as iYoutubeAccountModel) : null;
    },

    /** All connected YouTube channels (admin list). */
    async listYoutubeAccounts() {
      const res = await youtubeAccounts.getAll({}, { sort: { connectedAt: -1 } });
      return (res.success && res.data ? res.data : []) as iYoutubeAccountModel[];
    },

    /** Insert-or-update a connected channel by channelId. */
    async saveYoutubeAccount(patch: Partial<iYoutubeAccountModel> & { id: string }) {
      const res = await youtubeAccounts.upsertByID(patch.id, patch as any);
      return res.data ? (res.data as iYoutubeAccountModel) : null;
    },

    /** Disconnect a channel (removes its stored refresh token). */
    async deleteYoutubeAccount(id: string) {
      const res = await youtubeAccounts.deleteByID(id);
      return !!res.success;
    },
  };
}

export type AppDb = ReturnType<typeof createDb>;

/** Convenience: open (or reuse) the single connection and build the DB facade. */
export async function getAppDb(): Promise<AppDb> {
  const conn = await getDb();
  return createDb(conn);
}
