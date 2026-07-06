"use client";

/**
 * /sandbox — a private, detached operator console. Same interactive globe + full
 * ControlPanel as /control, but nothing it does reaches the broadcast: every
 * change stays local (no SCENE_STATE / CONTROL_STATE emit, no persist). It
 * cold-starts from the main scene so it opens on whatever's currently on air,
 * then freewheels — a `/watch` you can fuck about with without touching the
 * stream. Live *data* still refreshes exactly like `/watch` (new weather runs,
 * cities, and every self-polling overlay hook); only the *view* controls are
 * yours. See [[scenes-architecture]].
 */
import { useEffect, useRef, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import {
  DEFAULT_CONTROL_STATE,
  MAIN_SCENE_ID,
  WEATHER_RUN,
  CITIES_UPDATED,
  type ControlState,
} from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import { useSocket } from "../../lib/socket-provider";
import { fetchManifest } from "../../lib/manifest";
import { fetchSceneState } from "../../lib/scenes";
import { listCities, type City } from "../../lib/cities";
import { useRegionCities } from "../../lib/useRegionCities";
import { useTracks } from "../../lib/tracks/useTracks";
import { useAlertFeatures } from "../../lib/alerts-overlay";
import { useQuakes } from "../../lib/seismic-overlay";
import { useSeismoGauge } from "../../lib/seismo-gauge";
import { useCables } from "../../lib/cables-overlay";
import { useFaults } from "../../lib/faults-overlay";
import { useAurora } from "../../lib/aurora-overlay";
import { useSatImg } from "../../lib/satimg-overlay";
import { useGeomag } from "../../lib/geomag-overlay";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";
import ControlPanel from "../../components/ControlPanel";
import ViewingOverlay from "../../components/ViewingOverlay";
import AlertLegend from "../../components/AlertLegend";
import Legend from "../../components/Legend";
import { legendVariableFor } from "../../lib/legend";
import { DebugButton } from "../../lib/client/debug";

export default function SandboxPage() {
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);
  const [manifest, setManifest] = useState<WeatherManifest | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  // Click-to-select: pin an event/quake's info card (no director on this page).
  const [selected, setSelected] = useState<Segment | null>(null);
  const globe = useRef<GlobeHandle | null>(null);
  const { socket } = useSocket();
  // Layers in extra local cities once the operator pans/zooms into a region —
  // the base `cities` fetch stays a fixed, bounded world set.
  const shownCities = useRegionCities(cities, state.camera.center, state.camera.zoom);

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
  const alerts = useAlertFeatures(state.showAlerts, state.alertSeverityMin, state.alertHazardsOff);
  const quakes = useQuakes(state.showSeismic, state.seismicMinMag);
  const { stations: seismoStations, active: seismoActive } = useSeismoGauge(state.camera.center, state.showSeismic);
  const cables = useCables(state.showCables);
  const faults = useFaults(state.showFaults);
  const aurora = useAurora(state.showAurora);
  const satimg = useSatImg(state.showSatImg);
  const geomag = useGeomag(state.showMagneticField);

  // Cold start from the main scene so we open on whatever's currently on air.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ state: s }, m, c] = await Promise.all([
        fetchSceneState(MAIN_SCENE_ID),
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

  // Keep live *data* fresh (new weather runs / cities) — but deliberately NOT the
  // broadcast's control state: this page never listens to CONTROL_STATE, so the
  // operator's toggles/camera never yank the view while you're mid-fiddle.
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

  // Local-only apply: no socket emit, no persist. This omission is the *entire*
  // difference from /control's `apply` — nothing here reaches /watch.
  const apply = (next: ControlState) => setState(next);

  return (
    <main style={{ display: "flex", height: "100vh", background: "#0a0e16", color: "#fff" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <GlobeView
          ref={globe}
          state={state}
          manifest={manifest}
          cities={shownCities}
          tracks={tracks}
          orbits={orbits}
          trails={trails}
          alerts={alerts}
          quakes={quakes}
          seismoStations={seismoStations}
          seismoActive={seismoActive}
          cables={cables}
          faults={faults}
          aurora={aurora}
          satimg={satimg}
          geomag={geomag}
          interactive
          onSelect={setSelected}
          onCameraChange={(center, zoom) => apply({ ...state, camera: { center, zoom } })}
        />
        {state.showAlerts || state.showSeismic || state.showAurora || state.showMagneticField ? (
          <AlertLegend alerts={alerts} quakes={quakes} aurora={aurora} geomag={geomag} />
        ) : null}
        {/* Active weather-map colour key — /watch only shows this inside a director
            segment's on-air card, so the freewheeling sandbox (no director) would
            otherwise never show it. Suppressed when something's click-selected,
            since ViewingOverlay already renders the same legend in that card. */}
        {!selected && legendVariableFor(state) ? (
          <div
            style={{
              position: "absolute",
              left: 24,
              bottom: 24,
              padding: "10px 14px",
              fontFamily: "system-ui, sans-serif",
              background: "linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.88))",
              border: "1px solid rgba(120,140,170,0.22)",
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            <Legend
              variableId={legendVariableFor(state)}
              units={state.units}
              onUnitsChange={(units) => apply({ ...state, units })}
            />
          </div>
        ) : null}
        {selected ? (
          <ViewingOverlay
            segment={selected}
            variable={state.activeVariable}
            // Anchor the readout at the picked event (static — no spin/push-in).
            state={{ ...state, camera: selected.camera, autoSpin: false, zoomDrift: 0 }}
            upNext={[]}
            label="SELECTED"
            accent="#38bdf8"
            onClose={() => setSelected(null)}
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
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Sandbox</h2>
            <span style={{ fontSize: 11, opacity: 0.55 }}>detached · off-air</span>
          </div>
          <DebugButton
            title="State"
            tooltip="Inspect local control state, tracks & overlays (off-air)"
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
