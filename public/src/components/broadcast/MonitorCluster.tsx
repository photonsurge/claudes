"use client";

/**
 * "GLOBAL MONITOR" / "LOCAL MONITOR" cards, keyed to WHAT'S ON AIR:
 * `SeismicMonitor` (bottom-left) draws a scrolling seismograph for the quakes
 * relevant to the focused event/region (its magnitude drives the amplitude +
 * the M-tag); `TsunamiMonitor` (bottom-centre) plots the genuine recent
 * water-level series of a coastal station near the shot (worker-cached IOC
 * data), cycling through whichever nearby gauges are cached; `WeatherMonitors`
 * draws wind/pressure/wave from the archived point-history at the focus.
 * Every card HIDES when it isn't relevant (no nearby quake/gauge, or too
 * little archived data) so none ever shows ambient filler. All three sources
 * are fetched once in WatchSurface.tsx and passed down as props here AND to
 * Globe.tsx, which draws the matching station/point marker + name on the
 * globe itself (layers/seismograph-stations.ts, layers/tide-stations.ts,
 * lib/weather-point.ts) — so the map and these cards always agree.
 */
import { useRef, type ReactNode } from "react";
import type { Segment } from "@photonsurge/shared/director";
import type { TideSample } from "@photonsurge/shared/tides/types";
import { nearby } from "../../lib/geo";
import type { TideStationReading } from "../../lib/tides/types";
import { historySamples, type HistorySeries } from "../../lib/history-client";
import { formatReading } from "./PointHistoryPanel";
import type { Quake } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import {
  GodsPanel,
  accentRule,
  MONO,
  INK,
  INK_DIM,
  GODS_TILE,
  GODS_TILE_BORDER,
} from "./GodsPanel";
import { HeartbeatIcon, WaveIcon, WindIcon, GaugeIcon } from "./icons";

/** Radius (km) of quakes counted as "relevant" to a focused quake vs a region. */
const QUAKE_FOCUS_KM = 800;
const REGION_FOCUS_KM = 1500;

/**
 * Hold a self-hiding monitor's LAST GOOD frame so it never blinks out. These
 * cards read live-polled props (point-history, quakes, tide gauges) whose data
 * legitimately comes and goes shot-to-shot and slide-to-slide: the point-history
 * archive is sampled at cities, so a tour stop / region centre away from one has
 * no series for a beat; a bundle refetch reads empty between polls. Recomputing
 * visibility straight from that made the card vanish for a single slide and pop
 * back — the flicker being fixed here.
 *
 * `value` is the render payload, or `null` when there's nothing to show this
 * instant. Once anything has been shown we keep showing it: fresh data replaces
 * the held frame, an empty beat keeps the last one. The card therefore only ever
 * appears (first time real data lands) and then stays put, updating in place —
 * it doesn't self-hide again. Nothing shows only before the first-ever frame.
 */
function useLastPresent<T>(value: T | null): T | null {
  const lastGood = useRef<T | null>(value);
  if (value != null) lastGood.current = value; // render-time write, idempotent
  return value ?? lastGood.current;
}

/** Deterministic pseudo-noise in [-1,1] from an integer — stable across SSR. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}

/** A seismograph polyline over [0..w] with occasional quake spikes, amp 0..1. */
function seismoPath(w: number, h: number, amp: number): string {
  const mid = h / 2;
  const pts: string[] = [];
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const base = noise(i) * 0.18;
    const spike = Math.abs(noise(i * 1.7)) > 0.86 ? noise(i * 3.1) * 0.9 : 0;
    const y = mid - (base + spike) * amp * (h * 0.46);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/**
 * A stroked seismograph trace from REAL samples, normalised into the box —
 * reads as a proper line trace (unlike the tide gauge's filled area below,
 * which suits "water level" but not "ground motion"). Falls back to a flat
 * mid-line when the series is degenerate (all equal / single point).
 */
export function realLinePath(samples: { v: number }[], w: number, h: number): string {
  const n = samples.length;
  if (n === 0) return `M0,${h / 2} L${w},${h / 2}`;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.v < min) min = s.v;
    if (s.v > max) max = s.v;
  }
  const span = max - min;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i / (n - 1)) * w;
    const norm = span > 1e-6 ? (samples[i].v - min) / span : 0.5;
    const y = h * 0.85 - norm * (h * 0.7);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/**
 * A filled water-level path from REAL samples, normalised into the box: lowest
 * reading sits low, highest sits high. Falls back to a flat mid-line when the
 * series is degenerate (all equal / single point).
 */
export function realWavePath(samples: { v: number }[], w: number, h: number): string {
  const n = samples.length;
  if (n === 0) return `M0,${h} L${w},${h} Z`;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.v < min) min = s.v;
    if (s.v > max) max = s.v;
  }
  const span = max - min;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i / (n - 1)) * w;
    const norm = span > 1e-6 ? (samples[i].v - min) / span : 0.5;
    const y = h * 0.85 - norm * (h * 0.7);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    if (n === 1) pts.push(`${w.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M0,${h} L${pts.join(" L")} L${w},${h} Z`;
}

/** Rising/falling/flat over the series, for the gauge readout. */
function trend(samples: TideSample[], muted: string): { arrow: string; color: string } {
  if (samples.length < 2) return { arrow: "—", color: muted };
  const d = samples[samples.length - 1].v - samples[0].v;
  if (d > 0.02) return { arrow: "▲", color: "#ff7a7a" };
  if (d < -0.02) return { arrow: "▼", color: "#43d9ff" };
  return { arrow: "—", color: muted };
}

function Panel({
  title,
  icon,
  tag,
  caption,
  children,
  theme,
}: {
  title: string;
  /** Small glyph identifying the instrument kind (heartbeat/wave). */
  icon?: React.ReactNode;
  tag?: string;
  /** Small readout overlaid at the bottom-left of the trace box. */
  caption?: React.ReactNode;
  children: React.ReactNode;
  theme: BroadcastTheme;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, letterSpacing: 1.2, color: INK_DIM }}>
          {icon}
          {title}
        </span>
        {tag ? (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 8.5,
              letterSpacing: 0.6,
              color: theme.accent,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 98,
            }}
          >
            {tag}
          </span>
        ) : null}
      </div>
      <div
        style={{
          height: TRACE_H,
          background: GODS_TILE,
          border: `1px solid ${GODS_TILE_BORDER}`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {children}
        {caption ? (
          <div
            style={{
              position: "absolute",
              left: 5,
              bottom: 3,
              fontFamily: MONO,
              fontSize: 8.2,
              letterSpacing: 0.4,
              color: "#cdd8ea",
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
              pointerEvents: "none",
            }}
          >
            {caption}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const W = 250;
/** Height of every monitor's trace box, in both CSS and the SVG viewBox math. */
const TRACE_H = 34;
const ROW_BOX_W = 132;
const ROW_BOX_H = 42;

function CardShell({
  theme,
  children,
  label = "GLOBAL MONITOR",
}: {
  theme: BroadcastTheme;
  children: React.ReactNode;
  /** Card-family label. Defaults to "GLOBAL MONITOR" for Seismic/Tsunami, which
   *  do fall back to genuine whole-planet behaviour on a wide/unfocused shot;
   *  callers whose data is always a single point sample (e.g. WeatherMonitors)
   *  should override this so the label doesn't imply planet-wide coverage. */
  label?: string;
}) {
  return (
    <GodsPanel width={172} notch={[8, 14]} padding="9px 12px 11px" gap={6} style={{ pointerEvents: "none" }}>
      <style>{"@keyframes bcast-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.8, color: INK, whiteSpace: "nowrap" }}>
          {label}
        </div>
        <div style={{ flex: 1, height: 1, background: accentRule(theme.accent) }} />
      </div>
      {children}
    </GodsPanel>
  );
}

export function SeismicMonitor({
  quakes,
  seismoStations = [],
  seismoActive = null,
  onAirSegment = null,
  regionCenter,
  theme = DEFAULT_THEME,
}: {
  quakes: Quake[];
  /** Worker-cached live seismograph stations near what's on air. */
  seismoStations?: SeismoStationReading[];
  /** Which of `seismoStations` is currently "on air" here (cycled by the caller). */
  seismoActive?: SeismoStationReading | null;
  /** The on-air director segment — drives what's "relevant". */
  onAirSegment?: Segment | null;
  /** Current camera centre [lng,lat] — the fallback focus for wide shots. */
  regionCenter?: [number, number];
  theme?: BroadcastTheme;
}) {
  const focus: [number, number] | null = onAirSegment?.camera.center ?? regionCenter ?? null;
  const isQuakeSeg = onAirSegment?.kind === "quake";

  // Focused shot: only quakes near the focus count. Wide/unfocused shot: keep
  // the whole-planet behaviour (global strongest quake) so the monitor still
  // reads as an ambient global seismograph when nothing specific is on air.
  const relevantQuakes = focus
    ? nearby(quakes, focus, (q) => [q.lng, q.lat], isQuakeSeg ? QUAKE_FOCUS_KM : REGION_FOCUS_KM).map((n) => n.item)
    : quakes;
  const topQuake = relevantQuakes.reduce<Quake | null>((m, q) => (!m || q.mag > m.mag ? q : m), null);
  const maxMag = topQuake?.mag ?? 0;
  const amp = Math.min(1, Math.max(0.2, maxMag / 7));
  // Show the seismo on a wide shot (ambient), on any quake shot, or whenever a
  // relevant quake is nearby; hide on a focused land shot with nothing seismic.
  const showSeismic = !focus || isQuakeSeg || relevantQuakes.length > 0;
  const seismicPlace = topQuake?.place;

  // A real live station in range draws the genuine waveform instead of the
  // synthetic noise; the caller (WatchSurface) already cycles `seismoActive`
  // through `seismoStations` on a timer, keeping this in sync with the globe
  // overlay's highlighted marker.
  const realSeismoSamples = seismoActive?.samples?.length ? seismoActive.samples : null;
  const activeIdx = seismoActive ? seismoStations.indexOf(seismoActive) : -1;
  const stationCaption =
    seismoActive && activeIdx >= 0
      ? `${truncate(seismoActive.siteName?.split(",")[0]?.trim() || `${seismoActive.net}.${seismoActive.sta}`, 24)}${
          seismoStations.length > 1 ? ` · ${activeIdx + 1}/${seismoStations.length}` : ""
        }`
      : undefined;

  if (!showSeismic) return null;

  return (
    <CardShell theme={theme}>
      <Panel
        title="SEISMIC MONITOR"
        icon={<HeartbeatIcon active={!!realSeismoSamples} />}
        tag={maxMag > 0 ? `M${maxMag.toFixed(1)}` : "PLOT"}
        caption={stationCaption ?? (seismicPlace ? truncate(seismicPlace, 34) : undefined)}
        theme={theme}
      >
        {realSeismoSamples ? (
          <svg
            width="200%"
            height="100%"
            viewBox={`0 0 ${W * 2} ${TRACE_H}`}
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, animation: "bcast-trace 9s linear infinite" }}
          >
            <path d={realLinePath(realSeismoSamples, W, TRACE_H)} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
            <path
              d={realLinePath(realSeismoSamples, W, TRACE_H)}
              transform={`translate(${W},0)`}
              fill="none"
              stroke="#43d9ff"
              strokeWidth="1.2"
            />
          </svg>
        ) : (
          <svg
            width="200%"
            height="100%"
            viewBox={`0 0 ${W * 2} ${TRACE_H}`}
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, animation: "bcast-trace 6s linear infinite" }}
          >
            <path d={seismoPath(W, TRACE_H, amp)} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
            <path d={seismoPath(W, TRACE_H, amp)} transform={`translate(${W},0)`} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
          </svg>
        )}
      </Panel>
    </CardShell>
  );
}

export function TsunamiMonitor({
  stations,
  active,
  theme = DEFAULT_THEME,
}: {
  /** Nearby cached tide gauges — lifted once in WatchSurface so this panel and
   *  the globe's tide markers always agree on what's cached. */
  stations: TideStationReading[];
  /** Which of `stations` is currently "on air" here (cycled by the caller). */
  active: TideStationReading | null;
  theme?: BroadcastTheme;
}) {
  // A coastal gauge being in range IS the relevance signal — draw its real
  // series. Hide entirely when nothing's cached near the shot. The caller
  // cycles `active` through `stations` on a timer, same as the seismic feed,
  // so a stretch of coast shows more than one gauge.
  const tideActive = active;
  const samples = tideActive?.samples?.length ? tideActive.samples : null;
  const tideIdx = tideActive ? stations.indexOf(tideActive) : -1;
  const tideTag =
    tideActive && tideIdx >= 0
      ? `${truncate(tideActive.name, 14)}${stations.length > 1 ? ` · ${tideIdx + 1}/${stations.length}` : ""}`
      : "SEA LEVEL";

  // TideStationRow already shows every nearby gauge (including this one) once
  // 2+ are cached — showing this single-gauge card on top of that row is a
  // redundant duplicate, so defer to the row in that case.
  const withData = stations.filter((s) => s.samples?.length);
  if (withData.length >= 2) return null;

  if (!samples) return null;

  const tr = trend(samples, theme.mutedColor);

  return (
    <CardShell theme={theme}>
      <Panel
        title="TSUNAMI GAUGE"
        icon={<WaveIcon active />}
        tag={tideTag}
        caption={
          <span>
            {tideActive?.latest?.toFixed(2)} m <span style={{ color: tr.color }}>{tr.arrow}</span>
          </span>
        }
        theme={theme}
      >
        <svg
          width="200%"
          height="100%"
          viewBox={`0 0 ${W * 2} ${TRACE_H}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, animation: "bcast-trace 11s linear infinite" }}
        >
          <path d={realWavePath(samples, W, TRACE_H)} fill="rgba(60,150,230,0.5)" />
          <path d={realWavePath(samples, W, TRACE_H)} transform={`translate(${W},0)`} fill="rgba(60,150,230,0.5)" />
        </svg>
      </Panel>
    </CardShell>
  );
}

/** Clip a label to `max` chars with an ellipsis (the tag already CSS-ellipsizes,
 *  but captions have no width box). */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const WEATHER_MONITORS: {
  variable: string;
  title: string;
  color: string;
  /** Filled swell area (like the tsunami gauge) instead of a stroked line. */
  wave?: boolean;
  icon: React.ReactNode;
  animMs: number;
}[] = [
  { variable: "wind", title: "WIND MONITOR", color: "#9085e9", icon: <WindIcon active />, animMs: 7000 },
  { variable: "pressure", title: "PRESSURE MONITOR", color: "#f2a33d", icon: <GaugeIcon active />, animMs: 10000 },
  { variable: "wave", title: "WAVE MONITOR", color: "#3987e5", wave: true, icon: <WaveIcon active />, animMs: 9000 },
];

function formatMonitorLocation(series: HistorySeries[], locationLabel?: string | null): string {
  const label = locationLabel?.trim();
  if (label) return label;

  const sampled = series.find((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!sampled) return "LOCAL POINT";

  const lat = `${Math.abs(sampled.lat).toFixed(1)}${sampled.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(sampled.lng).toFixed(1)}${sampled.lng >= 0 ? "E" : "W"}`;
  return `${lat} ${lng}`;
}

function WeatherMonitorBox({
  spec,
  samples,
  latestLabel,
  locationLabel,
  theme,
}: {
  spec: (typeof WEATHER_MONITORS)[number];
  samples: { v: number }[];
  latestLabel: string;
  locationLabel: string;
  theme: BroadcastTheme;
}) {
  const path = spec.wave ? realWavePath(samples, ROW_BOX_W, ROW_BOX_H) : realLinePath(samples, ROW_BOX_W, ROW_BOX_H);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: ROW_BOX_W }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 0.4,
            color: INK_DIM,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {locationLabel}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: theme.accent, whiteSpace: "nowrap" }}>
          {latestLabel}
        </span>
      </div>
      <div
        style={{
          height: ROW_BOX_H,
          background: GODS_TILE,
          border: `1px solid ${GODS_TILE_BORDER}`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <svg
          width="200%"
          height="100%"
          viewBox={`0 0 ${ROW_BOX_W * 2} ${ROW_BOX_H}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, animation: `weather-row-trace ${spec.animMs}ms linear infinite` }}
        >
          {spec.wave ? (
            <>
              <path d={path} fill="rgba(60,150,230,0.5)" />
              <path d={path} transform={`translate(${ROW_BOX_W},0)`} fill="rgba(60,150,230,0.5)" />
            </>
          ) : (
            <>
              <path d={path} fill="none" stroke={spec.color} strokeWidth="1.1" />
              <path d={path} transform={`translate(${ROW_BOX_W},0)`} fill="none" stroke={spec.color} strokeWidth="1.1" />
            </>
          )}
        </svg>
        <div
          style={{
            position: "absolute",
            left: 5,
            bottom: 3,
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontFamily: MONO,
            fontSize: 8.2,
            letterSpacing: 0.6,
            color: INK_DIM,
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            pointerEvents: "none",
          }}
        >
          {spec.icon}
          {spec.title}
        </div>
      </div>
    </div>
  );
}

/**
 * Local wind, barometric pressure, and wave height, all read from the same
 * archived point-history the POINT HISTORY panel already fetches (see
 * history-client's usePointHistory), just as a permanent glance-strip instead
 * of a slideshow. Each blob hides on its own once its variable has too little
 * archived data for the focus point, same self-hiding rule as
 * SeismicMonitor/TsunamiMonitor.
 */
export function LocalWeatherPanel({
  series,
  locationLabel = null,
  theme = DEFAULT_THEME,
  forecast = null,
  showMonitors = true,
}: {
  /** Archived point-history at the on-air focus — lifted once in WatchSurface
   *  (see lib/history-client's usePointHistory) so this panel and the globe's
   *  weather-point marker read the same fetch. */
  series: HistorySeries[];
  /** Human-readable on-air place name for the shared local monitor focus. */
  locationLabel?: string | null;
  theme?: BroadcastTheme;
  /** Bare ForecastPanel section rendered in the same shared panel shell. */
  forecast?: ReactNode;
  /** Scene toggle for the archived wind/pressure/wave half of the panel. */
  showMonitors?: boolean;
}) {
  const location = formatMonitorLocation(series, locationLabel);
  const computed = WEATHER_MONITORS.map((spec) => {
    const samples = historySamples(series, spec.variable);
    if (!samples) return null;
    const units = series.find((s) => s.variable === spec.variable)?.units ?? "";
    const latest = samples[samples.length - 1].v;
    return { spec, samples, latestLabel: `${formatReading(latest)}${units ? ` ${units}` : ""}` };
  }).filter((item): item is { spec: (typeof WEATHER_MONITORS)[number]; samples: { v: number }[]; latestLabel: string } => item != null);

  // Hold the last readings so a slide/stop whose archive reads empty for a beat
  // (the point-history is sampled at cities) keeps the strip up with its last
  // good traces instead of blanking it out for that one slide.
  const held = useLastPresent(computed.length > 0 ? { visible: computed, location } : null);
  const monitorData = showMonitors ? held : null;
  if (!monitorData && !forecast) return null;

  return (
    // Solid chamfered G.O.D.S. plate, matching the GLOBAL MONITOR
    // (tsunami/seismic) CardShell — the strip used to be bare labels + trace
    // boxes floating on the map, so over a bright field (a hot temperature map)
    // it washed out to near-invisible and read as "gone". The opaque navy fill
    // keeps it legible over ANY basemap.
    <GodsPanel notch={[10, 16]} padding="9px 14px 12px" gap={0} style={{ pointerEvents: "none" }}>
      <style>{"@keyframes weather-row-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ display: "flex", alignItems: "stretch", gap: 14 }}>
        {monitorData && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  letterSpacing: 2.2,
                  color: INK,
                  whiteSpace: "nowrap",
                }}
              >
                <WindIcon active size={13} />
                LOCAL MONITORS
              </span>
              <div style={{ flex: 1, minWidth: 20, height: 1, background: accentRule(theme.accent) }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {monitorData.visible.map((item) => (
                <WeatherMonitorBox
                  key={item.spec.variable}
                  spec={item.spec}
                  samples={item.samples}
                  latestLabel={item.latestLabel}
                  locationLabel={monitorData.location}
                  theme={theme}
                />
              ))}
            </div>
          </div>
        )}
        {forecast && (
          <div
            style={{
              display: "flex",
              paddingLeft: monitorData ? 14 : 0,
              borderLeft: monitorData ? `1px solid ${GODS_TILE_BORDER}` : undefined,
            }}
          >
            {forecast}
          </div>
        )}
      </div>
    </GodsPanel>
  );
}

/** Standalone compatibility wrapper used by focused monitor tests/callers. */
export function WeatherMonitors(props: Omit<Parameters<typeof LocalWeatherPanel>[0], "forecast" | "showMonitors">) {
  return <LocalWeatherPanel {...props} />;
}
