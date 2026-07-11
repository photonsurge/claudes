"use client";

import { useEffect, useState } from "react";
import { listQuakes } from "./tracks/client";
import type { Quake } from "./tracks/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";

/**
 * Poll worker-cached USGS earthquakes for the globe overlay. Quakes are
 * point-in-time events (no dead reckoning). The worker emits TRACKS_UPDATED
 * (kind:"seismic") after each snapshot, so we refetch the instant a feed lands;
 * the interval is a fallback if the socket is down.
 */
/** Socket-down fallback cadence — TRACKS_UPDATED:seismic is the primary trigger;
 *  NOT the old 120s re-poll. */
const QUAKE_FALLBACK_MS = 5 * 60 * 1000;

export function useQuakes(enabled: boolean, minMag: number): Quake[] {
  const [quakes, setQuakes] = useState<Quake[]>([]);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (p?: { kind?: string }) => {
      if (!p || p.kind === "seismic") setLiveTick((n) => n + 1);
    };
    socket.on(TRACKS_UPDATED, onUpdated);
    return () => {
      socket.off(TRACKS_UPDATED, onUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      setQuakes([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const r = await listQuakes(undefined, minMag);
      if (!cancelled) setQuakes(r.quakes);
    };
    poll();
    const iv = setInterval(poll, QUAKE_FALLBACK_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, minMag, liveTick]);

  return quakes;
}
