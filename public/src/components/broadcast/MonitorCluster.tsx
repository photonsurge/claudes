"use client";

/**
 * Bottom-right "GLOBAL MONITOR": a scrolling seismograph + a tsunami gauge wave.
 * The traces are deterministic SVG paths scrolled by CSS (no rAF); the seismo
 * amplitude scales with the strongest live quake and shows its magnitude, so the
 * panel actually reflects the feed rather than being pure eye-candy.
 */
import type { Quake } from "../../lib/tracks/types";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

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
    // Baseline tremor + rarer big spikes where noise is extreme.
    const base = noise(i) * 0.18;
    const spike = Math.abs(noise(i * 1.7)) > 0.86 ? noise(i * 3.1) * 0.9 : 0;
    const y = mid - (base + spike) * amp * (h * 0.46);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/** A smooth filled tsunami wave over [0..w]. */
function wavePath(w: number, h: number): string {
  const pts: string[] = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const y = h * 0.55 - Math.sin((i / n) * Math.PI * 4) * h * 0.28;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M0,${h} L${pts.join(" L")} L${w},${h} Z`;
}

function Panel({
  title,
  tag,
  children,
  theme,
}: {
  title: string;
  tag?: string;
  children: React.ReactNode;
  theme: BroadcastTheme;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.1, color: "#9fb0c8" }}>
          {title}
        </span>
        {tag ? (
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
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
      </div>
    </div>
  );
}

export default function MonitorCluster({
  quakes,
  theme = DEFAULT_THEME,
}: {
  quakes: Quake[];
  theme?: BroadcastTheme;
}) {
  const maxMag = quakes.reduce((m, q) => Math.max(m, q.mag), 0);
  const amp = Math.min(1, Math.max(0.2, maxMag / 7));
  const W = 300;

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
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "#dfe7f5" }}>
        GLOBAL MONITOR
      </div>

      <Panel title="SEISMIC MONITOR" tag={maxMag > 0 ? `M${maxMag.toFixed(1)}` : "PLOT"} theme={theme}>
        <svg
          width="200%"
          height="100%"
          viewBox={`0 0 ${W * 2} 42`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, animation: "bcast-trace 6s linear infinite" }}
        >
          <path d={seismoPath(W, 42, amp)} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
          <path
            d={seismoPath(W, 42, amp)}
            transform={`translate(${W},0)`}
            fill="none"
            stroke="#43d9ff"
            strokeWidth="1.2"
          />
        </svg>
      </Panel>

      <Panel title="TSUNAMI GAUGE" tag="SEA LEVEL" theme={theme}>
        <svg
          width="200%"
          height="100%"
          viewBox={`0 0 ${W * 2} 42`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, animation: "bcast-trace 11s linear infinite" }}
        >
          <path d={wavePath(W, 42)} fill="rgba(60,150,230,0.5)" />
          <path d={wavePath(W, 42)} transform={`translate(${W},0)`} fill="rgba(60,150,230,0.5)" />
        </svg>
      </Panel>
    </div>
  );
}
