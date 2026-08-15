"use client";

/**
 * The full-bleed broadcast globe shared by `/watch` (main scene) and
 * `/watch/:id` (named scenes). Given a live ControlState + manifest + cities it
 * derives the track/alert/quake overlays and renders the clean globe with a
 * small run/attribution label. No chrome — designed to be captured as a YouTube
 * output or an OBS browser source.
 */
import { useMemo } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import { broadcastSatImgFeeds } from "@photonsurge/shared/satimg/types";
import { mapFreshness } from "../lib/manifest";
import type { Segment, SegmentKind, DirectorState } from "@photonsurge/shared/director";
import { useTracks } from "../lib/tracks/useTracks";
import { useAlertFeatures } from "../lib/alerts-overlay";
import { useAlertHazardStep, ALERT_CYCLE_MS } from "../lib/alert-cycle";
import { useQuakes } from "../lib/seismic-overlay";
import {
  FocusProvider,
  useSeismoStations,
  useTideStations,
  usePointHistorySeries,
} from "../lib/focus/focus-client";
import { selectWeatherPoint } from "../lib/weather-point";
import { useCables } from "../lib/cables-overlay";
import { useFaults } from "../lib/faults-overlay";
import { useAurora } from "../lib/aurora-overlay";
import { useSatImg } from "../lib/satimg-overlay";
import { useFires } from "../lib/fires-overlay";
import { useVolcanoes } from "../lib/volcanoes-overlay";
import { useGeomag } from "../lib/geomag-overlay";
import { useCams } from "../lib/cams/useCams";
import type { City } from "../lib/cities";
import { useGlobeReadyOnce } from "../lib/globe-ready";
import GlobeView from "./GlobeView";
import AlertLegend from "./AlertLegend";
import FullscreenButton from "./FullscreenButton";
import BroadcastBed from "./audio/BroadcastBed";
import BroadcastFrame from "./broadcast/BroadcastFrame";
import AdBreak from "./broadcast/AdBreak";
import LoadingScreen from "./broadcast/LoadingScreen";
import StartCountdown from "./broadcast/StartCountdown";
import { getBroadcastTheme } from "./broadcast/config";

interface WatchSurfaceProps {
  state: ControlState;
  manifest: WeatherManifest | null;
  cities: City[];
  /** Optional scene name shown in the corner label. */
  sceneName?: string;
  /** [lng,lat] of the active event to pulse-highlight, or null. */
  pulseAt?: [number, number] | null;
  /** ISO-3166 alpha-2 of the on-air country spotlight to glow-highlight, or null. */
  glowCountryIso?: string | null;
  /** Framed bbox of a wide on-air shot — every country inside it glows. */
  glowRegionBbox?: [number, number, number, number] | null;
  /** On-air director segment — drives the broadcast event reticle. */
  onAirSegment?: Segment | null;
  /** Current Areas-tour stop caption (city + country) — drives the centre place
   *  reticle while the card keeps naming the area. Null off a tour. */
  focusCaption?: { title: string; subtitle: string } | null;
  /** Director's "coming up" preview — drives the chrome's UP NEXT hint. */
  upNext?: DirectorState["upNext"];
  /** Name of the on-air segment kind's active saved "slide" look, if any. */
  slideName?: string;
  /** Dwell per step of the alert hazard cycle (DirectorConfig.alertCycleSeconds). */
  alertCycleSeconds?: number;
  /** Whether the auto-director is actively driving this scene — gates the
   *  brand block's LIVE badge (an idle/off director isn't on air). */
  directorOn?: boolean;
}

function WatchSurfaceBody({
  state,
  manifest,
  cities,
  sceneName,
  pulseAt,
  glowCountryIso,
  glowRegionBbox,
  onAirSegment,
  focusCaption,
  upNext = [],
  slideName,
  alertCycleSeconds,
  directorOn = false,
  ready,
}: WatchSurfaceProps & { ready: boolean }) {
  // Latches true once every weather variable's texture at the current fhr has
  // decoded (see Globe's own "keep every map in RAM" preload). Gates the cold-
  // start loading screen AND defers the overlay fetches below so they don't
  // compete with those texture decodes for bandwidth/CPU during the race to
  // first reveal — everything still pops in immediately after, well before a
  // director cut or map-type switch would need it.
  // `ready` is latched once in the WatchSurface wrapper (below) and passed in, so
  // a single latch feeds both the FocusProvider gate and every overlay here.

  // When the director is on a plane/ship, spotlight that exact marker on the
  // globe. The segment id is `flight:<icao24>` / `ship:<mmsi>` — map "flight" to
  // the aircraft track kind and match on the code (ICAO24/MMSI). Also scopes the
  // trails overlay (only the on-air + notable craft get a route drawn).
  const highlightTrack =
    onAirSegment && (onAirSegment.kind === "flight" || onAirSegment.kind === "ship")
      ? {
          kind: (onAirSegment.kind === "flight" ? "aircraft" : "ship") as "aircraft" | "ship",
          code: onAirSegment.id.split(":")[1] ?? "",
        }
      : null;

  const { tracks, orbits, trails } = useTracks({
    showSatellites: state.showSatellites && ready,
    showAircraft: state.showAircraft && ready,
    showShips: state.showShips && ready,
    showOrbits: state.showOrbits,
    showTrails: state.showTrails,
    trailMinutes: state.trailMinutes,
    satelliteGroup: state.satelliteGroup,
    highlight: highlightTrack,
    center: state.camera.center,
    zoom: state.camera.zoom,
  });
  const alerts = useAlertFeatures(state.showAlerts && ready, state.alertSeverityMin, state.alertHazardsOff);
  // Light one hazard type at a time while the shot holds, so four kinds of
  // warning over the same ground stop stacking into a slab. Null (and every
  // shape drawn lit, as before) when the operator switches it off or there's
  // only one type in frame — see lib/alert-cycle.
  const alertStep = useAlertHazardStep({
    alerts,
    enabled: state.showAlerts && state.alertCycle,
    camera: state.camera,
    spinning: state.autoSpin,
    cut: onAirSegment,
    dwellMs: alertCycleSeconds ? alertCycleSeconds * 1000 : ALERT_CYCLE_MS,
  });
  const quakes = useQuakes(state.showSeismic && ready, state.seismicMinMag);
  // Same focus point SeismicMonitor uses for the fake-vs-real trace decision:
  // the on-air segment's location if there is one, else the current camera.
  const seismoFocus: [number, number] | null = onAirSegment?.camera.center ?? state.camera.center ?? null;
  const { stations: seismoStations, active: seismoActive } = useSeismoStations(seismoFocus);
  // Same focus point TsunamiMonitor/WeatherMonitors use — fetched once here so
  // the globe's tide/weather-point markers and the HUD cards always agree,
  // mirroring the seismic wiring above.
  const tideFocus: [number, number] | null = onAirSegment?.camera.center ?? state.camera.center ?? null;
  const { stations: tideStations, active: tideActive } = useTideStations(tideFocus);
  const pointFocus: [number, number] | null = onAirSegment?.camera.center ?? state.camera.center ?? null;
  const { series: pointHistorySeries } = usePointHistorySeries(pointFocus);
  const weatherPoint = selectWeatherPoint(onAirSegment ?? null, pointHistorySeries);
  const cables = useCables(state.showCables && ready);
  const faults = useFaults(state.showFaults && ready);
  const aurora = useAurora(state.showAurora && ready);
  const satimg = useSatImg(state.showSatImg && ready);
  const fires = useFires(state.showFires && ready);
  const volcanoes = useVolcanoes(state.showVolcanoes && ready);
  const geomag = useGeomag(state.showMagneticField && ready);
  // Webcams feed the "near this event" broadcast panel; only load them when the
  // chrome is on (the plain surface doesn't show the panel).
  const cams = useCams(state.showBroadcastChrome && ready);
  const theme = getBroadcastTheme(state.broadcastTheme, state.themeOverrides);

  // Broadcast rule: the /watch output only ever shows the clean global cloud mosaic
  // (plus the lightning overlay) — every regional geostationary disc (GOES / Himawari /
  // Meteosat) is forced off here so the stream never shows the artefacty, third-of-a-
  // planet discs, whatever a slide or an operator toggle left in the live state. The
  // operator console (/sandbox, /control) renders its own globe and is unaffected, so
  // discs stay fully usable there. Only satImgFeeds differs from `state`; memoised on
  // `state` so the deck.gl globe keeps a stable prop between socket beats.
  const broadcastState = useMemo(
    () => ({ ...state, satImgFeeds: broadcastSatImgFeeds(state.satImgFeeds) }),
    [state],
  );

  return (
    <main style={{ position: "fixed", inset: 0, background: "#0a0e16", overflow: "hidden" }}>
      <GlobeView
        state={broadcastState}
        manifest={manifest}
        cities={cities}
        tracks={tracks}
        orbits={orbits}
        trails={trails}
        alerts={alerts}
        alertFocus={alertStep}
        quakes={quakes}
        seismoStations={state.showSeismic ? seismoStations : []}
        seismoActive={state.showSeismic ? seismoActive : null}
        tideStations={tideStations}
        tideActive={tideActive}
        weatherPointCenter={weatherPoint?.center ?? null}
        weatherPointLabel={weatherPoint?.label ?? null}
        cables={cables}
        faults={faults}
        aurora={aurora}
        satimg={satimg}
        fires={fires}
        volcanoes={volcanoes}
        geomag={geomag}
        interactive={false}
        pulseAt={pulseAt}
        glowCountryIso={glowCountryIso}
        glowRegionBbox={glowRegionBbox}
        highlightTrack={highlightTrack}
      />
      {/* The broadcast chrome carries its own legend/alert furniture, so the plain
          map key only shows on the clean (chrome-off) surface to avoid clashing. */}
      {!state.showBroadcastChrome ? (
        <AlertLegend
          alerts={state.showAlerts ? alerts : []}
          activeHazard={alertStep?.hazard ?? null}
          quakes={state.showSeismic ? quakes : []}
          aurora={aurora}
          geomag={geomag}
        />
      ) : null}
      {state.showBroadcastChrome ? (
        <BroadcastFrame
          state={broadcastState}
          manifest={manifest}
          alerts={state.showAlerts ? alerts : []}
          activeHazard={alertStep?.hazard ?? null}
          quakes={state.showSeismic ? quakes : []}
          volcanoes={state.showVolcanoes ? volcanoes : []}
          seismoStations={state.showSeismic ? seismoStations : []}
          seismoActive={state.showSeismic ? seismoActive : null}
          tideStations={tideStations}
          tideActive={tideActive}
          pointHistorySeries={pointHistorySeries}
          tracks={tracks}
          cities={cities}
          cams={cams}
          aurora={aurora}
          geomag={geomag}
          theme={theme}
          onAirSegment={onAirSegment ?? null}
          focusCaption={focusCaption ?? null}
          upNext={upNext}
          assetsReady={ready}
          directorOn={directorOn}
        />
      ) : null}
      {/* Plain run/attribution label — only on the clean surface; the broadcast
          chrome owns the bottom edge (its crawl would collide with this). */}
      {!state.showBroadcastChrome ? (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            color: "rgba(255,255,255,0.85)",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            pointerEvents: "none",
          }}
        >
          {sceneName ? <span style={{ opacity: 0.7 }}>{sceneName} · </span> : null}
          {(() => {
            // Freshness of the ACTIVE map — its supplier + when it last updated
            // (sources refresh at different cadences, so this is per-variable).
            const f = mapFreshness(manifest, state.activeVariable, Date.now());
            if (!f) return "Awaiting weather data…";
            return (
              <>
                {f.source} · run {f.runLabel}
                <span style={{ opacity: 0.7 }}> · updated {f.updatedLabel}</span>
              </>
            );
          })()}
        </div>
      ) : null}
      {/* Active slide name — only on the clean surface, mirroring the bottom-left
          attribution label but in the opposite corner. */}
      {!state.showBroadcastChrome && slideName ? (
        <div
          style={{
            position: "absolute",
            right: 16,
            bottom: 16,
            color: "rgba(255,255,255,0.85)",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            pointerEvents: "none",
          }}
        >
          {slideName}
        </div>
      ) : null}

      {/* Full-frame ad interstitial — covers the globe + chrome when the director
          cuts to an ad. Renders nothing for every other segment kind. */}
      <AdBreak segment={onAirSegment ?? null} />

      {/* Generative music bed — operator-driven via state.audio (synced over the
          same socket as the rest of the ControlState). Renders UI only while a
          browser blocks autoplay; in OBS it just plays. */}
      <BroadcastBed audio={state.audio} segment={onAirSegment ?? null} />

      {/* Cold-start cover: hides the globe until its textures are ready (see
          `ready` above), then fades. Never reappears once dismissed. */}
      <LoadingScreen visible={!ready} theme={theme} />

      {/* Pre-broadcast countdown + credits — operator-set via DirectorPanel
          (state.startAt). Sits above LoadingScreen so the reveal is always the
          countdown finishing, not the globe popping in behind it. */}
      <StartCountdown startAt={state.startAt} theme={theme} />

      {/* Tap-to-fullscreen — Android phone viewers only; self-hides on OBS/iOS/
          desktop (see FullscreenButton). */}
      <FullscreenButton />
    </main>
  );
}

/**
 * Wrapper: latches `ready` once and mounts the FocusProvider so a single
 * /api/focus fetch per on-air cut feeds every panel below (globe markers +
 * broadcast chrome). The body must be a descendant of the provider to read its
 * selectors, hence the split. `ready` gates the provider fetch exactly like it
 * used to gate the individual overlay hooks.
 */
export default function WatchSurface(props: WatchSurfaceProps) {
  const ready = useGlobeReadyOnce(props.manifest, props.state.fhr);
  return (
    <FocusProvider
      onAirSegment={props.onAirSegment ?? null}
      camera={props.state.camera}
      enabled={ready}
      upcoming={props.upNext}
    >
      <WatchSurfaceBody {...props} ready={ready} />
    </FocusProvider>
  );
}
