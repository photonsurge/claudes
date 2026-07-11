/**
 * Tracks job handlers: TLE ingest (+ best-effort SATCAT join), the aircraft/
 * ship snapshot frames the overlay reads, the seismic cache, and the hexdb
 * enrichment trickle. All feeds and the DB facade are mocked — these tests
 * pin the merge/dedup/fallback logic, not the network.
 */
import type { Job } from "bullmq";
import { TRIGGERABLE_JOBS } from "@photonsurge/shared/jobs";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { DEFAULT_USGS_FEED } from "@photonsurge/shared/tracks/usgs";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { AppDb } from "@photonsurge/shared/db/index";

jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogErr: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("@photonsurge/shared/tracks/celestrak", () => ({
  ...jest.requireActual("@photonsurge/shared/tracks/celestrak"),
  fetchGroupTle: jest.fn(),
  fetchGroupSatcat: jest.fn(),
}));
jest.mock("@photonsurge/shared/tracks/adsb", () => ({ fetchAdsb: jest.fn() }));
jest.mock("@photonsurge/shared/tracks/opensky", () => ({ fetchAircraft: jest.fn() }));
jest.mock("@photonsurge/shared/tracks/aisstream", () => ({ collectShips: jest.fn() }));
jest.mock("@photonsurge/shared/tracks/usgs", () => ({
  ...jest.requireActual("@photonsurge/shared/tracks/usgs"),
  fetchQuakes: jest.fn(),
}));
jest.mock("@photonsurge/shared/tracks/hexdb", () => ({ fetchAircraftMeta: jest.fn() }));

import { fetchGroupTle, fetchGroupSatcat } from "@photonsurge/shared/tracks/celestrak";
import { fetchAdsb } from "@photonsurge/shared/tracks/adsb";
import { fetchAircraft } from "@photonsurge/shared/tracks/opensky";
import { collectShips } from "@photonsurge/shared/tracks/aisstream";
import { fetchQuakes } from "@photonsurge/shared/tracks/usgs";
import { fetchAircraftMeta } from "@photonsurge/shared/tracks/hexdb";
import { emitWorkerEvent } from "../socket";

// tracks.ts captures several env knobs as module-load constants (enrich
// cap/delay, ship collect window, registry toggle) — pin them BEFORE the
// module is loaded, so use require() here instead of a hoisted import.
process.env.AIRCRAFT_ENRICH_DELAY_MS = "0";
process.env.AIRCRAFT_ENRICH_CAP = "2";
delete process.env.SNAPSHOT_REGIONS;
delete process.env.SHIP_BBOXES;
delete process.env.AIRCRAFT_PROVIDER;
delete process.env.AISSTREAM_API_KEY;
delete process.env.USGS_FEED;
delete process.env.SATELLITE_GROUPS;
delete process.env.VEHICLE_REGISTRY_ENABLED;
// Refresh the whole registry every frame by default, so the existing snapshot
// tests see the full row set; the cadence test below flips this on per-test.
process.env.VEHICLE_REGISTRY_FULL_MS = "0";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tracks = require("./tracks") as typeof import("./tracks");

const job = (data: Record<string, unknown> = {}): Job => ({ id: "j1", data: { data } }) as unknown as Job;

/** Minimal fake DB facade exposing just what the tracks handlers touch. */
function fakeDb(over: Partial<Record<string, unknown>> = {}) {
  return {
    trackSnapshots: {
      latest: jest.fn(async () => ({ rows: (over.latestRows as unknown[]) ?? [] })),
      record: jest.fn(async (rows: unknown[]) => rows.length),
    },
    aircraftMeta: {
      getAll: jest.fn(async () => ({ data: (over.knownMeta as unknown[]) ?? [] })),
      upsertByID: jest.fn(async () => ({})),
    },
    satelliteTles: {
      upsertMany: jest.fn(async (tles: unknown[]) => ({ upserted: tles.length })),
      upsertSatcatMany: jest.fn(async (meta: unknown[]) => ({ matched: meta.length })),
    },
    quakes: {
      upsertMany: jest.fn(async (quakes: unknown[]) => ({ upserted: quakes.length })),
    },
    vehicles: {
      notableIds: jest.fn(async () => (over.notableIds as string[]) ?? []),
      recordSightings: jest.fn(async () => ({})),
    },
  };
}

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  jest.clearAllMocks();
  db = fakeDb();
  (getAppDb as jest.Mock).mockResolvedValue(db as unknown as AppDb);
  (fetchAdsb as jest.Mock).mockResolvedValue([]);
  (fetchAircraft as jest.Mock).mockResolvedValue([]);
  (collectShips as jest.Mock).mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.SNAPSHOT_REGIONS;
  delete process.env.SATELLITE_GROUPS;
  delete process.env.AIRCRAFT_PROVIDER;
  delete process.env.AISSTREAM_API_KEY;
  delete process.env.USGS_FEED;
  // Restore the every-frame default + clear the throttle for the next test.
  process.env.VEHICLE_REGISTRY_FULL_MS = "0";
  tracks.__resetRegistryThrottle();
});

describe("tracks job registry ↔ handlers", () => {
  it("every tracks job event has an exported handler", () => {
    const trackJobs = TRIGGERABLE_JOBS.filter((j) => j.type === "tracks");
    expect(trackJobs.length).toBeGreaterThanOrEqual(4);
    for (const j of trackJobs) {
      expect(typeof (tracks as unknown as Record<string, unknown>)[j.event]).toBe("function");
    }
  });
});

describe("snapshotRegions", () => {
  it("defaults to the curated busy areas when the env is unset", () => {
    expect(tracks.snapshotRegions().map((r) => r.id)).toEqual(["uk-eire", "nw-europe", "us-northeast"]);
  });

  it("honours a SNAPSHOT_REGIONS JSON override", () => {
    process.env.SNAPSHOT_REGIONS = JSON.stringify([{ id: "oz", bbox: [140, -40, 155, -30] }]);
    expect(tracks.snapshotRegions()).toEqual([{ id: "oz", bbox: [140, -40, 155, -30] }]);
  });

  it("falls back to the defaults on malformed JSON", () => {
    process.env.SNAPSHOT_REGIONS = "{not json";
    expect(tracks.snapshotRegions().map((r) => r.id)).toEqual(["uk-eire", "nw-europe", "us-northeast"]);
  });
});

describe("tleGroups", () => {
  it("defaults to the curated notable set, excluding the megaconstellations", () => {
    const groups = tracks.tleGroups();
    expect(groups).toEqual(expect.arrayContaining(["stations", "visual", "weather", "science"]));
    expect(groups).not.toContain("starlink");
    expect(groups).not.toContain("oneweb");
  });

  it("honours a SATELLITE_GROUPS override, trimming blanks", () => {
    process.env.SATELLITE_GROUPS = " stations , starlink ,,weather ";
    expect(tracks.tleGroups()).toEqual(["stations", "starlink", "weather"]);
  });
});

describe("ingestTles", () => {
  const TLE_TEXT = [
    "ISS (ZARYA)",
    "1 25544U 98067A   24079.91388889  .00016717  00000-0  10270-3 0  9000",
    "2 25544  51.6400 208.9163 0006317  69.9862 254.3157 15.49560000000000",
  ].join("\n");
  const SATCAT = [
    { OBJECT_NAME: "ISS (ZARYA)", OBJECT_ID: "1998-067A", NORAD_CAT_ID: 25544, OWNER: "ISS", LAUNCH_DATE: "1998-11-20" },
  ];

  it("parses each group's TLEs, upserts them, and joins SATCAT metadata", async () => {
    (fetchGroupTle as jest.Mock).mockResolvedValue(TLE_TEXT);
    (fetchGroupSatcat as jest.Mock).mockResolvedValue(SATCAT);

    const { results } = await tracks.ingestTles(job({ groups: ["stations"] }));

    expect(fetchGroupTle).toHaveBeenCalledWith("stations");
    expect(db.satelliteTles.upsertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ noradId: "25544", name: "ISS (ZARYA)" })],
      "stations",
    );
    expect(db.satelliteTles.upsertSatcatMany).toHaveBeenCalledWith([
      expect.objectContaining({ noradId: "25544", meta: expect.objectContaining({ objectId: "1998-067A" }) }),
    ]);
    expect(results).toEqual([{ group: "stations", parsed: 1, upserted: 1, enriched: 1 }]);
  });

  it("never lets a SATCAT failure sink the TLE ingest", async () => {
    (fetchGroupTle as jest.Mock).mockResolvedValue(TLE_TEXT);
    (fetchGroupSatcat as jest.Mock).mockRejectedValue(new Error("catalog down"));

    const { results } = await tracks.ingestTles(job({ groups: ["stations"] }));

    expect(db.satelliteTles.upsertMany).toHaveBeenCalled();
    expect(results).toEqual([{ group: "stations", parsed: 1, upserted: 1, enriched: 0 }]);
  });

  it("records a failed group as an error and carries on with the rest", async () => {
    (fetchGroupTle as jest.Mock)
      .mockRejectedValueOnce(new Error("celestrak 503"))
      .mockResolvedValueOnce(TLE_TEXT);
    (fetchGroupSatcat as jest.Mock).mockResolvedValue([]);

    const { results } = await tracks.ingestTles(job({ groups: ["visual", "stations"] }));

    expect(results).toEqual([
      { group: "visual", error: expect.stringContaining("celestrak 503") },
      { group: "stations", parsed: 1, upserted: 1, enriched: 0 },
    ]);
  });

  it("falls back to the configured groups when the job carries none", async () => {
    (fetchGroupTle as jest.Mock).mockResolvedValue("");
    (fetchGroupSatcat as jest.Mock).mockResolvedValue([]);

    await tracks.ingestTles(job());

    expect((fetchGroupTle as jest.Mock).mock.calls.map((c) => c[0])).toEqual(tracks.tleGroups());
  });
});

describe("snapshotAircraft", () => {
  it("collects one adsb.lol frame per default region, deduping on icao24 across regions", async () => {
    (fetchAdsb as jest.Mock)
      .mockResolvedValueOnce([{ icao24: "abc123", callsign: "BAW1", lng: 0, lat: 51, altM: 10000 }])
      .mockResolvedValueOnce([{ icao24: "abc123", callsign: "BAW1", lng: 0.1, lat: 51.1, altM: 10000 }])
      .mockResolvedValueOnce([{ icao24: "def456", callsign: "UAL2", lng: -74, lat: 40, altM: 9000 }]);

    const result = await tracks.snapshotAircraft(job());

    expect((fetchAdsb as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      [-8, 50, 2, 56],
      [3, 48, 11, 53],
      [-77, 38, -70, 42],
    ]);
    expect(result.aircraft).toBe(2);
    const rows = db.trackSnapshots.record.mock.calls[0][0] as { externalId: string; lng: number; batchAt: Date }[];
    expect(rows.map((r) => r.externalId).sort()).toEqual(["abc123", "def456"]);
    // Later region wins the dedup, and every row shares the frame timestamp.
    expect(rows.find((r) => r.externalId === "abc123")!.lng).toBe(0.1);
    expect(new Set(rows.map((r) => r.batchAt.getTime())).size).toBe(1);
    expect(emitWorkerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: TRACKS_UPDATED, data: expect.objectContaining({ kind: "aircraft", count: 2 }) }),
    );
  });

  it("rejects all-zero placeholder icao24s but keeps valid hex ids like 00abcd", async () => {
    (fetchAdsb as jest.Mock).mockResolvedValue([
      { icao24: "000000", lng: 0, lat: 0 },
      { icao24: "00abcd", lng: 1, lat: 1 },
    ]);

    await tracks.snapshotAircraft(job());

    const rows = db.trackSnapshots.record.mock.calls[0][0] as { externalId: string }[];
    expect(rows.map((r) => r.externalId)).toEqual(["00abcd"]);
  });

  it("uses one global OpenSky call when AIRCRAFT_PROVIDER=opensky", async () => {
    process.env.AIRCRAFT_PROVIDER = "opensky";
    (fetchAircraft as jest.Mock).mockResolvedValue([{ icao24: "abc123", lng: 0, lat: 51 }]);

    const result = await tracks.snapshotAircraft(job());

    expect(fetchAircraft).toHaveBeenCalledTimes(1);
    expect(fetchAdsb).not.toHaveBeenCalled();
    expect(result.aircraft).toBe(1);
    const rows = db.trackSnapshots.record.mock.calls[0][0] as { region?: string }[];
    expect(rows[0].region).toBe("global");
  });

  it("falls back to the adsb.lol regions when the OpenSky global call fails", async () => {
    process.env.AIRCRAFT_PROVIDER = "opensky";
    (fetchAircraft as jest.Mock).mockRejectedValue(new Error("429 rate limited"));
    (fetchAdsb as jest.Mock).mockResolvedValue([{ icao24: "abc123", lng: 0, lat: 51 }]);

    const result = await tracks.snapshotAircraft(job());

    expect(fetchAdsb).toHaveBeenCalledTimes(3);
    expect(result.aircraft).toBe(1);
  });

  it("survives a single region failing and still records the rest", async () => {
    (fetchAdsb as jest.Mock)
      .mockRejectedValueOnce(new Error("adsb down"))
      .mockResolvedValueOnce([{ icao24: "def456", lng: 5, lat: 50 }])
      .mockResolvedValueOnce([]);

    const result = await tracks.snapshotAircraft(job());

    expect(result.aircraft).toBe(1);
  });

  it("upserts the vehicle registry with a country flag, and a registry hiccup never fails the snapshot", async () => {
    (fetchAdsb as jest.Mock).mockResolvedValue([
      { icao24: "abc123", callsign: "BAW1", country: "United Kingdom", lng: 0, lat: 51 },
    ]);
    db.vehicles.notableIds.mockResolvedValue(["aircraft:abc123"]);

    await tracks.snapshotAircraft(job());

    expect(db.vehicles.recordSightings).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: "aircraft", code: "abc123", country: "United Kingdom", flag: "🇬🇧" })],
      expect.objectContaining({ trailIds: ["aircraft:abc123"] }),
    );

    db.vehicles.recordSightings.mockRejectedValue(new Error("mongo hiccup"));
    await expect(tracks.snapshotAircraft(job())).resolves.toMatchObject({ aircraft: 1 });
  });

  it("does not live-push when nothing was recorded", async () => {
    await tracks.snapshotAircraft(job());
    expect(emitWorkerEvent).not.toHaveBeenCalled();
  });
});

describe("snapshotShips", () => {
  it("no-ops without AISSTREAM_API_KEY", async () => {
    const result = await tracks.snapshotShips(job());
    expect(result).toEqual({ ships: 0, recorded: 0, skipped: true });
    expect(collectShips).not.toHaveBeenCalled();
    expect(db.trackSnapshots.record).not.toHaveBeenCalled();
  });

  it("collects one global AIS frame, mapping heading (with COG fallback) and dropping junk MMSIs", async () => {
    process.env.AISSTREAM_API_KEY = "k";
    (collectShips as jest.Mock).mockResolvedValue([
      { mmsi: "232000001", name: "Boaty", lng: 1, lat: 50, sogKn: 18, cogDeg: 92, headingDeg: 90 },
      { mmsi: "310627000", name: "QM2", lng: -40, lat: 42, sogKn: 22, cogDeg: 270 }, // no true heading → COG
      { mmsi: "000000000", name: "Junk", lng: 0, lat: 0 }, // all-zeros placeholder → dropped
    ]);

    const result = await tracks.snapshotShips(job());

    // One firehose subscription covering the whole world by default.
    expect(collectShips).toHaveBeenCalledWith("k", [[-180, -90, 180, 90]], expect.any(Number));
    expect(result.ships).toBe(2);
    const rows = db.trackSnapshots.record.mock.calls[0][0] as { externalId: string; headingDeg?: number; kind: string }[];
    expect(rows.map((r) => r.externalId).sort()).toEqual(["232000001", "310627000"]);
    expect(rows.find((r) => r.externalId === "232000001")!.headingDeg).toBe(90);
    expect(rows.find((r) => r.externalId === "310627000")!.headingDeg).toBe(270);
    expect(emitWorkerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: TRACKS_UPDATED, data: expect.objectContaining({ kind: "ship" }) }),
    );
  });

  it("records an empty frame (no throw, no push) when the AIS collect fails", async () => {
    process.env.AISSTREAM_API_KEY = "k";
    (collectShips as jest.Mock).mockRejectedValue(new Error("socket dropped"));

    const result = await tracks.snapshotShips(job());

    expect(result.ships).toBe(0);
    expect(db.trackSnapshots.record).toHaveBeenCalledWith([]);
    expect(emitWorkerEvent).not.toHaveBeenCalled();
  });

  it("derives the vessel's registry country from the MMSI MID", async () => {
    process.env.AISSTREAM_API_KEY = "k";
    (collectShips as jest.Mock).mockResolvedValue([{ mmsi: "232000001", name: "Boaty", lng: 1, lat: 50 }]);

    await tracks.snapshotShips(job());

    expect(db.vehicles.recordSightings).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: "ship", code: "232000001", country: "United Kingdom", flag: "🇬🇧" })],
      expect.anything(),
    );
  });

  it("throttles the full registry refresh but keeps notable vessels live every frame", async () => {
    process.env.AISSTREAM_API_KEY = "k";
    // 10min window — the second snapshot lands ms later, so it's throttled.
    process.env.VEHICLE_REGISTRY_FULL_MS = "600000";
    tracks.__resetRegistryThrottle();
    db.vehicles.notableIds.mockResolvedValue(new Set(["ship:232000001"]));
    (collectShips as jest.Mock).mockResolvedValue([
      { mmsi: "232000001", name: "Boaty", lng: 1, lat: 50 }, // notable → always recorded
      { mmsi: "310627000", name: "QM2", lng: -40, lat: 42 }, // not notable → full frames only
    ]);

    await tracks.snapshotShips(job()); // first frame: full refresh
    await tracks.snapshotShips(job()); // second frame: throttled → notable only

    const first = db.vehicles.recordSightings.mock.calls[0][0] as { code: string }[];
    const second = db.vehicles.recordSightings.mock.calls[1][0] as { code: string }[];
    expect(first.map((r) => r.code).sort()).toEqual(["232000001", "310627000"]);
    expect(second.map((r) => r.code)).toEqual(["232000001"]);
    // The live snapshot itself always records the whole frame regardless.
    expect((db.trackSnapshots.record.mock.calls[1][0] as unknown[]).length).toBe(2);
  });
});

describe("snapshotSeismic", () => {
  it("fetches the default USGS feed and upserts the quakes", async () => {
    (fetchQuakes as jest.Mock).mockResolvedValue([
      { id: "us7000abcd", mag: 6.1, place: "Off Japan", time: 1, lng: 140, lat: 38, depthKm: 10 },
    ]);

    const result = await tracks.snapshotSeismic(job());

    expect(fetchQuakes).toHaveBeenCalledWith(DEFAULT_USGS_FEED);
    expect(db.quakes.upsertMany).toHaveBeenCalledWith([expect.objectContaining({ id: "us7000abcd" })]);
    expect(result).toEqual({ feed: DEFAULT_USGS_FEED, fetched: 1, upserted: 1 });
    expect(emitWorkerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: TRACKS_UPDATED, data: { kind: "seismic", count: 1 } }),
    );
  });

  it("prefers the job's feed override", async () => {
    (fetchQuakes as jest.Mock).mockResolvedValue([]);
    await tracks.snapshotSeismic(job({ feed: "4.5_week" }));
    expect(fetchQuakes).toHaveBeenCalledWith("4.5_week");
  });

  it("rethrows a feed failure so the job is marked failed", async () => {
    (fetchQuakes as jest.Mock).mockRejectedValue(new Error("usgs 500"));
    await expect(tracks.snapshotSeismic(job())).rejects.toThrow("usgs 500");
    expect(emitWorkerEvent).not.toHaveBeenCalled();
  });
});

describe("enrichAircraft", () => {
  it("returns straight away when there is no aircraft frame", async () => {
    const result = await tracks.enrichAircraft(job());
    expect(result).toEqual({ enriched: 0, todo: 0 });
    expect(fetchAircraftMeta).not.toHaveBeenCalled();
  });

  it("looks up only unknown icaos (lowercased + deduped), caching hits and misses", async () => {
    db = fakeDb({
      latestRows: [{ externalId: "ABC123" }, { externalId: "abc123" }, { externalId: "def456" }],
      knownMeta: [{ id: "def456" }],
    });
    (getAppDb as jest.Mock).mockResolvedValue(db as unknown as AppDb);
    (fetchAircraftMeta as jest.Mock).mockResolvedValue({ registration: "G-CIVA", type: "Boeing 747-400" });

    const result = await tracks.enrichAircraft(job());

    // "ABC123"/"abc123" collapse to one unknown id; "def456" is already cached.
    expect(fetchAircraftMeta).toHaveBeenCalledTimes(1);
    expect(fetchAircraftMeta).toHaveBeenCalledWith("abc123");
    expect(db.aircraftMeta.upsertByID).toHaveBeenCalledWith(
      "abc123",
      expect.objectContaining({ icao24: "abc123", registration: "G-CIVA", notFound: false }),
    );
    expect(result).toMatchObject({ seen: 2, cached: 1, lookedUp: 1, enriched: 1 });
  });

  it("caches a miss as notFound so it is never re-fetched", async () => {
    db = fakeDb({ latestRows: [{ externalId: "abc123" }] });
    (getAppDb as jest.Mock).mockResolvedValue(db as unknown as AppDb);
    (fetchAircraftMeta as jest.Mock).mockResolvedValue(undefined);

    const result = await tracks.enrichAircraft(job());

    expect(db.aircraftMeta.upsertByID).toHaveBeenCalledWith(
      "abc123",
      expect.objectContaining({ icao24: "abc123", notFound: true }),
    );
    expect(result).toMatchObject({ lookedUp: 1, enriched: 0 });
  });

  it("caps the lookups per run (AIRCRAFT_ENRICH_CAP)", async () => {
    db = fakeDb({ latestRows: [{ externalId: "aaa111" }, { externalId: "bbb222" }, { externalId: "ccc333" }] });
    (getAppDb as jest.Mock).mockResolvedValue(db as unknown as AppDb);
    (fetchAircraftMeta as jest.Mock).mockResolvedValue(undefined);

    const result = await tracks.enrichAircraft(job());

    // Cap pinned to 2 at module load (see the env block above the require).
    expect(fetchAircraftMeta).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ seen: 3, lookedUp: 2 });
  });
});

describe("snapshot (combined one-shot)", () => {
  it("runs the aircraft and ship snapshots together", async () => {
    (fetchAdsb as jest.Mock).mockResolvedValue([{ icao24: "abc123", lng: 0, lat: 51 }]);

    const result = await tracks.snapshot(job());

    expect(result.aircraft).toMatchObject({ aircraft: 1 });
    expect(result.ships).toMatchObject({ skipped: true }); // no AIS key in tests
  });
});
