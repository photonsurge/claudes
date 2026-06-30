"use client";

/**
 * /watch/:scene — the clean broadcast globe for a *named scene*, intended as an
 * OBS browser source or an overlay window. Live control state comes from the
 * scene-scoped socket channel (useSceneState); manifest + cities are shared
 * globally and refetched on WEATHER_RUN / CITIES_UPDATED. The bare `/watch`
 * (main scene) lives in ../page.tsx; both render the shared <WatchSurface>.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { WEATHER_RUN, CITIES_UPDATED, mergeControlState } from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import { useSocket } from "../../../lib/socket-provider";
import { fetchManifest } from "../../../lib/manifest";
import { listCities, type City } from "../../../lib/cities";
import { useSceneState, listScenes } from "../../../lib/scenes";
import { useDirector, useDirectorPatch, eventPulse } from "../../../lib/director";
import WatchSurface from "../../../components/WatchSurface";
import ViewingOverlay from "../../../components/ViewingOverlay";

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

  // Auto-director: when this scene is in "auto", fold the current shot's
  // camera + layer patch over the scene's manual baseline. We only re-apply on a
  // new cut (seq change) so heartbeats don't retrigger the camera fly.
  const director = useDirector(sceneId);
  const [cut, setCut] = useState<Segment | null>(null);
  const lastSeq = useRef<number>(-1);
  useEffect(() => {
    if (director?.active && director.segment && director.seq !== lastSeq.current) {
      lastSeq.current = director.seq;
      setCut(director.segment);
    } else if (!director?.active && lastSeq.current !== -1) {
      lastSeq.current = -1;
      setCut(null);
    }
  }, [director?.seq, director?.active, director?.segment]);

  const cutPatch = useDirectorPatch(cut);
  const shown = useMemo(
    () => (cutPatch ? mergeControlState(state, cutPatch) : state),
    [state, cutPatch],
  );

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

  return (
    <>
      <WatchSurface state={shown} manifest={manifest} cities={cities} sceneName={sceneName} pulseAt={eventPulse(director)} />
      {director?.active && director.segment ? (
        <ViewingOverlay
          segment={director.segment}
          variable={shown.activeVariable}
          state={shown}
          upNext={director.upNext}
        />
      ) : null}
    </>
  );
}
