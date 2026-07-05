"use client";

import { useEffect, useState } from "react";
import { getTideStations } from "./tracks/client";
import type { TideStationReading } from "./tides/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/** How often the gauge switches which nearby station is "active". */
const CYCLE_MS = 8000;

export interface TideGauge {
  /** Nearby cached gauges, nearest first. Empty when none are in range. */
  stations: TideStationReading[];
  /** Which entry of `stations` is currently "on air" in the panel. */
  active: TideStationReading | null;
}

/**
 * Fetch the worker-cached sea-level series for the tide gauges nearest an
 * on-air point ([lng,lat]), and cycle which one is "active" — mirrors
 * useSeismoGauge. Returns `stations: []` when disabled, no point, or nothing
 * in range — callers then hide. The worker emits TRACKS_UPDATED
 * (kind:"tides") after each snapshot, so we refetch the instant fresh
 * samples land; the interval is a fallback if the socket is down.
 */
export function useTideGauge(center: [number, number] | null, enabled = true): TideGauge {
  const [stations, setStations] = useState<TideStationReading[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  const lng = center?.[0];
  const lat = center?.[1];

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (!p || p.kind === "tides") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled || lat == null || lng == null) {
      setStations([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await getTideStations(lat, lng);
      if (!cancelled) setStations(r.stations);
    };
    poll();
    const iv = setInterval(poll, 120000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, lat, lng, liveTick]);

  // Cycle the active station on a timer; reset to 0 whenever the set changes
  // shape so a shrinking list can't leave the index pointing past the end.
  useEffect(() => {
    setActiveIdx(0);
    if (stations.length < 2) return;
    const iv = setInterval(() => setActiveIdx((i) => (i + 1) % stations.length), CYCLE_MS);
    return () => clearInterval(iv);
  }, [stations.length]);

  return { stations, active: stations[activeIdx] ?? null };
}
