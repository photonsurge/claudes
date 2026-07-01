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
import type { AlertFeature } from "../../lib/alerts";
import type { Quake, Track } from "../../lib/tracks/types";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import { buildTicker } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useStageScale, STAGE_W, STAGE_H } from "./useStageScale";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import LiveAlertPanel from "./LiveAlertPanel";
import MonitorCluster from "./MonitorCluster";
import EventOverlay from "./EventOverlay";
import EventNearbyPanel from "./EventNearbyPanel";
import OnAirCard from "./OnAirCard";
import { isTargetedEvent, KIND_COLOR } from "./kinds";

/** Design-stage layout constants (in 1080p reference pixels). */
const TICKER_H = 34;
const INSET = 30;

export default function BroadcastFrame({
  state,
  manifest,
  alerts = [],
  quakes = [],
  tracks = [],
  cities = [],
  cams = [],
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
  theme?: BroadcastTheme;
  /** The on-air director segment — drives the event reticle so it matches what's
   *  actually selected. Null when nothing is on air (reticle hidden). */
  onAirSegment?: Segment | null;
}) {
  const scale = useStageScale();
  const ticker = buildTicker({ alerts, quakes, tracks });
  const eventTargeted = onAirSegment ? isTargetedEvent(onAirSegment.kind) : false;

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
            <EventOverlay segment={onAirSegment} />
          ) : (
            <div style={{ position: "absolute", left: INSET, bottom: TICKER_H + INSET }}>
              <OnAirCard segment={onAirSegment} alerts={alerts} quakes={quakes} theme={theme} />
            </div>
          )
        ) : null}

        {/* "Near this event" — cities (with Wikipedia photo/blurb) + webcams
            around a targeted event. Bottom-left, which the reticle leaves free. */}
        {eventTargeted && onAirSegment ? (
          <div style={{ position: "absolute", left: INSET, bottom: TICKER_H + INSET }}>
            <EventNearbyPanel
              center={onAirSegment.camera.center}
              cities={cities}
              cams={cams}
              color={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"}
            />
          </div>
        ) : null}

        <Ticker title={theme.tickerTitle} items={ticker} edge="top" height={TICKER_H} theme={theme} />

        <div style={{ position: "absolute", top: TICKER_H + INSET, left: INSET }}>
          <BrandPanel theme={theme} />
        </div>

        <div style={{ position: "absolute", top: TICKER_H + INSET + 128, left: INSET }}>
          <IntensityMeter variable={state.activeVariable} units={state.units} theme={theme} />
        </div>

        <div style={{ position: "absolute", top: TICKER_H + INSET, right: INSET }}>
          <LiveAlertPanel alerts={alerts} theme={theme} />
        </div>

        <div style={{ position: "absolute", bottom: TICKER_H + INSET, right: INSET }}>
          <MonitorCluster quakes={quakes} theme={theme} />
        </div>

        <Ticker title="GLOBAL ALERT TICKER" items={ticker} edge="bottom" height={TICKER_H} theme={theme} />
      </div>
    </div>
  );
}
