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
import type { TideStationReading } from "../../lib/tides/types";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { countryShot, countryContaining } from "@photonsurge/shared/director-countries";
import { buildTicker, scopeAlertsToBbox, scopeQuakesToBbox, scopeVolcanoesToBbox } from "../../lib/broadcast";
import { bboxForCamera, type HistorySeries } from "../../lib/history-client";
import { useAreaForecast } from "../../lib/forecast-client";
import { legendVariableFor } from "../../lib/legend";
import { nearest, formatKm } from "../../lib/geo";
import { useWorldWatch } from "../../lib/world-watch";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useStageScale, STAGE_W, STAGE_H } from "./useStageScale";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import LiveAlertPanel from "./LiveAlertPanel";
import WorldReportDeck from "./WorldReportDeck";
import KpIndexPanel from "./KpIndexPanel";
import SpaceWeatherMeter from "./SpaceWeatherMeter";
import { SeismicMonitor, TsunamiMonitor, WeatherMonitors } from "./MonitorCluster";
import SeismicStationRow from "./SeismicStationRow";
import TideStationRow from "./TideStationRow";
import PointHistoryPanel from "./PointHistoryPanel";
import DepthProfilePanel from "./DepthProfilePanel";
import ForecastPanel from "./ForecastPanel";
import EventOverlay from "./EventOverlay";
import RoundupStatsPanel from "./RoundupStatsPanel";
import SyslogFeed from "./SyslogFeed";
import UpNextPanel from "./UpNextPanel";
import BuildInfoTag from "./BuildInfoTag";
import SlideDeck from "./SlideDeck";
import { modeSlides } from "./mode-slides";
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
  volcanoes = [],
  seismoStations = [],
  seismoActive = null,
  tideStations = [],
  tideActive = null,
  pointHistorySeries = [],
  tracks = [],
  cities = [],
  cams = [],
  aurora = null,
  geomag = null,
  theme = DEFAULT_THEME,
  onAirSegment = null,
  upNext = [],
  assetsReady = true,
  directorOn = false,
}: {
  state: ControlState;
  manifest: WeatherManifest | null;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  /** Worker-cached active-volcano feed — for the country/region "IN VIEW" rollup. */
  volcanoes?: Volcano[];
  /** Worker-cached live seismograph stations near what's on air. */
  seismoStations?: SeismoStationReading[];
  /** Which of `seismoStations` is currently "on air" in the SEISMIC MONITOR panel. */
  seismoActive?: SeismoStationReading | null;
  /** Worker-cached tide gauges near what's on air. */
  tideStations?: TideStationReading[];
  /** Which of `tideStations` is currently "on air" in the TSUNAMI GAUGE panel. */
  tideActive?: TideStationReading | null;
  /** Archived point-history at the on-air focus, for the WIND/PRESSURE/WAVE
   *  "LOCAL MONITOR" cards. */
  pointHistorySeries?: HistorySeries[];
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
  /** Whether the auto-director is actively driving this scene — gates the
   *  brand block's LIVE badge (an idle/off director isn't on air). */
  directorOn?: boolean;
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
  // Global spins (intro/global/ocean/orbital) frame an arbitrary point, not a real
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
  // A country spotlight scopes the global alerts/quakes feeds down to its own
  // bbox (`shared/director-countries`); a region tour / weather-check segment
  // has no fixed bbox but does sit on a real ground location, so it gets the
  // same treatment via the camera's own framing (see bboxForCamera) — without
  // this, every wide shot but "country" showed the same whole-planet "IN VIEW"
  // tally no matter what was actually on screen.
  // Segment ids are "kind:subject" (see worker's `make()`), so a country
  // segment's id is e.g. "country:portugal" — the catalog is keyed by the
  // bare subject.
  const countryOnAir =
    onAirSegment?.kind === "country" ? countryShot(onAirSegment.id.split(":")[1] ?? "") : undefined;
  // A round-up tours a fresh hotspot every few seconds by patching `state.camera`
  // to that stop's centre (see director.ts's summary cutSteps) — the segment's
  // own `camera` field stays pinned to the base global framing the whole time,
  // so scoping off of it would tally the whole planet no matter which stop is
  // currently shown. `state.camera` is the one place that actually tracks the
  // live stop. When that stop lands inside a curated country, tally against its
  // real bbox (exactly like a country spotlight) instead of a camera-zoom guess.
  const summaryCountry =
    onAirSegment?.kind === "summary" ? countryContaining(state.camera.center[0], state.camera.center[1]) : undefined;
  const areaBbox = countryOnAir
    ? countryOnAir.bbox
    : summaryCountry
      ? summaryCountry.bbox
      : onAirSegment?.kind === "summary"
        ? bboxForCamera(state.camera.center, state.camera.zoom)
        : onAirSegment && segmentHasLocation && !eventTargeted
          ? bboxForCamera(onAirSegment.camera.center, onAirSegment.camera.zoom)
          : undefined;
  const areaAlerts = areaBbox ? scopeAlertsToBbox(alerts, areaBbox) : alerts;
  const areaQuakes = areaBbox ? scopeQuakesToBbox(quakes, areaBbox) : quakes;
  const areaVolcanoes = areaBbox ? scopeVolcanoesToBbox(volcanoes, areaBbox) : volcanoes;

  // A country spotlight / region tour scopes the "IN VIEW" roundup + "TOP
  // CITIES" info to this framed area — set here so mode-slides can turn them
  // into the wide-shot deck (they'd overflow the frame stacked, so the deck
  // rotates them instead). Only when the shot has a real framed area (not a
  // targeted point or a notable-track segment).
  const wideCitiesBbox =
    onAirSegment && !eventTargeted && !hasTrackInfo && (onAirSegment.kind === "country" || onAirSegment.kind === "tour")
      ? areaBbox
      : undefined;
  // Whether the country/tour area forecast has data — decides if it earns its
  // own slide in the deck (see mode-slides). ForecastPanel re-fetches the same
  // (rounded, Cache-Control: max-age=60) URL when it mounts as that slide; the
  // duplicate call is cheap and one-time per bbox change.
  const wideCitiesForecast = useAreaForecast(wideCitiesBbox ?? null);
  const wideCitiesHasForecast = wideCitiesForecast.days.length > 0;

  // The bottom-left mode deck: one ordered, content-filtered slide list per
  // segment kind (mode-slides), replacing the old nested-ternary +
  // usePagedSlides page bookkeeping. SlideDeck cross-fades through it and keeps
  // every slide mounted, preserving each panel's own featured-city cycle /
  // fetched data across a rotation — the same invariant the old display-toggle
  // pages had. The history panel still stacks above it, so the whole thing
  // reads as one left column rather than a fixed position.
  const leftDeck = onAirSegment
    ? modeSlides(onAirSegment, {
        cities,
        cams,
        quakes,
        alerts,
        areaAlerts,
        areaQuakes,
        areaVolcanoes,
        wideCitiesBbox,
        wideCitiesHasForecast,
        theme,
      })
    : [];

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
            reticle (its own compact history panel tucked top-right, so the
            trend context travels with the event instead of stacking a second
            "PAST YEAR" card in the bottom-left column); wide shots (global/
            ocean/region/…) get a small card tucked lower-left so we don't
            frame empty screen. */}
        {onAirSegment && isTargetedEvent(onAirSegment.kind) ? (
          <EventOverlay
            segment={onAirSegment}
            extraDetails={nearestCityDetails(onAirSegment, cities)}
            historyPanel={
              segmentHasLocation ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <PointHistoryPanel center={onAirSegment.camera.center} theme={theme} compact />
                  <DepthProfilePanel center={onAirSegment.camera.center} manifest={manifest} theme={theme} compact activeVariable={state.activeVariable} />
                  <ForecastPanel center={onAirSegment.camera.center} theme={theme} compact />
                </div>
              ) : null
            }
          />
        ) : null}

        {/* Bottom-left column: the archived history charts for the focus, stacked
            above whichever context card currently owns the bottom-left slot (the
            wide-shot "now viewing" card, a Track Info card for a notable
            aircraft/ship, or the targeted-event quake/nearby-cities report — all
            mutually exclusive on segment kind). column-reverse anchors the
            context card to the bottom edge regardless of the history panel's
            (self-hiding, variable-height) content. Only shown for wide (non-
            targeted) shots — targeted events carry their own compact copy in
            the EventOverlay reticle above instead. */}
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
          {onAirSegment ? (
            <SlideDeck slides={leftDeck} dotColor={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"} />
          ) : null}
          {summaryOnAir ? (
            <RoundupStatsPanel stats={summaryOnAir.stats} sources={summaryOnAir.sources} theme={theme} />
          ) : null}
          {!eventTargeted && !wideCitiesBbox ? (
            <ForecastPanel
              center={segmentHasLocation ? onAirSegment?.camera.center ?? state.camera.center ?? null : null}
              bbox={
                segmentHasLocation
                  ? bboxForCamera(
                      onAirSegment?.camera.center ?? state.camera.center,
                      onAirSegment?.camera.zoom ?? state.camera.zoom,
                    )
                  : null
              }
              theme={theme}
            />
          ) : null}
          {!eventTargeted ? (
            <PointHistoryPanel
              center={segmentHasLocation ? onAirSegment?.camera.center ?? state.camera.center ?? null : null}
              bbox={
                segmentHasLocation
                  ? bboxForCamera(
                      onAirSegment?.camera.center ?? state.camera.center,
                      onAirSegment?.camera.zoom ?? state.camera.zoom,
                    )
                  : null
              }
              theme={theme}
            />
          ) : null}
          {!eventTargeted ? (
            <DepthProfilePanel
              center={segmentHasLocation ? onAirSegment?.camera.center ?? state.camera.center ?? null : null}
              manifest={manifest}
              theme={theme}
              activeVariable={state.activeVariable}
            />
          ) : null}
        </div>

        <Ticker title={theme.tickerTitle} items={ticker} edge="top" height={TICKER_H} theme={theme} />

        <div style={{ position: "absolute", top: TICKER_H + INSET, left: INSET }}>
          <BrandPanel theme={theme} live={directorOn} />
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
          <LiveAlertPanel alerts={alerts} cities={cities} theme={theme} />
          <IntensityMeter
            variable={legendVariableFor(state)}
            units={state.units}
            theme={theme}
            showSatImg={state.showSatImg}
            satImgFeeds={state.satImgFeeds}
          />
        </div>

        {/* Whole-planet situation summary — an auto-rotating deck. Slide 1 is
            the DETECTION GRID hero tally + ACTIVE FEED (as before); it then
            cycles a global weather report and single-category ALERTS / SEISMIC /
            VOLCANOES drill-downs. All independent of the operator's
            show-alerts/seismic toggles — the deck reuses the one worldWatch
            fetch (above) rather than each panel pulling its own. */}
        <div
          style={{
            position: "absolute",
            top: TICKER_H + INSET,
            right: INSET,
          }}
        >
          <WorldReportDeck worldWatch={worldWatch} manifest={manifest} theme={theme} />
        </div>

        {/* Bottom-right column: UP NEXT hint, the SYSLOG feed, and the build
            stamp anchored beneath both. column-reverse anchors the first child
            (BuildInfoTag) to the bottom edge, with SYSLOG then UP NEXT
            stacking upward above it. */}
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
          <BuildInfoTag />
          <SyslogFeed />
          <UpNextPanel items={upNext} />
        </div>

        {/* Bottom-centre row: seismic monitor column, the extra weather-
            instrument cards (wind/pressure/wave), then the tsunami gauge
            column — all anchored to the same bottom edge (alignItems:
            flex-end + column-reverse) so any of them can grow upward
            independently without disturbing the others' baseline. The gauges
            row (NEARBY TSUNAMI GAUGES) sits closest to the bottom edge in its
            column; the GLOBAL MONITOR tsunami card only appears above it when
            there's a single gauge in range (it hides itself once the row has
            2+, to avoid showing the same gauge twice). */}
        <div
          style={{
            position: "absolute",
            bottom: TICKER_H + INSET,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 10 }}>
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
          <WeatherMonitors
            series={pointHistorySeries}
            locationLabel={onAirSegment && segmentHasLocation ? onAirSegment.title : null}
            theme={theme}
          />
          <div style={{ display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 10 }}>
            <TideStationRow stations={tideStations} theme={theme} />
            <TsunamiMonitor stations={tideStations} active={tideActive} theme={theme} />
          </div>
        </div>

        <Ticker title={bottomTickerTitle} items={bottomTickerItems} edge="bottom" height={TICKER_H} theme={theme} />
      </div>
    </div>
  );
}
