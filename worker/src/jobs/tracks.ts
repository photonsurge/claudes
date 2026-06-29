import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchGroupTle } from "@photonsurge/shared/tracks/celestrak";
import { parseTle } from "@photonsurge/shared/tracks/tle";
import { fetchAdsb } from "@photonsurge/shared/tracks/adsb";
import { collectShips } from "@photonsurge/shared/tracks/aisstream";
import type { iTrackSnapshot } from "@photonsurge/shared/db/track-snapshot-model";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";

const TAG = "job:tracks";

interface SnapshotRegion {
  id: string;
  bbox: [number, number, number, number];
}

/** Regions to snapshot (env JSON override). [w,s,e,n]. */
export const snapshotRegions = (): SnapshotRegion[] => {
  const raw = process.env.SNAPSHOT_REGIONS;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through to default */
    }
  }
  return [{ id: "uk-eire", bbox: [-11, 49, 2, 61] }];
};

/** Groups to keep fresh in Mongo (env override, comma-separated). */
export const tleGroups = (): string[] =>
  (process.env.SATELLITE_GROUPS || "visual,stations,starlink")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Dispatched as type "tracks", event "ingestTles". Fetches each Celestrak group
 * and upserts its TLEs into Mongo (dedup on noradId, union of groups). The app
 * then propagates positions off the DB copy instead of hitting Celestrak live.
 */
export async function ingestTles(job: Job) {
  const groups: string[] = job.data?.data?.groups ?? tleGroups();
  const db = await getAppDb();

  const results: unknown[] = [];
  for (const group of groups) {
    try {
      const tles = parseTle(await fetchGroupTle(group));
      const r = await db.satelliteTles.upsertMany(tles, group);
      results.push({ group, parsed: tles.length, ...r });
    } catch (err) {
      log(TAG, `group failed`, { group, err: summarizeForLog(err) });
      results.push({ group, error: String(err) });
    }
  }

  log(TAG, `ingestTles done`, { jobId: job.id, groups: results.length });
  return { results };
}

/**
 * Dispatched as type "tracks", event "snapshot". Records ONE frame of observed
 * aircraft + ship positions (per configured region) into Mongo for replay. All
 * rows share `batchAt`. Satellites are excluded — their history is reconstructed
 * by propagating stored TLEs, not snapshotted. Ships need AISSTREAM_API_KEY.
 */
export async function snapshot(job: Job) {
  const db = await getAppDb();
  const batchAt = new Date();
  const aisKey = process.env.AISSTREAM_API_KEY;

  const aircraft = new Map<string, iTrackSnapshot>();
  const ships = new Map<string, iTrackSnapshot>();

  for (const region of snapshotRegions()) {
    try {
      for (const a of await fetchAdsb(region.bbox)) {
        if (!a.icao24) continue;
        aircraft.set(a.icao24, {
          kind: "aircraft",
          externalId: a.icao24,
          name: a.callsign,
          lng: a.lng,
          lat: a.lat,
          altM: a.altM,
          headingDeg: a.headingDeg,
          speed: a.velocityMS,
          region: region.id,
          batchAt,
        });
      }
    } catch (err) {
      log(TAG, `snapshot aircraft failed`, { region: region.id, err: summarizeForLog(err) });
    }

    if (aisKey) {
      try {
        for (const s of await collectShips(aisKey, region.bbox, 4000)) {
          ships.set(s.mmsi, {
            kind: "ship",
            externalId: s.mmsi,
            name: s.name,
            lng: s.lng,
            lat: s.lat,
            headingDeg: s.headingDeg ?? s.cogDeg,
            speed: s.sogKn,
            region: region.id,
            batchAt,
          });
        }
      } catch (err) {
        log(TAG, `snapshot ships failed`, { region: region.id, err: summarizeForLog(err) });
      }
    }
  }

  const recorded = await db.trackSnapshots.record([...aircraft.values(), ...ships.values()]);
  const result = {
    batchAt: batchAt.toISOString(),
    aircraft: aircraft.size,
    ships: ships.size,
    recorded,
  };
  log(TAG, `snapshot done`, result);
  return result;
}
