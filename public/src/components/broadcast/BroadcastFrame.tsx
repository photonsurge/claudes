"use client";

/**
 * The on-air chrome that overlays the globe/map: top + bottom crawls, the brand
 * block + LIVE badge, the left intensity meter, a top-right live-alert panel and
 * a bottom-right global monitor. Fully pointer-inert so it never intercepts the
 * capture surface, and responsive — on phones it drops the heaviest panels and
 * shrinks type so the globe stays the hero.
 *
 * All furniture derives from data the watch surface already has (alerts, quakes,
 * tracks, the active variable's legend), so it adds no new fetches.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import type { AlertFeature } from "../../lib/alerts";
import type { Quake, Track } from "../../lib/tracks/types";
import { buildTicker } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useIsNarrow } from "./useIsNarrow";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import LiveAlertPanel from "./LiveAlertPanel";
import MonitorCluster from "./MonitorCluster";

export default function BroadcastFrame({
  state,
  manifest,
  alerts = [],
  quakes = [],
  tracks = [],
  theme = DEFAULT_THEME,
}: {
  state: ControlState;
  manifest: WeatherManifest | null;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  tracks?: Track[];
  theme?: BroadcastTheme;
}) {
  const narrow = useIsNarrow();
  const ticker = buildTicker({ alerts, quakes, tracks });
  const topH = narrow ? 24 : 30;
  const botH = narrow ? 24 : 30;
  const inset = narrow ? 10 : 18;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 5 }}>
      <Ticker title={theme.tickerTitle} items={ticker} edge="top" height={topH} compact={narrow} theme={theme} />

      {/* Top-left brand + LIVE */}
      <div style={{ position: "absolute", top: topH + inset, left: inset }}>
        <BrandPanel theme={theme} compact={narrow} />
      </div>

      {/* Left intensity meter (under the brand block). */}
      <div style={{ position: "absolute", top: topH + inset + (narrow ? 92 : 116), left: inset }}>
        <IntensityMeter variable={state.activeVariable} units={state.units} theme={theme} compact={narrow} />
      </div>

      {/* Top-right live alert panel */}
      <div style={{ position: "absolute", top: topH + inset, right: inset }}>
        <LiveAlertPanel alerts={alerts} theme={theme} compact={narrow} />
      </div>

      {/* Bottom-right monitor — dropped on phones to keep the globe clear. */}
      {!narrow ? (
        <div style={{ position: "absolute", bottom: botH + inset, right: inset }}>
          <MonitorCluster quakes={quakes} theme={theme} />
        </div>
      ) : null}

      <Ticker
        title={narrow ? "ALERTS" : "GLOBAL ALERT TICKER"}
        items={ticker}
        edge="bottom"
        height={botH}
        compact={narrow}
        theme={theme}
      />
    </div>
  );
}
