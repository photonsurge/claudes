"use client";

/**
 * /watch/:scene — the clean broadcast globe for a *named scene*, intended as an
 * OBS browser source or an overlay window. Live control state comes from the
 * scene-scoped socket channel (useSceneState); manifest + cities are shared
 * globally and refetched on WEATHER_RUN / CITIES_UPDATED. The bare `/watch`
 * (main scene) lives in ../page.tsx; both render the shared <WatchSurface>.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { WEATHER_RUN, CITIES_UPDATED } from "@photonsurge/shared/control";
import { useSocket } from "../../../lib/socket-provider";
import { fetchManifest } from "../../../lib/manifest";
import { listCities, type City } from "../../../lib/cities";
import { useSceneState, listScenes } from "../../../lib/scenes";
import WatchSurface from "../../../components/WatchSurface";

export default function SceneWatchPage() {
  const params = useParams<{ scene: string }>();
  const sceneId = useMemo(() => {
    const s = params?.scene;
    return decodeURIComponent(Array.isArray(s) ? s[0] : s ?? "");
  }, [params]);

  const { socket } = useSocket();
  const { state } = useSceneState(sceneId);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [sceneName, setSceneName] = useState<string | undefined>(undefined);

  // Cold start the globally-shared data + resolve this scene's display name.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, c, scenes] = await Promise.all([fetchManifest(), listCities(), listScenes()]);
      if (cancelled) return;
      setManifest(m);
      setCities(c);
      setSceneName(scenes.find((s) => s.id === sceneId)?.name);
    })();
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  // Refetch shared data when the worker publishes new runs / cities.
  useEffect(() => {
    if (!socket) return;
    const onRun = () => fetchManifest().then(setManifest);
    const onCities = () => listCities().then(setCities);
    socket.on(WEATHER_RUN, onRun);
    socket.on(CITIES_UPDATED, onCities);
    return () => {
      socket.off(WEATHER_RUN, onRun);
      socket.off(CITIES_UPDATED, onCities);
    };
  }, [socket]);

  return <WatchSurface state={state} manifest={manifest} cities={cities} sceneName={sceneName} />;
}
