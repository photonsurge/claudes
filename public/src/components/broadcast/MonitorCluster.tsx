"use client";

/**
 * Bottom-right "GLOBAL MONITOR": a scrolling seismograph + a real tide gauge,
 * both keyed to WHAT'S ON AIR. The seismo reflects the quakes relevant to the
 * focused event/region (its magnitude drives the amplitude + the M-tag); the
 * tsunami gauge plots the genuine recent water-level series of a coastal
 * station near the shot (worker-cached IOC data), cycling through whichever
 * nearby gauges are cached — same pattern as the seismic feed. Each readout
 * HIDES when it isn't relevant — no nearby quake, or no coastal gauge in
 * range — and the whole card disappears when neither applies, so it never
 * shows ambient filler.
 */
import type { Segment } from "@photonsurge/shared/director";
import type { TideSample } from "@photonsurge/shared/tides/types";
import { nearby } from "../../lib/geo";
import { useTideGauge } from "../../lib/tide-gauge";
import type { Quake } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

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
function realLinePath(samples: { v: number }[], w: number, h: number): string {
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
function realWavePath(samples: { v: number }[], w: number, h: number): string {
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
  tag,
  caption,
  children,
  theme,
}: {
  title: string;
  tag?: string;
  /** Small readout overlaid at the bottom-left of the trace box. */
  caption?: React.ReactNode;
  children: React.ReactNode;
  theme: BroadcastTheme;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.1, color: "#9fb0c8" }}>{title}</span>
        {tag ? (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 1,
              color: theme.accent,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 118,
            }}
          >
            {tag}
          </span>
        ) : null}
      </div>
      <div
        style={{
          height: 42,
          borderRadius: 6,
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
              left: 6,
              bottom: 4,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 0.5,
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

const W = 300;

export default function MonitorCluster({
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

  // Always call the hook (rules of hooks); stations is [] until a gauge is near.
  const tide = useTideGauge(focus, true);

  // ── Seismic relevance ──────────────────────────────────────────────────
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

  // ── Tsunami relevance ──────────────────────────────────────────────────
  // A coastal gauge being in range IS the relevance signal — draw its real
  // series. Hide entirely when nothing's cached near the shot. The caller
  // (this hook) cycles `tide.active` through `tide.stations` on a timer, same
  // as the seismic feed, so a stretch of coast shows more than one gauge.
  const tideActive = tide.active;
  const samples = tideActive?.samples?.length ? tideActive.samples : null;
  const showTsunami = !!samples;
  const tideIdx = tideActive ? tide.stations.indexOf(tideActive) : -1;
  const tideTag =
    tideActive && tideIdx >= 0
      ? `${truncate(tideActive.name, 14)}${tide.stations.length > 1 ? ` · ${tideIdx + 1}/${tide.stations.length}` : ""}`
      : "SEA LEVEL";

  if (!showSeismic && !showTsunami) return null;

  const tr = samples ? trend(samples) : null;

  return (
    <div
      style={{
        width: 210,
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "10px 12px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderRadius: 12,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <style>{"@keyframes bcast-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "#dfe7f5" }}>GLOBAL MONITOR</div>

      {showSeismic ? (
        <Panel
          title="SEISMIC MONITOR"
          tag={maxMag > 0 ? `M${maxMag.toFixed(1)}` : "PLOT"}
          caption={stationCaption ?? (seismicPlace ? truncate(seismicPlace, 34) : undefined)}
          theme={theme}
        >
          {realSeismoSamples ? (
            <svg
              width="200%"
              height="100%"
              viewBox={`0 0 ${W * 2} 42`}
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, animation: "bcast-trace 9s linear infinite" }}
            >
              <path d={realLinePath(realSeismoSamples, W, 42)} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
              <path
                d={realLinePath(realSeismoSamples, W, 42)}
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
              viewBox={`0 0 ${W * 2} 42`}
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, animation: "bcast-trace 6s linear infinite" }}
            >
              <path d={seismoPath(W, 42, amp)} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
              <path d={seismoPath(W, 42, amp)} transform={`translate(${W},0)`} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
            </svg>
          )}
        </Panel>
      ) : null}

      {showTsunami && samples ? (
        <Panel
          title="TSUNAMI GAUGE"
          tag={tideTag}
          caption={
            tr ? (
              <span>
                {tideActive?.latest?.toFixed(2)} m <span style={{ color: tr.color }}>{tr.arrow}</span>
              </span>
            ) : undefined
          }
          theme={theme}
        >
          <svg
            width="200%"
            height="100%"
            viewBox={`0 0 ${W * 2} 42`}
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, animation: "bcast-trace 11s linear infinite" }}
          >
            <path d={realWavePath(samples, W, 42)} fill="rgba(60,150,230,0.5)" />
            <path d={realWavePath(samples, W, 42)} transform={`translate(${W},0)`} fill="rgba(60,150,230,0.5)" />
          </svg>
        </Panel>
      ) : null}
    </div>
  );
}

/** Clip a label to `max` chars with an ellipsis (the tag already CSS-ellipsizes,
 *  but captions have no width box). */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
