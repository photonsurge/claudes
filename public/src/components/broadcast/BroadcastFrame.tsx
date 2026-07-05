"use client";

/**
 * The on-air chrome overlaying the globe/map: top + bottom crawls, the brand
 * block + LIVE badge, a top-centre live-alert panel + intensity meter, a
 * top-right world-watch summary and bottom seismic/tsunami global monitors.
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
import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import type { AuroraOverlay } from "../../lib/aurora-overlay";
import type { GeomagOverlay } from "../../lib/geomag-overlay";
import type { AlertFeature } from "../../lib/alerts";
import type { Quake, Track } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { buildTicker } from "../../lib/broadcast";
import { bboxForCamera } from "../../lib/history-client";
import { legendVariableFor } from "../../lib/legend";
import { nearest, formatKm } from "../../lib/geo";
import { useWorldWatch } from "../../lib/world-watch";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useStageScale, STAGE_W, STAGE_H } from "./useStageScale";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import LiveAlertPanel from "./LiveAlertPanel";
import WorldWatchPanel from "./WorldWatchPanel";
import WorldSituationPanel from "./WorldSituationPanel";
import KpIndexPanel from "./KpIndexPanel";
import SpaceWeatherMeter from "./SpaceWeatherMeter";
import { SeismicMonitor, TsunamiMonitor } from "./MonitorCluster";
import SeismicStationRow from "./SeismicStationRow";
import TideStationRow from "./TideStationRow";
import PointHistoryPanel from "./PointHistoryPanel";
import EventOverlay from "./EventOverlay";
import EventNearbyPanel from "./EventNearbyPanel";
import QuakeReport from "./QuakeReport";
import TrackInfoPanel from "./TrackInfoPanel";
import OnAirCard from "./OnAirCard";
import SyslogFeed from "./SyslogFeed";
import UpNextPanel from "./UpNextPanel";
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
  seismoStations = [],
  seismoActive = null,
  tracks = [],
  cities = [],
  cams = [],
  aurora = null,
  geomag = null,
  theme = DEFAULT_THEME,
  onAirSegment = null,
  upNext = [],
  assetsReady = true,
}: {
  state: ControlState;
  manifest: WeatherManifest | null;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  /** Worker-cached live seismograph stations near what's on air. */
  seismoStations?: SeismoStationReading[];
  /** Which of `seismoStations` is currently "on air" in the SEISMIC MONITOR panel. */
  seismoActive?: SeismoStationReading | null;
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
  /** Director's best-guess "coming up" preview (score-ranked at the last cut,
   *  not a committed pick) — drives the small UP NEXT line by the SYSLOG feed. */
  upNext?: { kind: SegmentKind; title: string }[];
  /** True once the globe's own textures are ready (see useGlobeReadyOnce) —
   *  defers the WORLD WATCH panels' cold-start fetch so it doesn't compete with
   *  those for bandwidth while the loading screen is still up. */
  assetsReady?: boolean;
}) {
  const scale = useStageScale();
  const worldWatch = useWorldWatch(cities, assetsReady);
  const ticker = buildTicker({ alerts, quakes, tracks });
  // A round-up segment takes over the bottom crawl with its own narrative
  // (single long line, so it just scrolls through once and loops) instead of
  // mixing it into the alert/quake/track feed — the top crawl keeps showing
  // the standing feed throughout.
  const summaryOnAir = onAirSegment?.kind === "summary" ? onAirSegment.summary : null;
  const bottomTickerTitle = summaryOnAir ? "GLOBAL ROUND-UP" : "GLOBAL ALERT TICKER";
  const bottomTickerItems = summaryOnAir ? [summaryOnAir.narrative] : ticker;
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
  // Whatever currently owns the bottom-left slot (mutually exclusive on
  // segment kind) — the history panel stacks above whichever of these is on
  // screen, so it always reads as "left column" rather than a fixed position.
  const leftBottomPanel = !onAirSegment
    ? null
    : hasTrackInfo
      ? <TrackInfoPanel segment={onAirSegment} color={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"} />
      : eventTargeted
        ? onAirSegment.kind === "quake" && onAirSegment.quake
          ? (
            <QuakeReport
              mag={onAirSegment.quake.mag}
              depthKm={onAirSegment.quake.depthKm}
              center={onAirSegment.camera.center}
              cities={cities}
              color={KIND_COLOR.quake}
            />
          )
          : (
            <EventNearbyPanel
              center={onAirSegment.camera.center}
              cities={cities}
              cams={cams}
              color={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"}
            />
          )
        : <OnAirCard segment={onAirSegment} alerts={alerts} quakes={quakes} theme={theme} />;

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
        {onAirSegment && isTargetedEvent(onAirSegment.kind) ? (
          <EventOverlay segment={onAirSegment} extraDetails={nearestCityDetails(onAirSegment, cities)} />
        ) : null}

        {/* Bottom-left column: the archived history charts for the focus, stacked
            above whichever context card currently owns the bottom-left slot (the
            wide-shot "now viewing" card, a Track Info card for a notable
            aircraft/ship, or the targeted-event quake/nearby-cities report — all
            mutually exclusive on segment kind). column-reverse anchors the
            context card to the bottom edge regardless of the history panel's
            (self-hiding, variable-height) content. */}
        <div
          style={{
            position: "absolute",
            left: INSET,
            bottom: TICKER_H + INSET,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          {leftBottomPanel}
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
        </div>

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

        {/* Space-weather colour key, stacked below whichever of Kp / the brand
            block are showing (the intensity meter moved to top-centre). */}
        {spaceWeatherShown ? (
          <div
            style={{
              position: "absolute",
              top: TICKER_H + INSET + 128 + (kpShown ? 72 : 0),
              left: INSET,
            }}
          >
            <SpaceWeatherMeter aurora={aurora} geomag={geomag} theme={theme} />
          </div>
        ) : null}

        {/* Top-centre column: single most-severe active alert, stacked above the
            active variable's intensity meter/legend (moved here, horizontal, so
            the prime top-right slot can carry the always-on WORLD WATCH summary
            instead). Each hides independently when it has nothing to show. */}
        <div
          style={{
            position: "absolute",
            top: TICKER_H + INSET,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <LiveAlertPanel alerts={alerts} theme={theme} />
          <IntensityMeter variable={legendVariableFor(state)} units={state.units} theme={theme} />
        </div>

        {/* Whole-planet situation summary — two separate stacked cards, not one
            crowded panel: the hero tally (WorldSituationPanel) reads as the
            "how much/how bad" headline, the scrolling feed (WorldWatchPanel)
            as the "which ones" detail below it. Both independent of the
            operator's show-alerts/seismic toggles — they share one fetch
            (worldWatch, above) instead of each pulling their own. */}
        <div
          style={{
            position: "absolute",
            top: TICKER_H + INSET,
            right: INSET,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <WorldSituationPanel worldWatch={worldWatch} theme={theme} />
          <WorldWatchPanel worldWatch={worldWatch} theme={theme} />
        </div>

        {/* Bottom-right column: UP NEXT hint stacked above the always-on
            SYSLOG feed. column-reverse anchors the feed's newest line to the
            bottom edge, with UP NEXT stacking upward above it. */}
        <div
          style={{
            position: "absolute",
            bottom: TICKER_H + INSET,
            right: INSET,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <SyslogFeed />
          <UpNextPanel items={upNext} />
        </div>

        {/* Bottom-centre row: seismic monitor column to the left, tsunami gauge
            column to the right — both anchored to the same bottom edge
            (alignItems: flex-end + column-reverse) so either can grow upward
            independently without disturbing the other's baseline. The gauges
            row (NEARBY TSUNAMI GAUGES) sits closest to the bottom edge in its
            column, with the GLOBAL MONITOR tsunami card stacked above it. */}
        <div
          style={{
            position: "absolute",
            bottom: TICKER_H + INSET,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 14 }}>
            <SeismicMonitor
              quakes={quakes}
              seismoStations={seismoStations}
              seismoActive={seismoActive}
              onAirSegment={onAirSegment}
              regionCenter={state.camera.center}
              theme={theme}
            />
            <SeismicStationRow stations={seismoStations} onAirSegment={onAirSegment} theme={theme} />
          </div>
          <div style={{ display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 14 }}>
            <TideStationRow onAirSegment={onAirSegment} regionCenter={state.camera.center} theme={theme} />
            <TsunamiMonitor onAirSegment={onAirSegment} regionCenter={state.camera.center} theme={theme} />
          </div>
        </div>

        <Ticker title={bottomTickerTitle} items={bottomTickerItems} edge="bottom" height={TICKER_H} theme={theme} />
      </div>
    </div>
  );
}
