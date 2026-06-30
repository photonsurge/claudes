"use client";

/**
 * /control — operator console: a live globe preview + the full ControlPanel.
 * The operator drives one *scene* at a time (a scene selector at the top of the
 * panel switches target). Every change updates local state, emits SCENE_STATE
 * over the socket, and debounce-persists to /api/scenes/:id. The main scene also
 * fans the legacy CONTROL_STATE so the bare /watch keeps following.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  DEFAULT_CONTROL_STATE,
  MAIN_SCENE_ID,
  WEATHER_RUN,
  mergeControlState,
  type ControlState,
  type SceneMeta,
} from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import { useSocket } from "../../lib/socket-provider";
import { fetchManifest } from "../../lib/manifest";
import { listScenes, fetchSceneState, useSceneEmitter } from "../../lib/scenes";
import { useDirector, useDirectorPatch, eventPulse } from "../../lib/director";
import { listCities, type City } from "../../lib/cities";
import { useTracks } from "../../lib/tracks/useTracks";
import { useAlertFeatures } from "../../lib/alerts-overlay";
import { useQuakes } from "../../lib/seismic-overlay";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";
import ControlPanel from "../../components/ControlPanel";
import DirectorPanel from "../../components/DirectorPanel";
import ViewingOverlay from "../../components/ViewingOverlay";
import AlertLegend from "../../components/AlertLegend";
import { DebugButton } from "../../lib/client/debug";

export default function ControlPage() {
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [sceneId, setSceneId] = useState<string>(MAIN_SCENE_ID);
  const globe = useRef<GlobeHandle | null>(null);
  const emit = useSceneEmitter();
  const { socket } = useSocket();

  // Auto-director: when the selected scene is in auto mode, preview what's going
  // out — fold the current shot's layer/variable patch over the operator's
  // manual baseline (`shown`) and fly the interactive operator camera to each
  // new cut. The interactive globe ignores `state.camera`, so the camera must be
  // driven imperatively via the ref. We re-apply only on a new cut (seq change)
  // so heartbeats don't re-trigger the fly, and the baseline `state` is left
  // untouched so turning Auto off restores the operator's own framing.
  const director = useDirector(sceneId);
  const [cut, setCut] = useState<Segment | null>(null);
  const lastSeq = useRef<number>(-1);
  useEffect(() => {
    if (director?.active && director.segment && director.seq !== lastSeq.current) {
      lastSeq.current = director.seq;
      setCut(director.segment);
      globe.current?.flyTo(director.segment.camera.center, director.segment.camera.zoom);
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

  const { tracks, orbits, trails } = useTracks({
    showSatellites: shown.showSatellites,
    showAircraft: shown.showAircraft,
    showShips: shown.showShips,
    showOrbits: shown.showOrbits,
    showTrails: shown.showTrails,
    trailMinutes: shown.trailMinutes,
    satelliteGroup: shown.satelliteGroup,
    center: shown.camera.center,
    zoom: shown.camera.zoom,
  });
  const alerts = useAlertFeatures(shown.showAlerts, shown.alertSeverityMin);
  const quakes = useQuakes(shown.showSeismic, shown.seismicMinMag);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, m, c, sc] = await Promise.all([
        fetchSceneState(MAIN_SCENE_ID),
        fetchManifest(),
        listCities(),
        listScenes(),
      ]);
      if (cancelled) return;
      setState(s);
      setManifest(m);
      setCities(c);
      setScenes(sc);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refetch the manifest when the worker publishes a new run (e.g. after an
  // ingest/reingest) so the operator console doesn't sit on stale/blank data.
  useEffect(() => {
    if (!socket) return;
    const onRun = () => fetchManifest().then(setManifest);
    socket.on(WEATHER_RUN, onRun);
    return () => {
      socket.off(WEATHER_RUN, onRun);
    };
  }, [socket]);

  // Apply a state change to the active scene: local + live emit + persist.
  const apply = (next: ControlState) => {
    setState(next);
    emit(sceneId, next);
  };

  // Switch the scene the operator is driving; load that scene's persisted state.
  const switchScene = async (id: string) => {
    setSceneId(id);
    const next = await fetchSceneState(id);
    setState(next);
  };

  return (
    <main style={{ display: "flex", height: "100vh", background: "#0a0e16", color: "#fff" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <GlobeView
          ref={globe}
          state={shown}
          manifest={manifest}
          cities={cities}
          tracks={tracks}
          orbits={orbits}
          trails={trails}
          alerts={alerts}
          quakes={quakes}
          interactive
          pulseAt={eventPulse(director)}
          // While a director cut is on air it owns the camera (imperative flyTo);
          // don't persist those frames or the operator's manual baseline drifts.
          onCameraChange={(center, zoom) => {
            if (cut) return;
            apply({ ...state, camera: { center, zoom } });
          }}
        />
        {shown.showAlerts || shown.showSeismic ? (
          <AlertLegend alerts={alerts} quakes={quakes} />
        ) : null}
        {director?.active && director.segment ? (
          <ViewingOverlay
            segment={director.segment}
            variable={shown.activeVariable}
            state={shown}
            upNext={director.upNext}
            lastShownAt={director.lastShownAt}
            timesShown={director.timesShown}
            draggable
          />
        ) : null}
      </div>
      <aside
        style={{
          width: 360,
          padding: 20,
          overflowY: "auto",
          borderLeft: "1px solid #1b2030",
          background: "#0c111c",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Operator</h2>
            <select
              aria-label="Scene"
              value={sceneId}
              onChange={(e) => switchScene(e.target.value)}
              style={{
                background: "#0a0e16",
                color: "#fff",
                border: "1px solid #2a3344",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 13,
              }}
            >
              {scenes.length === 0 && <option value={MAIN_SCENE_ID}>Main</option>}
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <DebugButton
            title="State"
            tooltip="Inspect live control state, tracks & overlays"
            data={{
              state,
              counts: {
                tracks: tracks.length,
                orbits: orbits.length,
                alerts: alerts.length,
                quakes: quakes.length,
                cities: cities.length,
              },
              manifestLoaded: manifest !== null,
            }}
          />
        </div>
        <DirectorPanel sceneId={sceneId} />
        <ControlPanel
          state={state}
          manifest={manifest}
          onChange={apply}
          // Flying to a place means "look here" — stop the idle spin first so it
          // doesn't drag the globe back to the old anchor when the flight lands.
          onFitBounds={(bbox) => {
            if (state.autoSpin) apply({ ...state, autoSpin: false });
            globe.current?.fitBounds(bbox);
          }}
          onFlyTo={(center, zoom) => {
            if (state.autoSpin) apply({ ...state, autoSpin: false });
            globe.current?.flyTo(center, zoom);
          }}
        />
      </aside>
    </main>
  );
}
