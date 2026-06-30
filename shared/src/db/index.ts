import type { Connection } from "mongoose";
import { getDb } from "../utill/mongoose";
import { iEntity, makeCollection } from "./generic";
import { mongoCrud } from "./mongoose-generic";
import { getWeatherRunModel, iWeatherRunModel } from "./weather-run-model";
import { getWeatherTextureModel } from "./weather-texture-model";
import { getCityModel } from "./city-model";
import { getAlertModel } from "./alert-model";
import { makeAlertsRepo } from "./alerts-repo";
import { getSatelliteTleModel } from "./satellite-tle-model";
import { makeSatelliteTleRepo } from "./satellite-tle-repo";
import { getTrackSnapshotModel } from "./track-snapshot-model";
import { makeTrackSnapshotRepo } from "./track-snapshot-repo";
import { getQuakeModel } from "./quake-model";
import { makeQuakeRepo } from "./quake-repo";
import { getCamModel } from "./cam-model";
import { makeCamRepo } from "./cam-repo";
import { getAircraftMetaModel, iAircraftMetaModel } from "./aircraft-meta-model";
import { getLogModel } from "./log-model";
import { getBroadcastStateModel, BROADCAST_STATE_ID } from "./broadcast-state-model";
import { getDirectorConfigModel } from "./director-config-model";
import { DEFAULT_CONTROL_STATE, MAIN_SCENE_ID } from "../control";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig } from "../director";

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
export function createDb(conn: Connection) {
  const weatherRuns = mongoCrud<iWeatherRunModel>(getWeatherRunModel(conn));
  const broadcastState = mongoCrud(getBroadcastStateModel(conn));
  const directorConfig = mongoCrud(getDirectorConfigModel(conn));

  return {
    conn,
    pings: makeCollection<iPing>(conn, "pings"),
    weatherRuns,
    weatherTextures: mongoCrud(getWeatherTextureModel(conn)),
    cities: mongoCrud(getCityModel(conn)),
    alerts: makeAlertsRepo(getAlertModel(conn)),
    satelliteTles: makeSatelliteTleRepo(getSatelliteTleModel(conn)),
    trackSnapshots: makeTrackSnapshotRepo(getTrackSnapshotModel(conn)),
    quakes: makeQuakeRepo(getQuakeModel(conn)),
    cams: makeCamRepo(getCamModel(conn)),
    aircraftMeta: mongoCrud<iAircraftMetaModel>(getAircraftMetaModel(conn)),
    logs: mongoCrud(getLogModel(conn)),
    broadcastState,
    directorConfig,

    /** Latest published run (the one the browser should render), or null. */
    async latestPublishedRun() {
      const res = await weatherRuns.getAll(
        { published: true },
        { sort: { run: -1 }, limit: 1 },
      );
      return res.success && res.data && res.data.length ? res.data[0] : null;
    },

    /** The singleton broadcast state, seeded with defaults if absent. */
    async getOrInitBroadcastState() {
      const existing = await broadcastState.getByID(BROADCAST_STATE_ID);
      if (existing.success && existing.data) return existing.data;
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

    /** Scene ids that currently have the director set to "auto". */
    async autoDirectorScenes(): Promise<string[]> {
      const res = await directorConfig.getAll({ mode: "auto" }, { limit: 0 });
      const rows = (res.success && res.data ? res.data : []) as { id: string }[];
      return rows.map((r) => r.id);
    },

    /**
     * All broadcast scenes (the "default" main scene + named ones), as `{ id,
     * name, updatedAt }` metadata sorted with main first then by name.
     */
    async listScenes() {
      const res = await broadcastState.getAll({}, { sort: { name: 1 } });
      const docs = (res.success && res.data) || [];
      return docs
        .map((d: any) => ({
          id: d.id as string,
          name: (d.name as string) || (d.id === MAIN_SCENE_ID ? "Main" : d.id),
          updatedAt: d.updated ?? d.updatedAt,
        }))
        .sort((a: { id: string; name: string }, b: { id: string; name: string }) =>
          a.id === MAIN_SCENE_ID ? -1 : b.id === MAIN_SCENE_ID ? 1 : a.name.localeCompare(b.name),
        );
    },

    /** A single scene doc by id, or null if it doesn't exist. */
    async getScene(id: string) {
      const res = await broadcastState.getByID(id);
      return res.success && res.data ? res.data : null;
    },

    /**
     * Create a named scene seeded from `seed` (defaults to the main scene's
     * current state, falling back to DEFAULT_CONTROL_STATE). No-op overwrite if
     * the id already exists is prevented by the caller checking getScene first.
     */
    async createScene(id: string, name: string, seed?: Partial<typeof DEFAULT_CONTROL_STATE>) {
      const base = seed ?? DEFAULT_CONTROL_STATE;
      const created = await broadcastState.upsertByID(id, {
        ...DEFAULT_CONTROL_STATE,
        ...base,
        name,
      } as any);
      return created.data ?? null;
    },

    /** Delete a named scene. The "default" main scene is protected (returns false). */
    async deleteScene(id: string) {
      if (id === MAIN_SCENE_ID) return false;
      const res = await broadcastState.deleteByID(id);
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
