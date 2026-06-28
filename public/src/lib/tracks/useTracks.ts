"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSatelliteTles, listAircraft, listShips } from "./client";
import { propagateAll } from "./propagate";
import { aircraftToTrack, satelliteToTrack, shipToTrack } from "./toTrack";
import type { TleRecord, Track } from "./types";

export interface UseTracksOptions {
  showSatellites: boolean;
  showAircraft: boolean;
  showShips: boolean;
  satelliteGroup: string;
  /** Camera centre [lng, lat] and zoom — used to scope the aircraft/ship polls. */
  center: [number, number];
  zoom: number;
}

/** Rough viewport bbox [w,s,e,n] from the globe camera (kept generous). */
function cameraBbox(lng: number, lat: number, zoom: number): [number, number, number, number] {
  const half = Math.min(170, 180 / Math.pow(2, zoom));
  return [lng - half, Math.max(-85, lat - half), lng + half, Math.min(85, lat + half)];
}

/**
 * Aggregate enabled live-track sources into one `Track[]` for the globe overlay.
 * Satellites are propagated client-side every 1.5s (smooth, no rate limit);
 * aircraft/ships are polled (they're inherently snapshots) scoped to the view.
 */
export function useTracks(opts: UseTracksOptions): Track[] {
  const { showSatellites, showAircraft, showShips, satelliteGroup, center, zoom } = opts;
  const [satTracks, setSatTracks] = useState<Track[]>([]);
  const [acTracks, setAcTracks] = useState<Track[]>([]);
  const [shipTracks, setShipTracks] = useState<Track[]>([]);

  // Stable, coarse bbox so small camera nudges don't re-poll.
  const cLng = Math.round(center[0]);
  const cLat = Math.round(center[1]);
  const z = Math.round(zoom);
  const bbox = useMemo(() => cameraBbox(cLng, cLat, z), [cLng, cLat, z]);

  // Satellites: load TLEs on group change, then propagate on a timer.
  const tlesRef = useRef<TleRecord[]>([]);
  useEffect(() => {
    if (!showSatellites) {
      tlesRef.current = [];
      setSatTracks([]);
      return;
    }
    let cancelled = false;
    fetchSatelliteTles(satelliteGroup, 3000).then((t) => {
      if (!cancelled) tlesRef.current = t;
    });
    const tick = () => setSatTracks(propagateAll(tlesRef.current, new Date()).map(satelliteToTrack));
    const iv = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [showSatellites, satelliteGroup]);

  // Aircraft poll (~12s).
  useEffect(() => {
    if (!showAircraft) {
      setAcTracks([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await listAircraft(bbox, 1500);
      if (!cancelled) setAcTracks(r.aircraft.map(aircraftToTrack));
    };
    poll();
    const iv = setInterval(poll, 12000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [showAircraft, bbox]);

  // Ships poll (~30s; each call is a few-second AIS sample).
  useEffect(() => {
    if (!showShips) {
      setShipTracks([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await listShips(bbox);
      if (!cancelled) setShipTracks(r.ships.map(shipToTrack));
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [showShips, bbox]);

  return useMemo(() => [...satTracks, ...acTracks, ...shipTracks], [satTracks, acTracks, shipTracks]);
}
