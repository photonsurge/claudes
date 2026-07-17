import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchGroupTle, fetchGroupSatcat, satcatToMeta } from "@photonsurge/shared/tracks/celestrak";
import { parseTle } from "@photonsurge/shared/tracks/tle";
import { fetchAdsb } from "@photonsurge/shared/tracks/adsb";
import { fetchAircraft } from "@photonsurge/shared/tracks/opensky";
import { collectShips } from "@photonsurge/shared/tracks/aisstream";
import { fetchQuakes, DEFAULT_USGS_FEED } from "@photonsurge/shared/tracks/usgs";
import { fetchAircraftMeta } from "@photonsurge/shared/tracks/hexdb";
import { mmsiCountry, countryNameFlag } from "@photonsurge/shared/tracks/flags";
import { vehicleId } from "@photonsurge/shared/db/vehicle-model";
import type { iTrackSnapshot } from "@photonsurge/shared/db/track-snapshot-model";
import type { AppDb } from "@photonsurge/shared/db/index";
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
 * 30s≈2.5k, 60s≈5.1k, then diminishing returns as the same vessels recur
 * (~15–20k by 5min). It's off the request path (worker job) so latency is free —
 * just keep it under the snapshot interval (SHIP_SNAPSHOT_MS). Default 300s for
 * near-full global coverage; raise SHIP_COLLECT_MS further (+ SHIP_SNAPSHOT_MS)
 * if you want the long tail. Trade-off: a longer window means some positions are
 * up to that many seconds old at snapshot time (dead-reckoned forward on view).
 */
const SHIP_COLLECT_MS = Number(process.env.SHIP_COLLECT_MS || 300_000);

/** Per-run cap + pacing for hexdb enrichment (keyless service — be gentle). */
const ENRICH_CAP = Number(process.env.AIRCRAFT_ENRICH_CAP || 150);
const ENRICH_DELAY_MS = Number(process.env.AIRCRAFT_ENRICH_DELAY_MS || 120);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatched as "tracks.enrichAircraft". Fills the AircraftMeta cache from
 * hexdb.io (keyless) for ICAO24s in the latest aircraft frame we haven't looked
 * up yet — registration / type / operator. Rate-limited + capped per run; cached
 * forever (incl. misses, so we don't re-hammer), so it fills progressively each
 * cycle. The aircraft route joins this onto the live snapshot.
 */
export async function enrichAircraft(_job: Job) {
  const db = await getAppDb();
  const { rows } = await db.trackSnapshots.latest({ kind: "aircraft" });
  if (!rows.length) return { enriched: 0, todo: 0 };

  const icaos = [...new Set(rows.map((r) => r.externalId.toLowerCase()))];
  const existing = await db.aircraftMeta.getAll({ id: { $in: icaos } }, { limit: icaos.length, sort: null });
  const known = new Set((existing.data ?? []).map((m) => m.id));
  const todo = icaos.filter((i) => !known.has(i)).slice(0, ENRICH_CAP);

  let enriched = 0;
  for (const hex of todo) {
    const meta = await fetchAircraftMeta(hex);
    await db.aircraftMeta.upsertByID(
      hex,
      meta
        ? { icao24: hex, ...meta, fetchedAt: Date.now(), notFound: false }
        : { icao24: hex, fetchedAt: Date.now(), notFound: true },
    );
    if (meta) enriched++;
    await sleep(ENRICH_DELAY_MS);
  }
  const result = { seen: icaos.length, cached: known.size, lookedUp: todo.length, enriched };
  log(TAG, `enrichAircraft done`, result);
  return result;
}

/**
 * Groups to keep fresh in Mongo (env override, comma-separated). Default is a
 * curated set of notable, individually-named craft — space stations, the
 * brightest objects, and the weather/environment/science fleets that fit the
 * globe. Deliberately excludes the broadband megaconstellations (starlink,
 * oneweb, kuiper, qianfan): they're thousands of near-identical satellites that
 * bury everything interesting. Add them to SATELLITE_GROUPS if you want them.
 */
export const tleGroups = (): string[] =>
  (process.env.SATELLITE_GROUPS ||
    "stations,visual,weather,goes,resource,science,geo,tdrss,sarsat,dmc,engineering,gps-ops,galileo")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Dispatched as type "tracks", event "ingestTles". Fetches each Celestrak group
 * and upserts its TLEs into Mongo (dedup on noradId, union of groups), then joins
 * SATCAT descriptive metadata (owner, launch, orbit) onto the stored objects. The
 * app propagates positions and reads the metadata off the DB copy instead of
 * hitting Celestrak live. SATCAT enrichment is best-effort — a failed catalog
 * pull never fails the TLE ingest.
 */
export async function ingestTles(job: Job) {
  const groups: string[] = job.data?.data?.groups ?? tleGroups();
  const db = await getAppDb();

  const results: unknown[] = [];
  for (const group of groups) {
    try {
      const tles = parseTle(await fetchGroupTle(group));
      const r = await db.satelliteTles.upsertMany(tles, group);

      // Best-effort SATCAT join — own try/catch so it never sinks the TLE ingest.
      // SATCAT metadata is static per object, so we only pull the catalog for a
      // group that still has un-enriched TLEs. Once enriched, every later run (and
      // every boot seed) skips records.php entirely — Celestrak blocks the IP for
      // over-querying that endpoint, and re-fetching changes nothing anyway.
      let enriched = 0;
      try {
        if ((await db.satelliteTles.countMissingMeta(group)) > 0) {
          const meta = (await fetchGroupSatcat(group)).map(satcatToMeta);
          ({ matched: enriched } = await db.satelliteTles.upsertSatcatMany(meta));
        }
      } catch (metaErr) {
        log(TAG, `satcat enrich failed`, { group, err: summarizeForLog(metaErr) });
      }

      results.push({ group, parsed: tles.length, ...r, enriched });
      blogInfo(TAG, `TLEs ${group}: ${tles.length} parsed (+${r.upserted} new, ${enriched} enriched)`, { group, parsed: tles.length, ...r, enriched }, "tracks", group);
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
/** Registry disabled? (defaults on). */
const REGISTRY_ENABLED = process.env.VEHICLE_REGISTRY_ENABLED !== "false";

/**
 * How often the FULL vehicle-registry refresh runs, per kind (ms). The globe /
 * broadcast read `trackSnapshots` (the live frame) — NOT this registry — so
 * refreshing lastSeen/timesSeen/last-position for EVERY craft is background
 * bookkeeping that only the admin registry table reads. At global AIS coverage
 * that's 10k+ upserts (~4.5s of Mongo write locks) on every ~6min ship snapshot,
 * which is wasteful. Between full refreshes we still persist the notable/on-air
 * craft every frame (a tiny set — keeps their lastSeen + trail breadcrumb live),
 * so nothing on air changes; only non-notable registry rows get a coarser
 * lastSeen (up to this many ms stale). Set 0 to refresh the whole registry every
 * snapshot (old behaviour). Read live (not a load-time const) so it can be tuned
 * or exercised in tests without a reload.
 */
const registryFullMs = (): number => Number(process.env.VEHICLE_REGISTRY_FULL_MS ?? 20 * 60_000);

/** Per-kind wall clock (ms) of the last full registry refresh (worker = 1 process). */
const lastFullRegistry: Record<string, number> = {};

/** Test hook: clear the full-refresh throttle so cadence tests start clean. */
export function __resetRegistryThrottle(): void {
  for (const k of Object.keys(lastFullRegistry)) delete lastFullRegistry[k];
}

/**
 * Is a full-registry refresh due for `kind` at frame time `at`? Records the tick
 * when it returns true. `VEHICLE_REGISTRY_FULL_MS=0` forces every frame full and
 * never records a tick, so it stays stateless.
 */
function fullRegistryDue(kind: string, at: Date): boolean {
  const every = registryFullMs();
  if (every <= 0) return true;
  const now = at.getTime();
  if (now - (lastFullRegistry[kind] ?? 0) >= every) {
    lastFullRegistry[kind] = now;
    return true;
  }
  return false;
}

/**
 * Upsert the persistent vehicle registry (db.vehicles) from a snapshot frame —
 * identity + lifecycle (firstSeen/lastSeen/timesSeen/last position), plus a trail
 * point for notable craft. On a full-refresh frame every craft is upserted; on
 * the frames in between only the notable/on-air craft are (see registryFullMs),
 * so the expensive whole-frame write runs at a coarse cadence while notable craft
 * stay live every frame. Best-effort: a registry hiccup never fails the snapshot.
 */
async function recordVehicleRegistry(db: AppDb, kind: "aircraft" | "ship", snaps: iTrackSnapshot[], at: Date) {
  if (!REGISTRY_ENABLED || !snaps.length) return;
  try {
    const trailIds = await db.vehicles.notableIds();
    const source = fullRegistryDue(kind, at)
      ? snaps
      : snaps.filter((s) => trailIds.has(vehicleId(kind, s.externalId)));
    if (!source.length) return;
    const rows = source.map((s) => {
      const ship = kind === "ship" ? mmsiCountry(s.externalId) : undefined;
      return {
        kind,
        code: s.externalId,
        name: s.name,
        country: kind === "ship" ? ship?.name : s.country,
        flag: kind === "ship" ? ship?.flag : countryNameFlag(s.country) || undefined,
        lng: s.lng,
        lat: s.lat,
      };
    });
    await db.vehicles.recordSightings(rows, { at, trailIds });
  } catch (err) {
    log(TAG, `vehicle registry upsert failed`, { kind, err: summarizeForLog(err) });
  }
}

export async function snapshotAircraft(_job: Job) {
  const db = await getAppDb();
  const batchAt = new Date();
  const aircraft = new Map<string, iTrackSnapshot>();

  const put = (a: { icao24: string; callsign?: string; country?: string; lng: number; lat: number; altM?: number; headingDeg?: number; velocityMS?: number; verticalRateMS?: number }, region?: string) => {
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
      country: a.country,
      verticalRateMS: a.verticalRateMS,
      region,
      batchAt,
    });
  };

  // Keyless adsb.lol fallback — point+radius, so per-region (a few busy areas).
  const collectRegions = async () => {
    for (const region of snapshotRegions()) {
      try {
        for (const a of await fetchAdsb(region.bbox)) put(a, region.id);
      } catch (err) {
        log(TAG, `snapshotAircraft region failed`, { region: region.id, err: summarizeForLog(err) });
        blogErr(TAG, `aircraft snapshot region failed: ${region.id}`, err, "tracks", region.id);
      }
    }
  };

  // Global: OpenSky /states/all in one call (worldwide). Needs OPENSKY_CLIENT_ID/
  // SECRET — anonymous is ~100 calls/day and 429s constantly. On any failure we
  // fall back to the keyless adsb.lol regions so we're never left with zero.
  if (process.env.AIRCRAFT_PROVIDER === "opensky") {
    try {
      for (const a of await fetchAircraft()) put(a, "global");
    } catch (err) {
      log(TAG, `snapshotAircraft global (opensky) failed — falling back to adsb.lol regions`, { err: summarizeForLog(err) });
      blogErr(TAG, `aircraft snapshot (opensky global) failed; using adsb.lol regions`, err, "tracks", "aircraft");
      await collectRegions();
    }
  } else {
    await collectRegions();
  }

  const recorded = await db.trackSnapshots.record([...aircraft.values()]);
  await recordVehicleRegistry(db, "aircraft", [...aircraft.values()], batchAt);
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
        cogDeg: s.cogDeg,
        batchAt,
      });
    }
  } catch (err) {
    log(TAG, `snapshotShips failed`, { err: summarizeForLog(err) });
    blogErr(TAG, `ship snapshot failed`, err, "tracks", "ships");
  }

  const recorded = await db.trackSnapshots.record([...ships.values()]);
  await recordVehicleRegistry(db, "ship", [...ships.values()], batchAt);
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
    // Live push so the quake overlay refetches the instant a feed lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "seismic", count: quakes.length } });
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
