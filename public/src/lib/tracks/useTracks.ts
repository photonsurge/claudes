"use client";

import { useEffect, useMemo, useState } from "react";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { useSocket } from "../socket-provider";
import { fetchSatelliteTles, listAircraft, listShips, listTrackPaths, type TrackPath } from "./client";
import { propagateAll } from "./propagate";
import { orbitSegments, type OrbitSegment } from "./orbit";
import { aircraftToTrack, satelliteToTrack, shipToTrack } from "./toTrack";
import { advance, knotsToMS } from "./deadReckon";
import type { Aircraft, Ship, TleRecord, Track } from "./types";

export interface UseTracksOptions {
  showSatellites: boolean;
  showAircraft: boolean;
  showShips: boolean;
  showOrbits: boolean;
  satelliteGroup: string;
  /** Draw recent trailing routes behind aircraft/ships (from recorded history). */
  showTrails?: boolean;
  /** Trail length in minutes of history. */
  trailMinutes?: number;
  /**
   * Camera centre/zoom. Retained for API compatibility but no longer scopes the
   * aircraft/ship polls — the worker caches the whole world (OpenSky /states/all
   * is global) so we fetch globally and let the globe's depth test hide the far
   * hemisphere. Scoping to the camera made tracks vanish during auto-spin (the
   * spin doesn't move React camera state) and never fill the whole view.
   */
  center: [number, number];
  zoom: number;
}

export interface TracksResult {
  tracks: Track[];
  orbits: OrbitSegment[];
  /** Per-track recent routes (aircraft + ships) for the trails overlay. */
  trails: TrackPath[];
}

/** Max satellites to pull — local-only, so effectively the whole catalogue. */
const SAT_LIMIT = 100000;
/** Max orbit rings to draw at once (heavy: ~90 verts each). */
const ORBIT_CAP = 100000;

/**
 * Clean up trail polylines so they don't "teleport" across the globe:
 *  - drop junk external ids (e.g. AIS placeholder MMSI "0"/all-zeros that many
 *    vessels share, which merges them into one zig-zagging path);
 *  - split a path wherever consecutive points jump an impossible distance (a
 *    real teleport, or a coverage gap where the vessel left one region box and
 *    reappeared in another) — those endpoints must not be joined by a line.
 * Antimeridian-aware so a genuine ±180° crossing isn't treated as a jump.
 */
const MAX_TRAIL_STEP_DEG = 8;
export function sanitizeTrails(paths: TrackPath[]): TrackPath[] {
  const out: TrackPath[] = [];
  for (const p of paths) {
    if (!p.externalId || /^0+$/.test(p.externalId)) continue; // empty / all-zero id → junk
    let seg: [number, number][] = [];
    for (const cur of p.path) {
      const prev = seg[seg.length - 1];
      if (prev) {
        let dLng = Math.abs(cur[0] - prev[0]);
        if (dLng > 180) dLng = 360 - dLng; // shortest way round the seam
        if (Math.hypot(dLng, cur[1] - prev[1]) > MAX_TRAIL_STEP_DEG) {
          if (seg.length >= 2) out.push({ ...p, path: seg });
          seg = [];
        }
      }
      seg.push(cur);
    }
    if (seg.length >= 2) out.push({ ...p, path: seg });
  }
  return out;
}

/**
 * Aggregate enabled live-track sources into one `Track[]` for the globe overlay.
 * Satellites are propagated client-side every 1.5s (smooth, no rate limit);
 * aircraft/ships are polled (they're inherently snapshots) scoped to the view.
 */
export function useTracks(opts: UseTracksOptions): TracksResult {
  const { showSatellites, showAircraft, showShips, showOrbits, satelliteGroup } = opts;
  const showTrails = opts.showTrails ?? false;
  const trailMinutes = opts.trailMinutes ?? 30;
  const [satTracks, setSatTracks] = useState<Track[]>([]);
  const [acTracks, setAcTracks] = useState<Track[]>([]);
  const [shipTracks, setShipTracks] = useState<Track[]>([]);
  const [orbits, setOrbits] = useState<OrbitSegment[]>([]);
  const [trails, setTrails] = useState<TrackPath[]>([]);

  // Live push: the worker emits TRACKS_UPDATED after it records a new snapshot
  // frame. Bumping this tick re-runs the aircraft/ship/trail polls immediately,
  // so the globe updates the instant a frame lands instead of waiting out the
  // poll interval. The intervals stay as a fallback if the socket is down.
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => setLiveTick((n) => n + 1);
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  // Last cached frame (raw positions + frame time, ms) for dead reckoning.
  const [acFrame, setAcFrame] = useState<{ at: number; aircraft: Aircraft[] }>({ at: 0, aircraft: [] });
  const [shipFrame, setShipFrame] = useState<{ at: number; ships: Ship[] }>({ at: 0, ships: [] });

  // Satellites: load TLEs on group change (kept in state so orbits can react).
  const [satTles, setSatTles] = useState<TleRecord[]>([]);
  useEffect(() => {
    if (!showSatellites) {
      setSatTles([]);
      return;
    }
    let cancelled = false;
    fetchSatelliteTles(satelliteGroup, SAT_LIMIT).then((t) => {
      if (!cancelled) setSatTles(t);
    });
    return () => {
      cancelled = true;
    };
  }, [showSatellites, satelliteGroup]);

  // Propagate satellite positions on a timer.
  useEffect(() => {
    if (!showSatellites || !satTles.length) {
      setSatTracks([]);
      return;
    }
    const tick = () => setSatTracks(propagateAll(satTles, new Date()).map(satelliteToTrack));
    tick();
    const iv = setInterval(tick, 1500);
    return () => clearInterval(iv);
  }, [showSatellites, satTles]);

  // Orbit rings: recompute only when toggled / TLEs change (heavy, not per tick).
  useEffect(() => {
    if (!showSatellites || !showOrbits || !satTles.length) {
      setOrbits([]);
      return;
    }
    setOrbits(orbitSegments(satTles, new Date(), ORBIT_CAP));
  }, [showSatellites, showOrbits, satTles]);

  // Aircraft: re-fetch the worker's cached frame (~30s); positions are projected
  // forward between frames by the tick below.
  useEffect(() => {
    if (!showAircraft) {
      setAcFrame({ at: 0, aircraft: [] });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await listAircraft(); // global — every cached aircraft worldwide
      const at = r.at ? Date.parse(r.at) : Date.now();
      if (!cancelled) setAcFrame({ at, aircraft: r.aircraft });
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [showAircraft, liveTick]);

  // Ships: re-fetch the worker's cached frame (~60s).
  useEffect(() => {
    if (!showShips) {
      setShipFrame({ at: 0, ships: [] });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await listShips(); // global — every cached ship worldwide
      const at = r.at ? Date.parse(r.at) : Date.now();
      if (!cancelled) setShipFrame({ at, ships: r.ships });
    };
    poll();
    const iv = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [showShips, liveTick]);

  // Trails: per-track recent routes from recorded history, only for the kinds
  // currently shown. Re-polled on a slow cadence (the history grows ~every 2min).
  useEffect(() => {
    const kinds: ("aircraft" | "ship")[] = [];
    if (showAircraft) kinds.push("aircraft");
    if (showShips) kinds.push("ship");
    if (!showTrails || kinds.length === 0) {
      setTrails([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      // Fetch each kind separately so they don't share (and starve each other
      // out of) the server's per-request track cap, then merge.
      const rows = (await Promise.all(kinds.map((k) => listTrackPaths(trailMinutes, k)))).flat();
      if (!cancelled) setTrails(sanitizeTrails(rows));
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [showTrails, trailMinutes, showAircraft, showShips, liveTick]);

  // Projection tick (~1s): dead-reckon aircraft + ships from their last frame so
  // motion is smooth despite the slow poll. dtSec clamped so a stale frame can't
  // fling tracks across the globe.
  useEffect(() => {
    const project = () => {
      if (acFrame.aircraft.length) {
        // Cap projection at ~20min so a slow (anonymous OpenSky) frame keeps
        // moving across the gap rather than freezing, without flinging on stale.
        const dt = Math.min(1200, Math.max(0, (Date.now() - acFrame.at) / 1000));
        setAcTracks(
          acFrame.aircraft.map((a) => {
            const t = aircraftToTrack(a);
            const [lng, lat] = advance(a.lng, a.lat, a.headingDeg, a.velocityMS, dt);
            t.position = [lng, lat, a.altM ?? 0];
            return t;
          }),
        );
      } else {
        setAcTracks([]);
      }
      if (shipFrame.ships.length) {
        const dt = Math.min(900, Math.max(0, (Date.now() - shipFrame.at) / 1000));
        setShipTracks(
          shipFrame.ships.map((s) => {
            const t = shipToTrack(s);
            const heading = s.headingDeg ?? s.cogDeg;
            const [lng, lat] = advance(s.lng, s.lat, heading, s.sogKn != null ? knotsToMS(s.sogKn) : undefined, dt);
            t.position = [lng, lat, 0];
            return t;
          }),
        );
      } else {
        setShipTracks([]);
      }
    };
    project();
    const iv = setInterval(project, 1000);
    return () => clearInterval(iv);
  }, [acFrame, shipFrame]);

  const tracks = useMemo(
    () => [...satTracks, ...acTracks, ...shipTracks],
    [satTracks, acTracks, shipTracks],
  );
  return useMemo(() => ({ tracks, orbits, trails }), [tracks, orbits, trails]);
}
