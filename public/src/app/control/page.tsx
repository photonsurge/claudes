"use client";

/**
 * /control — operator console: a live globe preview + the full ControlPanel.
 * The operator drives one *scene* at a time (a scene selector at the top of the
 * panel switches target). Every change updates local state, emits SCENE_STATE
 * over the socket, and debounce-persists to /api/scenes/:id. The main scene also
 * fans the legacy CONTROL_STATE so the bare /watch keeps following.
 */
import { useEffect, useRef, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  DEFAULT_CONTROL_STATE,
  MAIN_SCENE_ID,
  type ControlState,
  type SceneMeta,
} from "@photonsurge/shared/control";
import { fetchManifest } from "../../lib/manifest";
import { listScenes, fetchSceneState, useSceneEmitter } from "../../lib/scenes";
import { listCities, type City } from "../../lib/cities";
import { useTracks } from "../../lib/tracks/useTracks";
import { useAlertFeatures } from "../../lib/alerts-overlay";
import { useQuakes } from "../../lib/seismic-overlay";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";
import ControlPanel from "../../components/ControlPanel";
import DirectorPanel from "../../components/DirectorPanel";
import { DebugButton } from "../../lib/client/debug";

export default function ControlPage() {
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [sceneId, setSceneId] = useState<string>(MAIN_SCENE_ID);
  const globe = useRef<GlobeHandle | null>(null);
  const emit = useSceneEmitter();

  const { tracks, orbits, trails } = useTracks({
    showSatellites: state.showSatellites,
    showAircraft: state.showAircraft,
    showShips: state.showShips,
    showOrbits: state.showOrbits,
    showTrails: state.showTrails,
    trailMinutes: state.trailMinutes,
    satelliteGroup: state.satelliteGroup,
    center: state.camera.center,
    zoom: state.camera.zoom,
  });
  const alerts = useAlertFeatures(state.showAlerts, state.alertSeverityMin);
  const quakes = useQuakes(state.showSeismic, state.seismicMinMag);

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
          state={state}
          manifest={manifest}
          cities={cities}
          tracks={tracks}
          orbits={orbits}
          trails={trails}
          alerts={alerts}
          quakes={quakes}
          interactive
          onCameraChange={(center, zoom) => apply({ ...state, camera: { center, zoom } })}
        />
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
