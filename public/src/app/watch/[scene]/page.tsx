"use client";

/**
 * /watch/:scene — the clean broadcast globe for a *named scene*, intended as an
 * OBS browser source or an overlay window. Live control state comes from the
 * scene-scoped socket channel (useSceneState); manifest + cities are shared
 * globally and refetched on WEATHER_RUN / CITIES_UPDATED. The bare `/watch`
 * (main scene) lives in ../page.tsx; both render the shared <WatchSurface>.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { WEATHER_RUN, CITIES_UPDATED, mergeControlState } from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import { useSocket } from "../../../lib/socket-provider";
import { MANIFEST_POLL_MS, fetchManifest, pickManifest } from "../../../lib/manifest";
import { useStableJson } from "../../../lib/use-stable";

/** Stable "no up-next" so an idle director doesn't mint a fresh [] per beat. */
const NO_UP_NEXT: never[] = [];
import { listCities, type City } from "../../../lib/cities";
import { useRegionCities } from "../../../lib/useRegionCities";
import { useSceneState, listScenes } from "../../../lib/scenes";
import { retryUntil } from "../../../lib/retry";
import { cutMapTypeIds, useDirector, useDirectorConfig, useDirectorCut, useEventPulse, activeCountryIso, activeRegionBbox } from "../../../lib/director";
import WatchSurface from "../../../components/WatchSurface";
import { useViewerState } from "../../../lib/viewer";
import ViewingOverlay from "../../../components/ViewingOverlay";
import { UI_SANS } from "../../../lib/fonts";
import { useSurfaceRedirect } from "../../../lib/crossword";

function SceneWatchPageInner() {
  const params = useParams<{ scene: string }>();
  const token = useSearchParams().get("token") ?? undefined;
  const sceneId = useMemo(() => {
    const s = params?.scene;
    return decodeURIComponent(Array.isArray(s) ? s[0] : s ?? "");
  }, [params]);

  const { socket } = useSocket();
  const { state, tokenError } = useSceneState(sceneId, token);
  const redirecting = useSurfaceRedirect(sceneId, "globe");
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [sceneName, setSceneName] = useState<string | undefined>(undefined);

  // Auto-director: when this scene is in "auto", fold the current shot's
  // camera + layer patch over the scene's manual baseline. We only re-apply on a
  // new cut (seq change) so heartbeats don't retrigger the camera fly.
  const director = useDirector(sceneId);
  // Viewers' chat picks (music, palette), layered over the channel by WatchSurface.
  const viewer = useViewerState(sceneId, token);
  // Read-only here — this page never edits the director config, just respects
  // the operator's enabled map-type tours (e.g. which basemaps a quake cycles through).
  const { config: directorConfig } = useDirectorConfig(sceneId);
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

  const { patch: cutPatch, segment: onAir, focus } = useDirectorCut(
    cut,
    manifest,
    cutMapTypeIds(cut, directorConfig),
  );
  const shown = useMemo(
    () => (cutPatch ? mergeControlState(state, cutPatch) : state),
    [state, cutPatch],
  );
  // Layers in extra local cities once a director cut zooms into a region — the
  // base `cities` fetch stays a fixed, bounded world set.
  const shownCities = useRegionCities(cities, shown.camera.center, shown.camera.zoom);
  // Name of the on-air kind's active saved slide, if the operator loaded one.
  const slideName = useMemo(() => {
    if (!onAir) return undefined;
    const id = directorConfig.activeSlideId[onAir.kind];
    return directorConfig.kindSlides[onAir.kind]?.find((s) => s.id === id)?.name;
  }, [directorConfig, onAir]);

  // Director-derived props for the surface, identity-stable while their VALUE
  // is unchanged: every director heartbeat re-renders this page, and fresh
  // little arrays here would defeat the memoised WatchSurface below (the whole
  // broadcast chrome would re-diff its thousands of inline styles per beat).
  const pulseAt = useStableJson(useEventPulse(director));
  const glowRegionBbox = useStableJson(activeRegionBbox(director, shown.camera));
  const upNext = useStableJson(director?.active ? director.upNext : NO_UP_NEXT);

  // Cold start the globally-shared data + resolve this scene's display name.
  // Retried until the manifest lands: this page runs unattended inside OBS
  // browser sources, and a cold start that hits a deploy/restart window (fetch
  // rejected, or a 5xx that fetchManifest reports as null) would otherwise
  // strand the stream on the loading screen until a human refreshes.
  useEffect(
    () =>
      retryUntil(
        async () => {
          const [m, c, scenes] = await Promise.all([fetchManifest(), listCities(), listScenes()]);
          return m ? { m, c, scenes } : null;
        },
        ({ m, c, scenes }) => {
          setManifest(m);
          setCities(c);
          setSceneName(scenes.find((s) => s.id === sceneId)?.name);
        },
      ),
    [sceneId],
  );

  // Refetch shared data when the worker publishes new runs / cities. Fail soft
  // here — data is already on screen, so a blip must keep the last good value
  // (fetchManifest resolves null on a 5xx; listCities fails soft to []).
  useEffect(() => {
    if (!socket) return;
    const onRun = () =>
      fetchManifest()
        // Keep the previous object when the run renders identically: WEATHER_RUN
        // fires far more often than the data changes, and `manifest` identity
        // drives Globe's whole weather-layer rebuild.
        .then((m) => setManifest((prev) => pickManifest(prev, m)))
        .catch(() => {});
    const onCities = () => listCities().then((c) => (c.length ? setCities(c) : undefined));
    socket.on(WEATHER_RUN, onRun);
    socket.on(CITIES_UPDATED, onCities);
    // Backstop: a missed WEATHER_RUN would otherwise strand the page on the
    // maps it started with for the rest of the broadcast.
    const manifestPoll = setInterval(onRun, MANIFEST_POLL_MS);
    return () => {
      clearInterval(manifestPoll);
      socket.off(WEATHER_RUN, onRun);
      socket.off(CITIES_UPDATED, onCities);
    };
  }, [socket]);

  // A crossword channel opened here goes to /watch/crossword/:scene.
  if (redirecting) return null;

  if (tokenError) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#8b95a7",
          fontFamily: UI_SANS,
          fontSize: 14,
        }}
      >
        Invalid or missing watch token.
      </main>
    );
  }

  return (
    <>
      <WatchSurface
        state={shown}
        manifest={manifest}
        cities={shownCities}
        sceneName={sceneName}
        pulseAt={pulseAt}
        glowCountryIso={activeCountryIso(director, shown.camera.center)}
        glowRegionBbox={glowRegionBbox}
        onAirSegment={director?.active ? onAir : null}
        focusCaption={director?.active ? focus : null}
        upNext={upNext}
        nextCutAt={director?.active ? director.endsAt : null}
        slideName={director?.active ? slideName : undefined}
        alertCycleSeconds={directorConfig.alertCycleSeconds}
        directorOn={!!director?.active}
        viewer={viewer}
      />
      {/* Chrome-on: the on-air detail lives in the event reticle, so the separate
          lower-left card is suppressed to avoid duplication. */}
      {director?.active && onAir && !shown.showBroadcastChrome ? (
        <ViewingOverlay
          segment={onAir}
          variable={shown.activeVariable}
          state={shown}
          upNext={director.upNext}
          manifest={manifest}
        />
      ) : null}
    </>
  );
}

export default function SceneWatchPage() {
  return (
    <Suspense fallback={null}>
      <SceneWatchPageInner />
    </Suspense>
  );
}
