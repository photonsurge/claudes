"use client";

/**
 * /watch — the clean, full-bleed broadcast globe for the *main* scene, captured
 * for YouTube. Named scenes live at `/watch/:id` (see ./[scene]/page.tsx); both
 * render the shared <WatchSurface>.
 *
 * Cold start: fetch broadcast state + cities + manifest, render, THEN subscribe
 * to CONTROL_STATE (apply via mergeControlState) and WEATHER_RUN / CITIES_UPDATED
 * (refetch manifest / cities). Old textures are kept until new ones load by the
 * Globe's texture cache (no flash).
 */
import { useEffect, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  CONTROL_STATE,
  WEATHER_RUN,
  CITIES_UPDATED,
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  type ControlState,
} from "@photonsurge/shared/control";
import { useSocket } from "../../lib/socket-provider";
import { fetchBroadcastState } from "../../lib/control";
import { fetchManifest } from "../../lib/manifest";
import { listCities, type City } from "../../lib/cities";
import WatchSurface from "../../components/WatchSurface";

export default function WatchPage() {
  const { socket } = useSocket();
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);

  // Cold start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, m, c] = await Promise.all([
        fetchBroadcastState(),
        fetchManifest(),
        listCities(),
      ]);
      if (cancelled) return;
      setState(s);
      setManifest(m);
      setCities(c);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates.
  useEffect(() => {
    if (!socket) return;
    const onState = (patch: Partial<ControlState>) =>
      setState((prev) => mergeControlState(prev, patch ?? {}));
    const onRun = () => fetchManifest().then(setManifest);
    const onCities = () => listCities().then(setCities);

    socket.on(CONTROL_STATE, onState);
    socket.on(WEATHER_RUN, onRun);
    socket.on(CITIES_UPDATED, onCities);
    return () => {
      socket.off(CONTROL_STATE, onState);
      socket.off(WEATHER_RUN, onRun);
      socket.off(CITIES_UPDATED, onCities);
    };
  }, [socket]);

  return <WatchSurface state={state} manifest={manifest} cities={cities} />;
}
