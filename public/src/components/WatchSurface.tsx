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
import type { Segment } from "@photonsurge/shared/director";
import { useTracks } from "../lib/tracks/useTracks";
import { useAlertFeatures } from "../lib/alerts-overlay";
import { useQuakes } from "../lib/seismic-overlay";
import { useCables } from "../lib/cables-overlay";
import { useFaults } from "../lib/faults-overlay";
import { useAurora } from "../lib/aurora-overlay";
import { useSatImg } from "../lib/satimg-overlay";
import { useFires } from "../lib/fires-overlay";
import { useGeomag } from "../lib/geomag-overlay";
import { useCams } from "../lib/cams/useCams";
import type { City } from "../lib/cities";
import GlobeView from "./GlobeView";
import AlertLegend from "./AlertLegend";
import BroadcastBed from "./audio/BroadcastBed";
import BroadcastFrame from "./broadcast/BroadcastFrame";
import AdBreak from "./broadcast/AdBreak";
import { getBroadcastTheme } from "./broadcast/config";

interface WatchSurfaceProps {
  state: ControlState;
  manifest: WeatherManifest | null;
  cities: City[];
  /** Optional scene name shown in the corner label. */
  sceneName?: string;
  /** [lng,lat] of the active event to pulse-highlight, or null. */
  pulseAt?: [number, number] | null;
  /** On-air director segment — drives the broadcast event reticle. */
  onAirSegment?: Segment | null;
}

export default function WatchSurface({
  state,
  manifest,
  cities,
  sceneName,
  pulseAt,
  onAirSegment,
}: WatchSurfaceProps) {
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
  const cables = useCables(state.showCables);
  const faults = useFaults(state.showFaults);
  const aurora = useAurora(state.showAurora);
  const satimg = useSatImg(state.showSatImg);
  const fires = useFires(state.showFires);
  const geomag = useGeomag(state.showMagneticField);
  // Webcams feed the "near this event" broadcast panel; only load them when the
  // chrome is on (the plain surface doesn't show the panel).
  const cams = useCams(state.showBroadcastChrome);

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
        cables={cables}
        faults={faults}
        aurora={aurora}
        satimg={satimg}
        fires={fires}
        geomag={geomag}
        interactive={false}
        pulseAt={pulseAt}
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
          tracks={tracks}
          cities={cities}
          cams={cams}
          aurora={aurora}
          geomag={geomag}
          theme={getBroadcastTheme(state.broadcastTheme)}
          onAirSegment={onAirSegment ?? null}
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

      {/* Full-frame ad interstitial — covers the globe + chrome when the director
          cuts to an ad. Renders nothing for every other segment kind. */}
      <AdBreak segment={onAirSegment ?? null} />

      {/* Generative music bed — operator-driven via state.audio (synced over the
          same socket as the rest of the ControlState). Renders UI only while a
          browser blocks autoplay; in OBS it just plays. */}
      <BroadcastBed audio={state.audio} segment={onAirSegment ?? null} />
    </main>
  );
}
