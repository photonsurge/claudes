"use client";

import { useEffect, useState } from "react";
import { listAlerts } from "./alerts";
import { listQuakes } from "./tracks/client";
import {
  worldWatchSummary,
  worldWatchFeed,
  type WorldSummary,
  type WorldWatchItem,
} from "./broadcast";
import { useSocket } from "./socket-provider";
import { ALERTS_UPDATED, TRACKS_UPDATED } from "@photonsurge/shared/control";

/** The summary tally plus the full scrolling feed of individual alerts + quakes. */
export interface WorldWatchState extends WorldSummary {
  feed: WorldWatchItem[];
}

const EMPTY: WorldWatchState = {
  alertTotal: 0,
  bySeverity: [],
  quakeCount: 0,
  maxMag: 0,
  maxQuake: null,
  feed: [],
};

/**
 * The whole-planet alert + seismic tally behind the always-on WORLD WATCH panel.
 * Deliberately independent of the operator's showAlerts/showSeismic toggles and
 * the camera bbox — this is a global situation summary that stays on screen no
 * matter what the map is currently showing. We refetch on the same socket beats
 * the overlays use (ALERTS_UPDATED / TRACKS_UPDATED:seismic); the interval is a
 * fallback if the socket is down. All active alerts (every severity) are pulled
 * so the counts are honest; quakes come from the USGS feed's ~24h window.
 */
export function useWorldWatch(): WorldWatchState {
  const [summary, setSummary] = useState<WorldWatchState>(EMPTY);
  const { socket } = useSocket();
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const onAlerts = () => setLiveTick((n) => n + 1);
    const onTracks = (p?: { kind?: string }) => {
      if (!p || p.kind === "seismic") setLiveTick((n) => n + 1);
    };
    socket.on(ALERTS_UPDATED, onAlerts);
    socket.on(TRACKS_UPDATED, onTracks);
    return () => {
      socket.off(ALERTS_UPDATED, onAlerts);
      socket.off(TRACKS_UPDATED, onTracks);
    };
  }, [socket]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const [alerts, quakesRes] = await Promise.all([
        listAlerts({ activeOnly: true, severityMin: 0, limit: 5000 }),
        listQuakes(),
      ]);
      if (cancelled) return;
      setSummary({
        ...worldWatchSummary(alerts, quakesRes.quakes),
        feed: worldWatchFeed(alerts, quakesRes.quakes),
      });
    };
    poll();
    const iv = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [liveTick]);

  return summary;
}
