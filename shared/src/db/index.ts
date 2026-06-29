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
import { getAircraftMetaModel, iAircraftMetaModel } from "./aircraft-meta-model";
import { getLogModel } from "./log-model";
import { getBroadcastStateModel, BROADCAST_STATE_ID } from "./broadcast-state-model";
import { DEFAULT_CONTROL_STATE } from "../control";

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
    aircraftMeta: mongoCrud<iAircraftMetaModel>(getAircraftMetaModel(conn)),
    logs: mongoCrud(getLogModel(conn)),
    broadcastState,

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
      });
      return created.data ?? null;
    },
  };
}

export type AppDb = ReturnType<typeof createDb>;

/** Convenience: open (or reuse) the single connection and build the DB facade. */
export async function getAppDb(): Promise<AppDb> {
  const conn = await getDb();
  return createDb(conn);
}
