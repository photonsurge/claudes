"use client";

/**
 * The on-air chrome overlaying the globe/map: top + bottom crawls, the brand
 * block + LIVE badge, the left intensity meter, a top-right live-alert panel and
 * a bottom-right global monitor.
 *
 * Built for VIDEO, not the responsive web: the furniture is authored once at a
 * 1920×1080 design stage and scaled as a whole to the output resolution (see
 * useStageScale), so it stays pixel-proportional and crisp from 720p to 4K on
 * YouTube/OBS rather than reflowing at breakpoints. Fully pointer-inert so it
 * never intercepts the capture surface, and derives entirely from data the watch
 * surface already has (alerts, quakes, tracks, the active variable's legend).
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import type { Segment } from "@photonsurge/shared/director";
import type { AuroraOverlay } from "../../lib/aurora-overlay";
import type { GeomagOverlay } from "../../lib/geomag-overlay";
import type { AlertFeature } from "../../lib/alerts";
import type { Quake, Track } from "../../lib/tracks/types";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { buildTicker } from "../../lib/broadcast";
import { bboxForCamera } from "../../lib/history-client";
import { legendVariableFor } from "../../lib/legend";
import { nearest, formatKm } from "../../lib/geo";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useStageScale, STAGE_W, STAGE_H } from "./useStageScale";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import LiveAlertPanel from "./LiveAlertPanel";
import WorldWatchPanel from "./WorldWatchPanel";
import KpIndexPanel from "./KpIndexPanel";
import SpaceWeatherMeter from "./SpaceWeatherMeter";
import MonitorCluster from "./MonitorCluster";
import PointHistoryPanel from "./PointHistoryPanel";
import EventOverlay from "./EventOverlay";
import EventNearbyPanel from "./EventNearbyPanel";
import QuakeReport from "./QuakeReport";
import TrackInfoPanel from "./TrackInfoPanel";
import OnAirCard from "./OnAirCard";
import { hasRealLocation, isTargetedEvent, KIND_COLOR } from "./kinds";

/** Design-stage layout constants (in 1080p reference pixels). */
const TICKER_H = 34;
const INSET = 30;

/**
 * A "Nearest City" reticle row for a moving target (aircraft / ship) — the
 * segment shape carries no place name, so we name the closest notable city + its
 * distance for geographic context (mid-ocean it still names the closest
 * landfall). Empty for every other kind (quakes/storms already carry a place).
 */
function nearestCityDetails(segment: Segment, cities: City[]): { label: string; value: string }[] {
  if (segment.kind !== "flight" && segment.kind !== "ship") return [];
  const notable = cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital);
  const n = nearest(notable, segment.camera.center, (c) => [c.lng, c.lat]);
  if (!n) return [];
  const name = n.item.country ? `${n.item.name}, ${n.item.country}` : n.item.name;
  return [{ label: "Nearest City", value: `${name} · ${formatKm(n.distanceKm)}` }];
}

export default function BroadcastFrame({
  state,
  manifest,
  alerts = [],
  quakes = [],
  tracks = [],
  cities = [],
  cams = [],
  aurora = null,
  geomag = null,
  theme = DEFAULT_THEME,
  onAirSegment = null,
}: {
  state: ControlState;
  manifest: WeatherManifest | null;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  tracks?: Track[];
  /** Curated cities — for the "near this event" panel. */
  cities?: City[];
  /** Worker-cached webcams — for the "near this event" panel. */
  cams?: Cam[];
  /** Cached aurora frame (carries the Kp index) — for the space-weather readout. */
  aurora?: AuroraOverlay | null;
  /** Cached geomagnetic-field frame — for the space-weather colour-key ramp. */
  geomag?: GeomagOverlay | null;
  theme?: BroadcastTheme;
  /** The on-air director segment — drives the event reticle so it matches what's
   *  actually selected. Null when nothing is on air (reticle hidden). */
  onAirSegment?: Segment | null;
}) {
  const scale = useStageScale();
  const ticker = buildTicker({ alerts, quakes, tracks });
  const eventTargeted = onAirSegment ? isTargetedEvent(onAirSegment.kind) : false;
  // Global spins (intro/ocean/orbital) frame an arbitrary point, not a real
  // ground location — the weather/climate history panel has nothing to sample.
  const segmentHasLocation = onAirSegment ? hasRealLocation(onAirSegment.kind) : true;
  // A notable aircraft/ship carries a rich Track Info card on the segment; when
  // present it takes the bottom-left slot (superseding the nearby-cities panel).
  const hasTrackInfo = onAirSegment?.trackInfo != null;
  // Space-weather readout rides on the aurora overlay: only when the oval is on
  // and the cached frame actually carries a Kp reading.
  const kpShown = state.showAurora && aurora?.meta.kp != null;
  // Colour-key ramp for the aurora oval / magnetic field — both hooks already
  // return null when their toggle is off, so presence alone gates this.
  const spaceWeatherShown = aurora?.meta != null || geomag?.meta != null;
  const intensityShown = legendVariableFor(state) != null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 5 }}>
      {/* 1080p design stage, uniformly scaled + centred to the output resolution. */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* Targeted point events (storm/quake/aircraft/ship) get the centred
            reticle; wide shots (global/ocean/region/…) get a small card tucked
            lower-left so we don't frame empty screen. */}
        {onAirSegment ? (
          isTargetedEvent(onAirSegment.kind) ? (
            <EventOverlay segment={onAirSegment} extraDetails={nearestCityDetails(onAirSegment, cities)} />
          ) : (
            <div style={{ position: "absolute", left: INSET, bottom: TICKER_H + INSET }}>
              <OnAirCard segment={onAirSegment} alerts={alerts} quakes={quakes} theme={theme} />
            </div>
          )
        ) : null}

        {/* Notable aircraft/ship → the rich Track Info card (photo + story), which
            takes precedence over the nearby-cities panel in the bottom-left slot. */}
        {hasTrackInfo && onAirSegment ? (
          <div style={{ position: "absolute", left: INSET, bottom: TICKER_H + INSET }}>
            <TrackInfoPanel segment={onAirSegment} color={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"} />
          </div>
        ) : null}

        {/* Bottom-left context panel for a targeted event (the reticle leaves it
            free; skipped when a Track Info card owns the slot). A quake gets the
            seismic report (magnitude/depth breakdown + nearest cities); every
            other event gets the "near this event" cities/webcams panel. */}
        {eventTargeted && onAirSegment && !hasTrackInfo ? (
          <div style={{ position: "absolute", left: INSET, bottom: TICKER_H + INSET }}>
            {onAirSegment.kind === "quake" && onAirSegment.quake ? (
              <QuakeReport
                mag={onAirSegment.quake.mag}
                depthKm={onAirSegment.quake.depthKm}
                center={onAirSegment.camera.center}
                cities={cities}
                color={KIND_COLOR.quake}
              />
            ) : (
              <EventNearbyPanel
                center={onAirSegment.camera.center}
                cities={cities}
                cams={cams}
                color={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"}
              />
            )}
          </div>
        ) : null}

        <Ticker title={theme.tickerTitle} items={ticker} edge="top" height={TICKER_H} theme={theme} />

        <div style={{ position: "absolute", top: TICKER_H + INSET, left: INSET }}>
          <BrandPanel theme={theme} />
        </div>

        {/* Geomagnetic Kp readout, tucked under the brand block when the aurora
            overlay is on; pushes the intensity meter down so they don't overlap. */}
        {kpShown ? (
          <div style={{ position: "absolute", top: TICKER_H + INSET + 128, left: INSET }}>
            <KpIndexPanel kp={aurora?.meta.kp} theme={theme} />
          </div>
        ) : null}

        <div
          style={{ position: "absolute", top: TICKER_H + INSET + 128 + (kpShown ? 72 : 0), left: INSET }}
        >
          <IntensityMeter variable={legendVariableFor(state)} units={state.units} theme={theme} />
        </div>

        {/* Space-weather colour key, stacked below whichever of Kp / the active
            variable's intensity meter are showing. */}
        {spaceWeatherShown ? (
          <div
            style={{
              position: "absolute",
              top: TICKER_H + INSET + 128 + (kpShown ? 72 : 0) + (intensityShown ? 260 : 0),
              left: INSET,
            }}
          >
            <SpaceWeatherMeter aurora={aurora} geomag={geomag} theme={theme} />
          </div>
        ) : null}

        {/* Single most-severe active alert — moved to top-centre so the prime
            top-right slot can carry the always-on WORLD WATCH summary. Hidden
            (returns null) when the operator has alerts off or none are active. */}
        <div style={{ position: "absolute", top: TICKER_H + INSET, left: "50%", transform: "translateX(-50%)" }}>
          <LiveAlertPanel alerts={alerts} theme={theme} />
        </div>

        {/* Whole-planet situation summary. Always on and independent of the
            show-alerts/seismic toggles — it fetches its own global tally. */}
        <div style={{ position: "absolute", top: TICKER_H + INSET, right: INSET }}>
          <WorldWatchPanel theme={theme} />
        </div>

        {/* Bottom-right column: archived history charts for the focus, stacked
            above the global monitor. Targeted events sample their exact point;
            wide shots aggregate the framed AREA instead. Both self-hide. It is
            inset a little farther than the other edge furniture so the larger
            charts do not feel pinned to the frame. */}
        <div
          style={{
            position: "absolute",
            bottom: TICKER_H + INSET,
            right: INSET + 18,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <PointHistoryPanel
            center={segmentHasLocation ? onAirSegment?.camera.center ?? state.camera.center ?? null : null}
            bbox={
              segmentHasLocation && !eventTargeted
                ? bboxForCamera(
                    onAirSegment?.camera.center ?? state.camera.center,
                    onAirSegment?.camera.zoom ?? state.camera.zoom,
                  )
                : null
            }
            theme={theme}
          />
          <MonitorCluster
            quakes={quakes}
            onAirSegment={onAirSegment}
            regionCenter={state.camera.center}
            theme={theme}
          />
        </div>

        <Ticker title="GLOBAL ALERT TICKER" items={ticker} edge="bottom" height={TICKER_H} theme={theme} />
      </div>
    </div>
  );
}
