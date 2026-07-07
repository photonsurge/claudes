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
import { fetchBroadcastState } from "../../lib/control";
import { fetchManifest } from "../../lib/manifest";
import { listCities, type City } from "../../lib/cities";
import { useRegionCities } from "../../lib/useRegionCities";
import { useDirector, useDirectorConfig, useDirectorCut, eventPulse, activeCountryIso, activeRegionBbox } from "../../lib/director";
import WatchSurface from "../../components/WatchSurface";
import ViewingOverlay from "../../components/ViewingOverlay";

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
  const { patch: cutPatch, segment: onAir } = useDirectorCut(
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

  // Cold start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ state: s, tokenError: te }, m, c] = await Promise.all([
        fetchBroadcastState(token),
        fetchManifest(),
        listCities(),
      ]);
      if (cancelled) return;
      setState(s);
      setTokenError(te);
      setManifest(m);
      setCities(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
          fontFamily: "system-ui, sans-serif",
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
        pulseAt={eventPulse(director)}
        glowCountryIso={activeCountryIso(director, shown.camera.center)}
        glowRegionBbox={activeRegionBbox(director, shown.camera)}
        onAirSegment={director?.active ? onAir : null}
        upNext={director?.active ? director.upNext : []}
        slideName={director?.active ? slideName : undefined}
      />
      {/* When the broadcast chrome is on, the on-air detail lives inside the event
          reticle, so the separate lower-left card is suppressed to avoid duplication. */}
      {director?.active && onAir && !shown.showBroadcastChrome ? (
        <ViewingOverlay
          segment={onAir}
          variable={shown.activeVariable}
          state={shown}
          upNext={director.upNext}
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
