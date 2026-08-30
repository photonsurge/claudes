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
import { useDirector, useDirectorConfig, useDirectorCut, eventPulse, activeCountryIso, activeRegionBbox } from "../../lib/director";
import { listCities, type City } from "../../lib/cities";
import { useRegionCities } from "../../lib/useRegionCities";
import { useTracks } from "../../lib/tracks/useTracks";
import { useAlertFeatures } from "../../lib/alerts-overlay";
import { useAlertHazardStep } from "../../lib/alert-cycle";
import { useQuakes } from "../../lib/seismic-overlay";
import { useSeismoGauge } from "../../lib/seismo-gauge";
import { useCables } from "../../lib/cables-overlay";
import { useFaults } from "../../lib/faults-overlay";
import { useAurora } from "../../lib/aurora-overlay";
import { useSatImg } from "../../lib/satimg-overlay";
import { useFires } from "../../lib/fires-overlay";
import { useVolcanoes } from "../../lib/volcanoes-overlay";
import { useGeomag } from "../../lib/geomag-overlay";
import GlobeView, { type GlobeHandle } from "../../components/GlobeView";
import ControlPanel from "../../components/ControlPanel";
import DirectorPanel, { type TabId as DirectorTabId } from "../../components/DirectorPanel";
import StreamPanel from "../../components/StreamPanel";
import ViewingOverlay from "../../components/ViewingOverlay";
import QuakeReport from "../../components/broadcast/QuakeReport";
import TrackInfoPanel from "../../components/broadcast/TrackInfoPanel";
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
  // Lifted here (not inside DirectorPanel) so the live preview below and the
  // panel's edits share one config — an operator toggling a map type sees the
  // preview update immediately instead of the two diverging.
  const {
    config: directorConfig,
    draft: directorDraft,
    dirty: directorDirty,
    applyNow: applyDirectorNow,
    edit: editDirector,
    save: saveDirector,
    discard: discardDirector,
  } = useDirectorConfig(sceneId);
  // Director panel tab + settings-visibility are lifted here so the separate
  // live-map ControlPanel can be hidden while the operator works the Director
  // tab (its own settings form), and shown again on the Map/View tab or when
  // the director is just running its log.
  const [directorTab, setDirectorTab] = useState<DirectorTabId>("director");
  const [directorShowSettings, setDirectorShowSettings] = useState(false);
  const directorAuto = directorDraft.mode === "auto";
  // Auto just switched — reset the log-vs-settings toggle so the form doesn't
  // reappear already open from a prior session.
  useEffect(() => {
    setDirectorShowSettings(false);
  }, [directorAuto]);
  const directorFormOpen = !directorAuto || directorShowSettings;
  const showControlPanel = !(directorFormOpen && directorTab === "director");
  const [cut, setCut] = useState<Segment | null>(null);
  // Click-to-select: the operator can click an event/quake while the director is
  // idle to pin its info box (same card the director shows on air).
  const [selected, setSelected] = useState<Segment | null>(null);
  const lastSeq = useRef<number>(-1);
  useEffect(() => {
    if (director?.active && director.segment && director.seq !== lastSeq.current) {
      lastSeq.current = director.seq;
      setCut(director.segment);
      setSelected(null); // the director owns the card while it's driving
      globe.current?.flyTo(director.segment.camera.center, director.segment.camera.zoom);
    } else if (!director?.active && lastSeq.current !== -1) {
      lastSeq.current = -1;
      setCut(null);
    }
  }, [director?.seq, director?.active, director?.segment]);

  const { patch: cutPatch, segment: onAir } = useDirectorCut(
    cut,
    manifest,
    cut ? directorConfig.mapTypes[cut.kind] : undefined,
  );
  const shown = useMemo(
    () => (cutPatch ? mergeControlState(state, cutPatch) : state),
    [state, cutPatch],
  );
  // Layers in extra local cities once a director cut (or the operator's own
  // pan/zoom) pushes in on a region — the base `cities` fetch stays a fixed,
  // bounded world set.
  const shownCities = useRegionCities(cities, shown.camera.center, shown.camera.zoom);

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
  const alerts = useAlertFeatures(shown.showAlerts, shown.alertSeverityMin, shown.alertHazardsOff);
  // Same hazard cycle the broadcast surface runs, off the same epoch clock — the
  // operator preview has to show what's actually going out.
  const alertStep = useAlertHazardStep({
    alerts,
    enabled: shown.showAlerts && shown.alertCycle,
    camera: shown.camera,
    spinning: shown.autoSpin,
    cut: director?.active ? onAir : null,
    dwellMs: directorConfig.alertCycleSeconds * 1000,
  });
  const quakes = useQuakes(shown.showSeismic, shown.seismicMinMag);
  const { stations: seismoStations, active: seismoActive } = useSeismoGauge(shown.camera.center, shown.showSeismic);
  const cables = useCables(shown.showCables);
  const faults = useFaults(shown.showFaults);
  const aurora = useAurora(shown.showAurora);
  const satimg = useSatImg(shown.showSatImg);
  const fires = useFires(shown.showFires);
  const volcanoes = useVolcanoes(shown.showVolcanoes);
  const geomag = useGeomag(shown.showMagneticField);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Deep-link to a channel: /control?scene=<id> drives that scene directly, so
      // each channel has its own operator URL. Absent/invalid ⇒ the main scene.
      const requested = new URLSearchParams(window.location.search).get("scene") || MAIN_SCENE_ID;
      const [{ state: s }, m, c, sc] = await Promise.all([
        fetchSceneState(requested),
        fetchManifest(),
        listCities(),
        listScenes(),
      ]);
      if (cancelled) return;
      setSceneId(requested);
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
  // Reflect the channel in the URL so this control view stays shareable/bookmarkable.
  const switchScene = async (id: string) => {
    setSceneId(id);
    const url = new URL(window.location.href);
    if (id === MAIN_SCENE_ID) url.searchParams.delete("scene");
    else url.searchParams.set("scene", id);
    window.history.replaceState(null, "", url);
    const { state: next } = await fetchSceneState(id);
    setState(next);
  };

  return (
    <main style={{ display: "flex", height: "100vh", background: "#0a0e16", color: "#fff" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <GlobeView
          ref={globe}
          state={shown}
          manifest={manifest}
          cities={shownCities}
          tracks={tracks}
          orbits={orbits}
          trails={trails}
          alerts={alerts}
          alertFocus={alertStep}
          quakes={quakes}
          seismoStations={seismoStations}
          seismoActive={seismoActive}
          cables={cables}
          faults={faults}
          aurora={aurora}
          satimg={satimg}
          fires={fires}
          volcanoes={volcanoes}
          geomag={geomag}
          interactive
          pulseAt={eventPulse(director)}
          glowCountryIso={activeCountryIso(director, shown.camera.center)}
          glowRegionBbox={activeRegionBbox(director, shown.camera)}
          // Click-to-select is only live while the director is idle — a cut owns
          // the on-air card, so manual selection is suppressed during playback.
          onSelect={cut ? undefined : setSelected}
          // While a director cut is on air it owns the camera (imperative flyTo);
          // don't persist those frames or the operator's manual baseline drifts.
          // MUST merge functionally: while spinning, camera ticks arrive every
          // frame through a closure that can be one render stale — spreading
          // `state` would re-apply the pre-click snapshot and revert whatever
          // the panel just changed. The emit rides the updater so it carries
          // the same merged state (a duplicate dev StrictMode emit is benign —
          // identical payload).
          onCameraChange={(center, zoom) => {
            if (cut) return;
            setState((s) => {
              const next = { ...s, camera: { center, zoom } };
              emit(sceneId, next);
              return next;
            });
          }}
        />
        {shown.showAlerts || shown.showSeismic || shown.showAurora || shown.showMagneticField ? (
          <AlertLegend alerts={alerts} activeHazard={alertStep?.hazard ?? null} quakes={quakes} aurora={aurora} geomag={geomag} />
        ) : null}
        {director?.active && onAir ? (
          <ViewingOverlay
            segment={onAir}
            variable={shown.activeVariable}
            state={shown}
            upNext={director.upNext}
            lastShownAt={director.lastShownAt}
            timesShown={director.timesShown}
            draggable
            manifest={manifest}
          />
        ) : selected ? (
          <ViewingOverlay
            segment={selected}
            variable={shown.activeVariable}
            // Anchor the readout at the picked event (static — no spin/push-in).
            state={{ ...shown, camera: selected.camera, autoSpin: false, zoomDrift: 0 }}
            upNext={[]}
            label="SELECTED"
            accent="#38bdf8"
            onClose={() => setSelected(null)}
            manifest={manifest}
          />
        ) : null}

        {/* Seismic report for the on-air (director) / clicked quake — magnitude &
            depth breakdown + nearest cities. Track Info card (Wikipedia photo +
            blurb) for the clicked volcano/notable track. Top-right, clear of the
            top-left legend and the bottom-left "now viewing" card. */}
        {(() => {
          const seg = director?.active && onAir ? onAir : selected;
          if (!seg) return null;
          if (seg.trackInfo) {
            return (
              <div style={{ position: "absolute", top: 16, right: 16, zIndex: 4 }}>
                <TrackInfoPanel segment={seg} />
              </div>
            );
          }
          return seg.kind === "quake" && seg.quake ? (
            <div style={{ position: "absolute", top: 16, right: 16, zIndex: 4 }}>
              <QuakeReport
                mag={seg.quake.mag}
                depthKm={seg.quake.depthKm}
                center={seg.camera.center}
                cities={shownCities}
              />
            </div>
          ) : null;
        })()}
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
              aria-label="Channel"
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
            <a
              href={`/watch/${sceneId}`}
              target="_blank"
              rel="noreferrer"
              title="Open this channel's broadcast output in a new tab"
              style={{ color: "#6b93e0", fontSize: 13, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Watch ↗
            </a>
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
        <DirectorPanel
          sceneId={sceneId}
          config={directorDraft}
          applyNow={applyDirectorNow}
          edit={editDirector}
          save={saveDirector}
          discard={discardDirector}
          dirty={directorDirty}
          liveState={state}
          applyLive={apply}
          activeTab={directorTab}
          onTabChange={setDirectorTab}
          showSettings={directorShowSettings}
          onToggleSettings={() => setDirectorShowSettings((s) => !s)}
        />
        <StreamPanel sceneId={sceneId} />
        {showControlPanel ? (
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
        ) : null}
      </aside>
    </main>
  );
}
