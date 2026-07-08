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
import type { Segment } from "@photonsurge/shared/director";
import type { TideSample } from "@photonsurge/shared/tides/types";
import { nearby } from "../../lib/geo";
import type { TideStationReading } from "../../lib/tides/types";
import { historySamples, type HistorySeries } from "../../lib/history-client";
import { formatReading } from "./PointHistoryPanel";
import type { Quake } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { HeartbeatIcon, WaveIcon, WindIcon, GaugeIcon } from "./icons";

/** Radius (km) of quakes counted as "relevant" to a focused quake vs a region. */
const QUAKE_FOCUS_KM = 800;
const REGION_FOCUS_KM = 1500;

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
function trend(samples: TideSample[]): { arrow: string; color: string } {
  if (samples.length < 2) return { arrow: "—", color: "#9fb0c8" };
  const d = samples[samples.length - 1].v - samples[0].v;
  if (d > 0.02) return { arrow: "▲", color: "#ff7a7a" };
  if (d < -0.02) return { arrow: "▼", color: "#43d9ff" };
  return { arrow: "—", color: "#9fb0c8" };
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
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8, fontWeight: 800, letterSpacing: 1, color: "#9fb0c8" }}>
          {icon}
          {title}
        </span>
        {tag ? (
          <span
            style={{
              fontSize: 7.5,
              fontWeight: 700,
              letterSpacing: 0.8,
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
          borderRadius: 5,
          background: "rgba(4,10,20,0.72)",
          border: "1px solid rgba(90,120,160,0.25)",
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
              fontSize: 7.5,
              fontWeight: 700,
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
    <div
      style={{
        width: 172,
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "8px 10px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderRadius: 10,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <style>{"@keyframes bcast-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#dfe7f5" }}>{label}</div>
      {children}
    </div>
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

  const tr = trend(samples);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: ROW_BOX_W }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 0.4,
            color: "#c8d5e6",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {locationLabel}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: theme.accent, whiteSpace: "nowrap" }}>{latestLabel}</span>
      </div>
      <div
        style={{
          height: ROW_BOX_H,
          borderRadius: 6,
          background: "rgba(4,10,20,0.72)",
          border: "1px solid rgba(90,120,160,0.25)",
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
            fontSize: 7.5,
            fontWeight: 800,
            letterSpacing: 0.6,
            color: "#dfe7f5",
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
export function WeatherMonitors({
  series,
  locationLabel = null,
  theme = DEFAULT_THEME,
}: {
  /** Archived point-history at the on-air focus — lifted once in WatchSurface
   *  (see lib/history-client's usePointHistory) so this panel and the globe's
   *  weather-point marker read the same fetch. */
  series: HistorySeries[];
  /** Human-readable on-air place name for the shared local monitor focus. */
  locationLabel?: string | null;
  theme?: BroadcastTheme;
}) {
  const location = formatMonitorLocation(series, locationLabel);
  const visible = WEATHER_MONITORS.map((spec) => {
    const samples = historySamples(series, spec.variable);
    if (!samples) return null;
    const units = series.find((s) => s.variable === spec.variable)?.units ?? "";
    const latest = samples[samples.length - 1].v;
    return { spec, samples, latestLabel: `${formatReading(latest)}${units ? ` ${units}` : ""}` };
  }).filter((item): item is { spec: (typeof WEATHER_MONITORS)[number]; samples: { v: number }[]; latestLabel: string } => item != null);

  if (visible.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", pointerEvents: "none" }}>
      <style>{"@keyframes weather-row-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "#dfe7f5" }}>
        <WindIcon active size={11} />
        LOCAL MONITORS
      </span>
      <div style={{ display: "flex", gap: 10 }}>
        {visible.map((item) => (
          <WeatherMonitorBox
            key={item.spec.variable}
            spec={item.spec}
            samples={item.samples}
            latestLabel={item.latestLabel}
            locationLabel={location}
            theme={theme}
          />
        ))}
      </div>
    </div>
  );
}
