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
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useDirector, useDirectorPatch } from "../../lib/director";
import WatchSurface from "../../components/WatchSurface";
import ViewingOverlay from "../../components/ViewingOverlay";

export default function WatchPage() {
  const { socket } = useSocket();
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);

  // Auto-director: the main scene ("default") is directed by the worker. Fold the
  // current shot's camera + layer patch over the operator baseline, re-applying
  // only on a new cut (seq change) so heartbeats don't restart the camera fly.
  const director = useDirector(MAIN_SCENE_ID);
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

  return (
    <>
      <WatchSurface state={shown} manifest={manifest} cities={cities} />
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
