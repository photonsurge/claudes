import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchGroupTle } from "@photonsurge/shared/tracks/celestrak";
import { parseTle } from "@photonsurge/shared/tracks/tle";
import { fetchAdsb } from "@photonsurge/shared/tracks/adsb";
import { fetchAircraft } from "@photonsurge/shared/tracks/opensky";
import { collectShips } from "@photonsurge/shared/tracks/aisstream";
import { fetchQuakes, DEFAULT_USGS_FEED } from "@photonsurge/shared/tracks/usgs";
import type { iTrackSnapshot } from "@photonsurge/shared/db/track-snapshot-model";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:tracks";

/**
 * Reject placeholder/garbage external ids at the source: empty, or all-zeros
 * (e.g. AIS MMSI "0"/"000000000", ADS-B "000000") which many craft share — left
 * in, they merge into one track and draw lines teleporting across the globe.
 * Keeps valid hex ICAO24s like "00abcd" (only all-zeros is junk).
 */
const validTrackId = (id: string | undefined): id is string => !!id && !/^0+$/.test(id);

interface SnapshotRegion {
  id: string;
  bbox: [number, number, number, number];
}

/**
 * Regions to snapshot (env JSON override). [w,s,e,n]. Keep each region within
 * ~250nm radius — adsb.lol is point+radius and clamps beyond that, so a larger
 * box would miss aircraft at its edges. A few busy areas by default.
 */
export const snapshotRegions = (): SnapshotRegion[] => {
  const raw = process.env.SNAPSHOT_REGIONS;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through to default */
    }
  }
  return [
    { id: "uk-eire", bbox: [-8, 50, 2, 56] },
    { id: "nw-europe", bbox: [3, 48, 11, 53] },
    { id: "us-northeast", bbox: [-77, 38, -70, 42] },
  ];
};

/** Whole-world bbox [w,s,e,n] for global coverage. */
const GLOBAL_BBOX: [number, number, number, number] = [-180, -90, 180, 90];

/**
 * AIS coverage. Default GLOBAL (one aisstream firehose subscription) — set
 * SHIP_BBOXES to a JSON array of [w,s,e,n] to scope it instead. Decoupled from
 * the aircraft regions because aisstream takes one worldwide box but adsb can't.
 */
const shipBoxes = (): [number, number, number, number][] => {
  const raw = process.env.SHIP_BBOXES;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through to global */
    }
  }
  return [GLOBAL_BBOX];
};

/**
 * AIS collection window per ship snapshot. Vessels only transmit every few–30s,
 * so the count scales ~linearly with the window — measured global: 10s≈950,
 * 30s≈2.5k, 60s≈5.1k (~85 vessels/s, no throttling). It's off the request path
 * (worker job), so latency is free — keep it under the snapshot interval
 * (SHIP_SNAPSHOT_MS, 120s). Raise SHIP_COLLECT_MS toward ~100s for ~8–9k.
 */
const SHIP_COLLECT_MS = Number(process.env.SHIP_COLLECT_MS || 60_000);

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
      blogInfo(TAG, `TLEs ${group}: ${tles.length} parsed (+${r.upserted} new)`, { group, parsed: tles.length, ...r }, "tracks", group);
    } catch (err) {
      log(TAG, `group failed`, { group, err: summarizeForLog(err) });
      blogErr(TAG, `TLE ingest failed: ${group}`, err, "tracks", group);
      results.push({ group, error: String(err) });
    }
  }

  log(TAG, `ingestTles done`, { jobId: job.id, groups: results.length });
  return { results };
}

/**
 * Dispatched as type "tracks", event "snapshotAircraft". Records ONE frame of
 * observed aircraft (one adsb.lol point+radius call per region) into Mongo. The
 * newest frame is the live cache the public route reads; the client dead-reckons
 * positions forward from `batchAt` using heading + speed, so a slow poll still
 * looks alive. All rows share `batchAt` (also the replay frame).
 */
export async function snapshotAircraft(_job: Job) {
  const db = await getAppDb();
  const batchAt = new Date();
  const aircraft = new Map<string, iTrackSnapshot>();

  const put = (a: { icao24: string; callsign?: string; lng: number; lat: number; altM?: number; headingDeg?: number; velocityMS?: number }, region?: string) => {
    if (!validTrackId(a.icao24)) return;
    aircraft.set(a.icao24, {
      kind: "aircraft",
      externalId: a.icao24,
      name: a.callsign,
      lng: a.lng,
      lat: a.lat,
      altM: a.altM,
      headingDeg: a.headingDeg,
      speed: a.velocityMS,
      region,
      batchAt,
    });
  };

  // Global: OpenSky /states/all in one call (worldwide). adsb.lol is point+radius
  // so it can't go global — it stays per-region. Set AIRCRAFT_PROVIDER=opensky
  // (+ OPENSKY_CLIENT_ID/SECRET for the poll rate) for global coverage.
  if (process.env.AIRCRAFT_PROVIDER === "opensky") {
    try {
      for (const a of await fetchAircraft()) put(a, "global");
    } catch (err) {
      log(TAG, `snapshotAircraft global (opensky) failed`, { err: summarizeForLog(err) });
      blogErr(TAG, `aircraft snapshot (opensky global) failed`, err, "tracks", "aircraft");
    }
  } else {
    for (const region of snapshotRegions()) {
      try {
        for (const a of await fetchAdsb(region.bbox)) put(a, region.id);
      } catch (err) {
        log(TAG, `snapshotAircraft region failed`, { region: region.id, err: summarizeForLog(err) });
        blogErr(TAG, `aircraft snapshot region failed: ${region.id}`, err, "tracks", region.id);
      }
    }
  }

  const recorded = await db.trackSnapshots.record([...aircraft.values()]);
  const result = { batchAt: batchAt.toISOString(), aircraft: aircraft.size, recorded };
  log(TAG, `snapshotAircraft done`, result);
  blogInfo(TAG, `aircraft snapshot: ${aircraft.size} tracks (${recorded} recorded)`, result, "tracks", "aircraft");
  // Live-push so browsers refresh the frame the instant it lands (no polling lag).
  if (recorded > 0) {
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "aircraft", batchAt: batchAt.toISOString(), count: recorded } });
  }
  return result;
}

/**
 * Dispatched as type "tracks", event "snapshotShips". Records ONE frame of AIS
 * vessel positions across all regions (one aisstream connection subscribed to
 * every region's bbox). Needs AISSTREAM_API_KEY; no-ops without it.
 */
export async function snapshotShips(_job: Job) {
  const aisKey = process.env.AISSTREAM_API_KEY;
  if (!aisKey) {
    log(TAG, `snapshotShips skipped — no AISSTREAM_API_KEY`);
    blogInfo(TAG, `ship snapshot skipped — no AISSTREAM_API_KEY`, {}, "tracks", "ships");
    return { ships: 0, recorded: 0, skipped: true };
  }

  const db = await getAppDb();
  const batchAt = new Date();
  const ships = new Map<string, iTrackSnapshot>();
  const boxes = shipBoxes();

  try {
    for (const s of await collectShips(aisKey, boxes, SHIP_COLLECT_MS)) {
      if (!validTrackId(s.mmsi)) continue;
      ships.set(s.mmsi, {
        kind: "ship",
        externalId: s.mmsi,
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        headingDeg: s.headingDeg ?? s.cogDeg,
        speed: s.sogKn,
        batchAt,
      });
    }
  } catch (err) {
    log(TAG, `snapshotShips failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `ship snapshot failed`, err, "tracks", "ships");
  }

  const recorded = await db.trackSnapshots.record([...ships.values()]);
  const result = { batchAt: batchAt.toISOString(), ships: ships.size, recorded };
  log(TAG, `snapshotShips done`, result);
  blogInfo(TAG, `ship snapshot: ${ships.size} vessels (${recorded} recorded)`, result, "tracks", "ships");
  if (recorded > 0) {
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "ship", batchAt: batchAt.toISOString(), count: recorded } });
  }
  return result;
}

/**
 * Dispatched as type "tracks", event "snapshotSeismic". Fetches one USGS feed
 * (default M2.5+ past day) and upserts the events into Mongo on their USGS id —
 * re-polling refreshes magnitudes/depths without duplicating. The public route
 * reads only this cached copy. Set USGS_FEED to widen/narrow coverage.
 */
export async function snapshotSeismic(job: Job) {
  const feed: string = job.data?.data?.feed ?? process.env.USGS_FEED ?? DEFAULT_USGS_FEED;
  const db = await getAppDb();

  try {
    const quakes = await fetchQuakes(feed);
    const r = await db.quakes.upsertMany(quakes);
    const result = { feed, fetched: quakes.length, ...r };
    log(TAG, `snapshotSeismic done`, result);
    blogInfo(TAG, `seismic snapshot: ${quakes.length} quakes (+${r.upserted} new)`, result, "tracks", "seismic");
    return result;
  } catch (err) {
    log(TAG, `snapshotSeismic failed`, { feed, err: summarizeForLog(err) });
    blogErr(TAG, `seismic snapshot failed`, err, "tracks", "seismic");
    throw err;
  }
}

/** Combined one-shot used by the manual `yarn snapshot:tracks` script. */
export async function snapshot(job: Job) {
  const [aircraft, ships] = await Promise.all([snapshotAircraft(job), snapshotShips(job)]);
  return { aircraft, ships };
}
