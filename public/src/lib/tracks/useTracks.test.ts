/**
 * useTracks orchestration tests.
 *
 * The client never calls track feeds directly — data arrives from the worker's
 * cache via `./client` (fetch wrappers) and a socket push (TRACKS_UPDATED), so
 * those boundaries are mocked exactly. SGP4 (`propagateAll` / `orbitSegments`)
 * is mocked too — it has its own tests — while `toTrack` / `advance` stay real
 * so the dead-reckoning assertions exercise the true projection math.
 *
 * Fake timers drive the hook's cadences: 1s projection tick, 1.5s satellite
 * propagation, 30s aircraft poll, 60s ship poll, 30s trail poll.
 */
import { act, renderHook } from "@testing-library/react";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { useTracks, type UseTracksOptions } from "./useTracks";
import {
  fetchSatelliteTles,
  listAircraft,
  listShips,
  listTrackPaths,
  type AircraftResponse,
  type ShipsResponse,
  type TrackPath,
} from "./client";
import { propagateAll } from "./propagate";
import { orbitSegments } from "./orbit";
import { advance, knotsToMS } from "./deadReckon";
import type { Aircraft, SatellitePosition, Ship, TleRecord } from "./types";

jest.mock("./client", () => ({
  fetchSatelliteTles: jest.fn(),
  listAircraft: jest.fn(),
  listShips: jest.fn(),
  listTrackPaths: jest.fn(),
}));
jest.mock("./propagate", () => ({ propagateAll: jest.fn() }));
jest.mock("./orbit", () => ({ orbitSegments: jest.fn() }));

// ── Socket boundary ─────────────────────────────────────────────────────────
type Handler = (...args: unknown[]) => void;

class FakeSocket {
  handlers = new Map<string, Set<Handler>>();
  on = jest.fn((ev: string, h: Handler) => {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(h);
    return this;
  });
  off = jest.fn((ev: string, h: Handler) => {
    this.handlers.get(ev)?.delete(h);
    return this;
  });
  /** Simulate the worker pushing an event to this client. */
  trigger(ev: string) {
    for (const h of [...(this.handlers.get(ev) ?? [])]) h();
  }
}

let mockSocket: FakeSocket | null = null;
jest.mock("../socket-provider", () => ({
  useSocket: () => ({ socket: mockSocket, connected: mockSocket != null }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const T0 = new Date("2026-01-01T00:00:00Z");
const T0_ISO = T0.toISOString();

const AC1: Aircraft = {
  icao24: "abc123",
  callsign: "BAW123  ",
  lng: 10,
  lat: 0,
  altM: 10000,
  velocityMS: 100,
  headingDeg: 90,
  onGround: false,
};

// Speed 0 → dead reckoning is a no-op, so its marker stays put (handy for trails).
const AC_STILL: Aircraft = { icao24: "def456", lng: -20, lat: 40, velocityMS: 0, onGround: false };

const SHIP1: Ship = { mmsi: "211000000", name: "EVER GIVEN", lng: 30, lat: 0, sogKn: 20, cogDeg: 180 };

const TLE: TleRecord = { name: "ISS (ZARYA)", noradId: "25544", line1: "1", line2: "2" };
const SATPOS: SatellitePosition = {
  noradId: "25544",
  name: "ISS (ZARYA)",
  lng: 5,
  lat: 5,
  altKm: 420,
  speedKmS: 7.66,
};

const acResponse = (aircraft: Aircraft[], at: string = T0_ISO): AircraftResponse => ({
  count: aircraft.length,
  total: aircraft.length,
  at,
  aircraft,
});
const shipResponse = (ships: Ship[], at: string = T0_ISO): ShipsResponse => ({
  configured: true,
  count: ships.length,
  at,
  ships,
});

const mockedFetchTles = fetchSatelliteTles as jest.MockedFunction<typeof fetchSatelliteTles>;
const mockedListAircraft = listAircraft as jest.MockedFunction<typeof listAircraft>;
const mockedListShips = listShips as jest.MockedFunction<typeof listShips>;
const mockedListTrackPaths = listTrackPaths as jest.MockedFunction<typeof listTrackPaths>;
const mockedPropagateAll = propagateAll as jest.MockedFunction<typeof propagateAll>;
const mockedOrbitSegments = orbitSegments as jest.MockedFunction<typeof orbitSegments>;

const baseOpts: UseTracksOptions = {
  showSatellites: false,
  showAircraft: false,
  showShips: false,
  showOrbits: false,
  satelliteGroup: "active",
  center: [0, 0],
  zoom: 2,
};

/** Render the hook and flush the initial async polls (still at T0, dt = 0). */
async function renderTracks(overrides: Partial<UseTracksOptions> = {}) {
  const utils = renderHook((props: UseTracksOptions) => useTracks(props), {
    initialProps: { ...baseOpts, ...overrides },
  });
  await flush();
  return utils;
}

/** Let pending poll promises resolve (and any 0ms timers fire) inside act. */
const flush = () => act(async () => {
  await jest.advanceTimersByTimeAsync(0);
});

/** Advance fake time (fires intervals, moves Date.now()) inside act. */
const tick = (ms: number) => act(async () => {
  await jest.advanceTimersByTimeAsync(ms);
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  mockSocket = new FakeSocket();
  mockedFetchTles.mockResolvedValue([]);
  mockedListAircraft.mockResolvedValue(acResponse([]));
  mockedListShips.mockResolvedValue(shipResponse([]));
  mockedListTrackPaths.mockResolvedValue([]);
  mockedPropagateAll.mockReturnValue([]);
  mockedOrbitSegments.mockReturnValue([]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("useTracks — socket subscription lifecycle", () => {
  it("subscribes to TRACKS_UPDATED on mount and unsubscribes the same handler on unmount", async () => {
    const { unmount } = await renderTracks();
    expect(mockSocket!.on).toHaveBeenCalledWith(TRACKS_UPDATED, expect.any(Function));
    const handler = mockSocket!.on.mock.calls[0][1];

    unmount();
    expect(mockSocket!.off).toHaveBeenCalledWith(TRACKS_UPDATED, handler);
    expect(mockSocket!.handlers.get(TRACKS_UPDATED)?.size ?? 0).toBe(0);
  });

  it("re-polls immediately on a TRACKS_UPDATED push instead of waiting out the interval", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    const { result } = await renderTracks({ showAircraft: true });
    expect(mockedListAircraft).toHaveBeenCalledTimes(1);
    expect(result.current.tracks[0].position[0]).toBeCloseTo(10, 6);

    // Worker records a new frame and pushes; no timer has advanced.
    mockedListAircraft.mockResolvedValue(acResponse([{ ...AC1, lng: 11 }]));
    await act(async () => {
      mockSocket!.trigger(TRACKS_UPDATED);
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mockedListAircraft).toHaveBeenCalledTimes(2);
    expect(result.current.tracks[0].position[0]).toBeCloseTo(11, 6);
  });
});

describe("useTracks — aircraft", () => {
  it("ingests the worker's cached frame into aircraft tracks (dt=0 → raw position)", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    const { result } = await renderTracks({ showAircraft: true });

    expect(result.current.tracks).toHaveLength(1);
    const t = result.current.tracks[0];
    expect(t.id).toBe("ac:abc123");
    expect(t.kind).toBe("aircraft");
    expect(t.name).toBe("BAW123"); // callsign trimmed by toTrack
    expect(t.position[0]).toBeCloseTo(10, 6);
    expect(t.position[1]).toBeCloseTo(0, 6);
    expect(t.position[2]).toBe(10000); // altitude carried through
  });

  it("dead-reckons the position forward on the 1s projection tick", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    const { result } = await renderTracks({ showAircraft: true });

    await tick(5000); // five projection ticks; frame is now 5s old

    const [expLng, expLat] = advance(AC1.lng, AC1.lat, AC1.headingDeg, AC1.velocityMS, 5);
    const t = result.current.tracks[0];
    expect(t.position[0]).toBeCloseTo(expLng, 6);
    expect(t.position[1]).toBeCloseTo(expLat, 6);
    expect(t.position[0]).toBeGreaterThan(10); // heading 90 → moved east
    expect(t.position[2]).toBe(10000);
    expect(mockedListAircraft).toHaveBeenCalledTimes(1); // still the same frame
  });

  it("clamps projection of a stale frame to 20 minutes so tracks aren't flung", async () => {
    const staleAt = new Date(T0.getTime() - 7200_000).toISOString(); // 2h old
    mockedListAircraft.mockResolvedValue(acResponse([AC1], staleAt));
    const { result } = await renderTracks({ showAircraft: true });

    const [clampedLng] = advance(AC1.lng, AC1.lat, AC1.headingDeg, AC1.velocityMS, 1200);
    const [unclampedLng] = advance(AC1.lng, AC1.lat, AC1.headingDeg, AC1.velocityMS, 7200);
    const t = result.current.tracks[0];
    expect(t.position[0]).toBeCloseTo(clampedLng, 6);
    expect(t.position[0]).not.toBeCloseTo(unclampedLng, 1);
  });

  it("keeps polling on the 30s fallback interval", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    await renderTracks({ showAircraft: true });
    expect(mockedListAircraft).toHaveBeenCalledTimes(1);

    await tick(30000);
    expect(mockedListAircraft).toHaveBeenCalledTimes(2);
    await tick(30000);
    expect(mockedListAircraft).toHaveBeenCalledTimes(3);
  });

  it("clears aircraft tracks and stops polling when toggled off", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    const { result, rerender } = await renderTracks({ showAircraft: true });
    expect(result.current.tracks).toHaveLength(1);

    rerender({ ...baseOpts, showAircraft: false });
    await flush();
    expect(result.current.tracks).toHaveLength(0);

    await tick(60000); // two would-be poll intervals later
    expect(mockedListAircraft).toHaveBeenCalledTimes(1);
  });

  it("handles an empty frame without producing tracks", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([]));
    const { result } = await renderTracks({ showAircraft: true });
    await tick(3000);
    expect(result.current.tracks).toEqual([]);
  });
});

describe("useTracks — ships", () => {
  it("converts knots to m/s and falls back to COG for the heading when dead-reckoning", async () => {
    mockedListShips.mockResolvedValue(shipResponse([SHIP1]));
    const { result } = await renderTracks({ showShips: true });

    const t0 = result.current.tracks[0];
    expect(t0.id).toBe("ship:211000000");
    expect(t0.name).toBe("EVER GIVEN");

    await tick(10_000);
    // SHIP1 has no headingDeg → COG (180, due south) drives the projection.
    const [expLng, expLat] = advance(SHIP1.lng, SHIP1.lat, SHIP1.cogDeg, knotsToMS(SHIP1.sogKn!), 10);
    const t = result.current.tracks[0];
    expect(t.position[0]).toBeCloseTo(expLng, 6);
    expect(t.position[1]).toBeCloseTo(expLat, 6);
    expect(t.position[1]).toBeLessThan(0); // moved south
    expect(t.position[2]).toBe(0); // ships sit on the surface
  });
});

describe("useTracks — satellites & orbits", () => {
  it("loads TLEs for the group, propagates immediately, then re-propagates every 1.5s", async () => {
    mockedFetchTles.mockResolvedValue([TLE]);
    mockedPropagateAll.mockReturnValue([SATPOS]);
    const { result } = await renderTracks({ showSatellites: true });

    expect(mockedFetchTles).toHaveBeenCalledWith("active", 100000);
    expect(mockedPropagateAll).toHaveBeenCalledTimes(1);
    const t = result.current.tracks[0];
    expect(t.id).toBe("sat:25544");
    expect(t.position).toEqual([5, 5, 420000]); // altKm → metres

    mockedPropagateAll.mockReturnValue([{ ...SATPOS, lng: 6 }]);
    await tick(1500);
    expect(mockedPropagateAll).toHaveBeenCalledTimes(2);
    expect(result.current.tracks[0].position[0]).toBe(6);
  });

  it("refetches TLEs when the satellite group changes", async () => {
    mockedFetchTles.mockResolvedValue([TLE]);
    const { rerender } = await renderTracks({ showSatellites: true });
    expect(mockedFetchTles).toHaveBeenLastCalledWith("active", 100000);

    rerender({ ...baseOpts, showSatellites: true, satelliteGroup: "stations" });
    await flush();
    expect(mockedFetchTles).toHaveBeenLastCalledWith("stations", 100000);
    expect(mockedFetchTles).toHaveBeenCalledTimes(2);
  });

  it("computes orbit rings once per TLE set, not on every propagation tick", async () => {
    const ring = [{ id: "25544:0", path: [[0, 0, 420000], [1, 0, 420000]] as [number, number, number][] }];
    mockedFetchTles.mockResolvedValue([TLE]);
    mockedPropagateAll.mockReturnValue([SATPOS]);
    mockedOrbitSegments.mockReturnValue(ring);
    const { result } = await renderTracks({ showSatellites: true, showOrbits: true });

    expect(result.current.orbits).toEqual(ring);
    expect(mockedOrbitSegments).toHaveBeenCalledTimes(1);

    await tick(4500); // three propagation ticks
    expect(mockedPropagateAll.mock.calls.length).toBeGreaterThan(1);
    expect(mockedOrbitSegments).toHaveBeenCalledTimes(1); // heavy path untouched
  });

  it("fetches nothing and returns empty results when every source is off", async () => {
    const { result } = await renderTracks();
    await tick(60000);

    expect(mockedFetchTles).not.toHaveBeenCalled();
    expect(mockedListAircraft).not.toHaveBeenCalled();
    expect(mockedListShips).not.toHaveBeenCalled();
    expect(mockedListTrackPaths).not.toHaveBeenCalled();
    expect(result.current).toEqual({ tracks: [], orbits: [], trails: [] });
  });
});

describe("useTracks — merging", () => {
  it("merges enabled sources in satellite, aircraft, ship order", async () => {
    mockedFetchTles.mockResolvedValue([TLE]);
    mockedPropagateAll.mockReturnValue([SATPOS]);
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    mockedListShips.mockResolvedValue(shipResponse([SHIP1]));
    const { result } = await renderTracks({ showSatellites: true, showAircraft: true, showShips: true });

    expect(result.current.tracks.map((t) => t.kind)).toEqual(["satellite", "aircraft", "ship"]);
  });
});

describe("useTracks — trails", () => {
  const acTrail: TrackPath = {
    externalId: AC_STILL.icao24,
    kind: "aircraft",
    path: [[-20.2, 40], [-20.1, 40]],
  };
  const shipTrail: TrackPath = {
    externalId: SHIP1.mmsi,
    kind: "ship",
    path: [[29.8, 0.2], [29.9, 0.1]],
  };

  it("polls each enabled kind separately and merges the results", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC_STILL]));
    mockedListShips.mockResolvedValue(shipResponse([{ ...SHIP1, sogKn: 0 }]));
    mockedListTrackPaths.mockImplementation(async (_min, kind) =>
      kind === "aircraft" ? [acTrail] : [shipTrail],
    );
    const { result } = await renderTracks({
      showAircraft: true,
      showShips: true,
      showTrails: true,
      trailMinutes: 45,
    });

    expect(mockedListTrackPaths).toHaveBeenCalledWith(45, "aircraft");
    expect(mockedListTrackPaths).toHaveBeenCalledWith(45, "ship");
    expect(result.current.trails.map((tr) => tr.externalId).sort()).toEqual(
      [AC_STILL.icao24, SHIP1.mmsi].sort(),
    );
  });

  it("only requests trail kinds that are shown, and none when trails are off", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC_STILL]));
    mockedListTrackPaths.mockResolvedValue([acTrail]);
    const { rerender } = await renderTracks({ showAircraft: true, showTrails: true });

    expect(mockedListTrackPaths).toHaveBeenCalledTimes(1);
    expect(mockedListTrackPaths).toHaveBeenCalledWith(30, "aircraft"); // default 30min, no "ship" call

    rerender({ ...baseOpts, showAircraft: true, showTrails: false });
    await tick(60000);
    expect(mockedListTrackPaths).toHaveBeenCalledTimes(1); // no further polls
  });

  it("extends each trail's head to its live marker and drops orphans with no marker", async () => {
    const orphan: TrackPath = { externalId: "nolive99", kind: "aircraft", path: [[50, 50], [50.1, 50]] };
    mockedListAircraft.mockResolvedValue(acResponse([AC_STILL]));
    mockedListTrackPaths.mockResolvedValue([acTrail, orphan]);
    const { result } = await renderTracks({ showAircraft: true, showTrails: true });

    // Orphan (no live marker) is not drawn; the kept trail's head is extended
    // to the (stationary) dead-reckoned marker at [-20, 40].
    expect(result.current.trails).toHaveLength(1);
    expect(result.current.trails[0].externalId).toBe(AC_STILL.icao24);
    expect(result.current.trails[0].path).toEqual([[-20.2, 40], [-20.1, 40], [-20, 40]]);
  });

  it("does not duplicate the head point when the trail already ends at the marker", async () => {
    const flush2: TrackPath = {
      externalId: AC_STILL.icao24,
      kind: "aircraft",
      path: [[-20.1, 40], [-20, 40]], // already ends at the live position
    };
    mockedListAircraft.mockResolvedValue(acResponse([AC_STILL]));
    mockedListTrackPaths.mockResolvedValue([flush2]);
    const { result } = await renderTracks({ showAircraft: true, showTrails: true });

    expect(result.current.trails).toHaveLength(1);
    expect(result.current.trails[0].path).toEqual([[-20.1, 40], [-20, 40]]);
  });
});

describe("useTracks — unmount cleanup", () => {
  it("stops all polling and projection after unmount", async () => {
    mockedListAircraft.mockResolvedValue(acResponse([AC1]));
    mockedListShips.mockResolvedValue(shipResponse([SHIP1]));
    mockedListTrackPaths.mockResolvedValue([]);
    const { unmount } = await renderTracks({ showAircraft: true, showShips: true, showTrails: true });

    const acCalls = mockedListAircraft.mock.calls.length;
    const shipCalls = mockedListShips.mock.calls.length;
    const trailCalls = mockedListTrackPaths.mock.calls.length;

    unmount();
    await tick(120_000); // past every interval, twice over

    expect(mockedListAircraft).toHaveBeenCalledTimes(acCalls);
    expect(mockedListShips).toHaveBeenCalledTimes(shipCalls);
    expect(mockedListTrackPaths).toHaveBeenCalledTimes(trailCalls);
    expect(jest.getTimerCount()).toBe(0); // no leaked intervals (incl. 1s projector)
  });
});
