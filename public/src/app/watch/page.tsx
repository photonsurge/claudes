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
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  CONTROL_STATE,
  WEATHER_RUN,
  CITIES_UPDATED,
  DEFAULT_CONTROL_STATE,
  MAIN_SCENE_ID,
  mergeControlState,
  type ControlState,
} from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import { useSocket } from "../../lib/socket-provider";
import { loadBroadcastState } from "../../lib/control";
import { useLoadAndResync } from "../../lib/use-resync";
import { MANIFEST_POLL_MS, fetchManifest, pickManifest } from "../../lib/manifest";
import { useStableJson } from "../../lib/use-stable";

/** Stable "no up-next" so an idle director doesn't mint a fresh [] per beat. */
const NO_UP_NEXT: never[] = [];
import { listCities, type City } from "../../lib/cities";
import { retryUntil } from "../../lib/retry";
import { useRegionCities } from "../../lib/useRegionCities";
import { useDirector, useDirectorConfig, useDirectorCut, useEventPulse, activeCountryIso, activeRegionBbox } from "../../lib/director";
import WatchSurface from "../../components/WatchSurface";
import { useViewerState } from "../../lib/viewer";
import ViewingOverlay from "../../components/ViewingOverlay";
import { UI_SANS } from "../../lib/fonts";

function WatchPageInner() {
  const token = useSearchParams().get("token") ?? undefined;
  const { socket } = useSocket();
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [tokenError, setTokenError] = useState(false);

  // Auto-director: the main scene ("default") is directed by the worker. Fold the
  // current shot's camera + layer patch over the operator baseline, re-applying
  // only on a new cut (seq change) so heartbeats don't restart the camera fly.
  const director = useDirector(MAIN_SCENE_ID);
  // Viewers' chat picks (music, palette), layered over the channel by WatchSurface.
  const viewer = useViewerState(MAIN_SCENE_ID);
  // Read-only here — /watch never edits the director config, just respects the
  // operator's enabled map-type tours (e.g. which basemaps a quake cycles through).
  const { config: directorConfig } = useDirectorConfig(MAIN_SCENE_ID);
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

  // The current shot's look + its map-type-relabelled segment (global spins retitle
  // per map type as they tour — "Global Temperature" → "Aurora & Space Weather" …).
  const { patch: cutPatch, segment: onAir, focus } = useDirectorCut(
    cut,
    manifest,
    cut ? directorConfig.mapTypes[cut.kind] : undefined,
  );
  const shown = useMemo(
    () => (cutPatch ? mergeControlState(state, cutPatch) : state),
    [state, cutPatch],
  );
  // Layers in extra local cities once a director cut (or the operator) zooms
  // into a region — the base `cities` fetch stays a fixed, bounded world set.
  const shownCities = useRegionCities(cities, shown.camera.center, shown.camera.zoom);
  // Name of the on-air kind's active saved slide, if the operator loaded one.
  const slideName = useMemo(() => {
    if (!onAir) return undefined;
    const id = directorConfig.activeSlideId[onAir.kind];
    return directorConfig.kindSlides[onAir.kind]?.find((s) => s.id === id)?.name;
  }, [directorConfig, onAir]);

  // Director-derived props for the surface, identity-stable while their VALUE
  // is unchanged: every director heartbeat re-renders this page, and fresh
  // little arrays here would defeat the memoised WatchSurface below.
  const pulseAt = useStableJson(useEventPulse(director));
  const glowRegionBbox = useStableJson(activeRegionBbox(director, shown.camera));
  const upNext = useStableJson(director?.active ? director.upNext : NO_UP_NEXT);

  // Cold start. Both the broadcast state and the manifest are retried until
  // they land: this page runs unattended inside OBS browser sources, and a cold
  // start lost to a deploy/restart window (fetch rejected, or a 5xx) would
  // otherwise strand the stream on the loading screen — or, for the state, on
  // DEFAULT_CONTROL_STATE with the audio bed off — until a human refreshes.
  // The state is also re-fetched on every socket (re)connect (use-resync.ts).
  useLoadAndResync(
    socket,
    () => loadBroadcastState(token),
    ({ state: s, tokenError: te }) => {
      setState(s);
      setTokenError(te);
    },
    [token],
  );
  useEffect(() => {
    const stop = retryUntil(
      async () => {
        const [m, c] = await Promise.all([fetchManifest(), listCities()]);
        return m ? { m, c } : null;
      },
      ({ m, c }) => {
        setManifest(m);
        setCities(c);
      },
    );
    return stop;
  }, []);

  // Live updates. The refetches fail soft — data is already on screen, so a
  // blip keeps the last good value rather than blanking it.
  useEffect(() => {
    if (!socket) return;
    const onState = (patch: Partial<ControlState>) =>
      setState((prev) => mergeControlState(prev, patch ?? {}));
    const onRun = () =>
      fetchManifest()
        // Keep the previous object when the run renders identically: WEATHER_RUN
        // fires far more often than the data changes, and `manifest` identity
        // drives Globe's whole weather-layer rebuild.
        .then((m) => setManifest((prev) => pickManifest(prev, m)))
        .catch(() => {});
    const onCities = () => listCities().then((c) => (c.length ? setCities(c) : undefined));

    socket.on(CONTROL_STATE, onState);
    socket.on(WEATHER_RUN, onRun);
    // Backstop: a missed WEATHER_RUN would otherwise strand the page on the
    // maps it started with for the rest of the broadcast.
    const manifestPoll = setInterval(onRun, MANIFEST_POLL_MS);
    socket.on(CITIES_UPDATED, onCities);
    return () => {
      clearInterval(manifestPoll);
      socket.off(CONTROL_STATE, onState);
      socket.off(WEATHER_RUN, onRun);
      socket.off(CITIES_UPDATED, onCities);
    };
  }, [socket]);

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
      {/* When the broadcast chrome is on, the on-air detail lives inside the event
          reticle, so the separate lower-left card is suppressed to avoid duplication. */}
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

export default function WatchPage() {
  return (
    <Suspense fallback={null}>
      <WatchPageInner />
    </Suspense>
  );
}
