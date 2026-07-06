"use client";

/**
 * The full-bleed broadcast globe shared by `/watch` (main scene) and
 * `/watch/:id` (named scenes). Given a live ControlState + manifest + cities it
 * derives the track/alert/quake overlays and renders the clean globe with a
 * small run/attribution label. No chrome — designed to be captured as a YouTube
 * output or an OBS browser source.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import { mapFreshness } from "../lib/manifest";
import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import { useTracks } from "../lib/tracks/useTracks";
import { useAlertFeatures } from "../lib/alerts-overlay";
import { useQuakes } from "../lib/seismic-overlay";
import { useSeismoGauge } from "../lib/seismo-gauge";
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
  /** On-air director segment — drives the broadcast event reticle. */
  onAirSegment?: Segment | null;
  /** Director's "coming up" preview — drives the chrome's UP NEXT hint. */
  upNext?: { kind: SegmentKind; title: string }[];
  /** Name of the on-air segment kind's active saved "slide" look, if any. */
  slideName?: string;
}

export default function WatchSurface({
  state,
  manifest,
  cities,
  sceneName,
  pulseAt,
  glowCountryIso,
  onAirSegment,
  upNext = [],
  slideName,
}: WatchSurfaceProps) {
  // Latches true once every weather variable's texture at the current fhr has
  // decoded (see Globe's own "keep every map in RAM" preload). Gates the cold-
  // start loading screen AND defers the overlay fetches below so they don't
  // compete with those texture decodes for bandwidth/CPU during the race to
  // first reveal — everything still pops in immediately after, well before a
  // director cut or map-type switch would need it.
  const ready = useGlobeReadyOnce(manifest, state.fhr);

  const { tracks, orbits, trails } = useTracks({
    showSatellites: state.showSatellites && ready,
    showAircraft: state.showAircraft && ready,
    showShips: state.showShips && ready,
    showOrbits: state.showOrbits,
    showTrails: state.showTrails,
    trailMinutes: state.trailMinutes,
    satelliteGroup: state.satelliteGroup,
    center: state.camera.center,
    zoom: state.camera.zoom,
  });
  const alerts = useAlertFeatures(state.showAlerts && ready, state.alertSeverityMin, state.alertHazardsOff);
  const quakes = useQuakes(state.showSeismic && ready, state.seismicMinMag);
  // Same focus point SeismicMonitor uses for the fake-vs-real trace decision:
  // the on-air segment's location if there is one, else the current camera.
  const seismoFocus: [number, number] | null = onAirSegment?.camera.center ?? state.camera.center ?? null;
  const { stations: seismoStations, active: seismoActive } = useSeismoGauge(seismoFocus, state.showSeismic && ready);
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
  const theme = getBroadcastTheme(state.broadcastTheme);

  // When the director is on a plane/ship, spotlight that exact marker on the
  // globe. The segment id is `flight:<icao24>` / `ship:<mmsi>` — map "flight" to
  // the aircraft track kind and match on the code (ICAO24/MMSI).
  const highlightTrack =
    onAirSegment && (onAirSegment.kind === "flight" || onAirSegment.kind === "ship")
      ? {
          kind: (onAirSegment.kind === "flight" ? "aircraft" : "ship") as "aircraft" | "ship",
          code: onAirSegment.id.split(":")[1] ?? "",
        }
      : null;

  return (
    <main style={{ position: "fixed", inset: 0, background: "#0a0e16", overflow: "hidden" }}>
      <GlobeView
        state={state}
        manifest={manifest}
        cities={cities}
        tracks={tracks}
        orbits={orbits}
        trails={trails}
        alerts={alerts}
        quakes={quakes}
        seismoStations={state.showSeismic ? seismoStations : []}
        seismoActive={state.showSeismic ? seismoActive : null}
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
        highlightTrack={highlightTrack}
      />
      {/* The broadcast chrome carries its own legend/alert furniture, so the plain
          map key only shows on the clean (chrome-off) surface to avoid clashing. */}
      {!state.showBroadcastChrome ? (
        <AlertLegend
          alerts={state.showAlerts ? alerts : []}
          quakes={state.showSeismic ? quakes : []}
          aurora={aurora}
          geomag={geomag}
        />
      ) : null}
      {state.showBroadcastChrome ? (
        <BroadcastFrame
          state={state}
          manifest={manifest}
          alerts={state.showAlerts ? alerts : []}
          quakes={state.showSeismic ? quakes : []}
          seismoStations={state.showSeismic ? seismoStations : []}
          seismoActive={state.showSeismic ? seismoActive : null}
          tracks={tracks}
          cities={cities}
          cams={cams}
          aurora={aurora}
          geomag={geomag}
          theme={theme}
          onAirSegment={onAirSegment ?? null}
          upNext={upNext}
          assetsReady={ready}
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
    </main>
  );
}
