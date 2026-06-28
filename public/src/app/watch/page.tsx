"use client";

/**
 * /watch — the clean, full-bleed broadcast globe captured for YouTube. No chrome
 * beyond a small run/attribution label.
 *
 * Cold start: fetch broadcast state + cities + manifest, render, THEN subscribe
 * to CONTROL_STATE (apply via mergeControlState) and WEATHER_RUN / CITIES_UPDATED
 * (refetch manifest / cities). Old textures are kept until new ones load by the
 * Globe's texture cache (no flash).
 */
import { useEffect, useRef, useState } from "react";
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
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";

export default function WatchPage() {
  const { socket } = useSocket();
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [ready, setReady] = useState(false);
  const globe = useRef<GlobeHandle | null>(null);

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
      setReady(true);
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

  // Apply operator camera changes to the map.
  useEffect(() => {
    if (ready) globe.current?.flyTo(state.camera.center, state.camera.zoom);
  }, [ready, state.camera.center, state.camera.zoom]);

  return (
    <main style={{ position: "fixed", inset: 0, background: "#0a0e16", overflow: "hidden" }}>
      <GlobeView ref={globe} state={state} manifest={manifest} cities={cities} interactive={false} />
      <div
        style={{
          position: "absolute",
          left: 16,
          bottom: 16,
          color: "rgba(255,255,255,0.85)",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          pointerEvents: "none",
        }}
      >
        {manifest ? (
          <>
            {manifest.model.toUpperCase()} · run {new Date(manifest.run).toUTCString()}
          </>
        ) : (
          "Awaiting weather data…"
        )}
      </div>
    </main>
  );
}
