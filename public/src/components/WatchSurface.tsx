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
import { useTracks } from "../lib/tracks/useTracks";
import { useAlertFeatures } from "../lib/alerts-overlay";
import { useQuakes } from "../lib/seismic-overlay";
import type { City } from "../lib/cities";
import GlobeView from "./GlobeView";

interface WatchSurfaceProps {
  state: ControlState;
  manifest: WeatherManifest | null;
  cities: City[];
  /** Optional scene name shown in the corner label. */
  sceneName?: string;
}

export default function WatchSurface({ state, manifest, cities, sceneName }: WatchSurfaceProps) {
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
        interactive={false}
      />
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
        {manifest ? (
          <>
            {manifest.model.toUpperCase()} · run {new Date(manifest.run).toUTCString()}
          </>
        ) : (
          "Awaiting weather data…"
        )}
      </div>
    </main>
  );
}
