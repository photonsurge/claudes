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

/**
 * The scrolling ACTIVE FEED (individual event rows) only ever names events
 * worth broadcasting: Severe/Extreme alerts (rank >= 3 — no Moderate or below)
 * and "decent" quakes (M4.5+, the usual widely-felt / significant threshold).
 * The tally (stat tiles, severity/magnitude breakdown, continent bars) is NOT
 * floored — it fetches everything so "how much lesser stuff is out there"
 * actually shows, it's just the named-event crawl that stays curated.
 */
const MIN_ALERT_SEVERITY = 3; // 0 None · 1 Minor · 2 Moderate · 3 Severe · 4 Extreme
const MIN_QUAKE_MAG = 4.5;

const EMPTY: WorldWatchState = {
  alertTotal: 0,
  bySeverity: [],
  quakeCount: 0,
  byMagClass: [],
  maxMag: 0,
  maxQuake: null,
  byContinent: [],
  feed: [],
};

/**
 * The whole-planet alert + seismic tally behind the always-on WORLD WATCH panel.
 * Deliberately independent of the operator's showAlerts/showSeismic toggles and
 * the camera bbox — this is a global situation summary that stays on screen no
 * matter what the map is currently showing. We refetch on the same socket beats
 * the overlays use (ALERTS_UPDATED / TRACKS_UPDATED:seismic); the interval is a
 * fallback if the socket is down. The tally fetches every active alert and every
 * cached quake (no severity/magnitude floor) so the full picture — down to
 * Minor alerts and M2.5+ quakes — shows in the stat tiles and continent bars;
 * only the scrolling ACTIVE FEED narrows back down to broadcast-worthy events
 * (see MIN_ALERT_SEVERITY / MIN_QUAKE_MAG).
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
        listAlerts({ activeOnly: true, limit: 5000 }),
        listQuakes(),
      ]);
      if (cancelled) return;
      const feedAlerts = alerts.filter((a) => a.maxSeverityRank >= MIN_ALERT_SEVERITY);
      const feedQuakes = quakesRes.quakes.filter((q) => q.mag >= MIN_QUAKE_MAG);
      setSummary({
        ...worldWatchSummary(alerts, quakesRes.quakes),
        feed: worldWatchFeed(feedAlerts, feedQuakes),
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
