"use client";

import { useEffect, useMemo, useState } from "react";
import { listQuakes } from "./tracks/client";
import type { Quake } from "./tracks/types";
import { useSocket } from "./socket-provider";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { useFocusAreaQuakes, useFocusTarget } from "./focus/focus-client";
import type { FocusTarget } from "./focus/types";

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
      // Share world-watch's canonical `/api/tracks/seismic` (all quakes) Redis
      // entry instead of a separate ?minMag= query — one of the two fetches
      // becomes a cache hit. Apply the operator's magnitude floor client-side, so
      // changing it filters instantly instead of refetching.
      const r = await listQuakes();
      if (!cancelled) setQuakes(r.quakes.filter((q) => q.mag >= minMag));
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

/**
 * Union the global live feed with the on-air event's own quakes.
 *
 * The feed is clipped to the live window (QUAKE_LIVE_WINDOW_HOURS, applied
 * server-side) so a month of retained upserts stops smearing the plate
 * boundaries into a solid band. That clip must not reach the shot the show is
 * actually presenting, so the focus bundle's un-windowed `target` + `areaQuakes`
 * are merged back in: a week-old M7 keeps its epicentre AND its local aftershock
 * swarm while everywhere else stays clean.
 *
 * The operator's magnitude floor still governs the swarm — a floor set to keep
 * the globe quiet shouldn't be undone by proximity to the cut. The TARGET is the
 * one thing exempt from both window and floor: if the broadcast is talking about
 * it, it is on screen.
 */
export function mergeOnAirQuakes(
  live: Quake[],
  target: FocusTarget,
  areaQuakes: Quake[],
  minMag: number,
): Quake[] {
  const targetQuake = target?.kind === "quake" ? target.quake : null;
  const extras = areaQuakes.filter((q) => q.mag >= minMag);
  if (!targetQuake && !extras.length) return live;

  const seen = new Set(live.map((q) => q.id));
  const out = live.slice();
  for (const q of extras) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  if (targetQuake && !seen.has(targetQuake.id)) out.push(targetQuake);
  return out;
}

/**
 * `useQuakes` plus the on-air exception — what every broadcast surface should
 * render. Split from the fetch hook so the merge stays pure and testable.
 */
export function useBroadcastQuakes(enabled: boolean, minMag: number): Quake[] {
  const live = useQuakes(enabled, minMag);
  const target = useFocusTarget();
  const areaQuakes = useFocusAreaQuakes();
  return useMemo(
    () => (enabled ? mergeOnAirQuakes(live, target, areaQuakes, minMag) : live),
    [enabled, live, target, areaQuakes, minMag],
  );
}
