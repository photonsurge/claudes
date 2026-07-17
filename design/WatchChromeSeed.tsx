"use client";

/**
 * WatchChromeSeed — a SELF-CONTAINED reproduction of the /watch broadcast chrome
 * for iterating on the UI in isolation (e.g. a claude.ai design project), then
 * porting refinements back into public/src/components/broadcast/*.
 *
 * NOTHING here is wired to the app: no sockets, no deck.gl globe, no real data.
 * Every panel renders from hardcoded fake-but-realistic values so the whole
 * on-air frame lays out exactly as it does live, at the real 1920×1080 design
 * stage, scaled to fit the window.
 *
 * Mapping back to the real code (so a change here has an obvious home):
 *   Tokens .............. broadcast/config.ts (BROADCAST_THEMES) + BroadcastCard INK/MUTED/…
 *   Ticker .............. broadcast/Ticker.tsx
 *   BrandPanel .......... broadcast/BrandPanel.tsx
 *   IntensityMeter ...... broadcast/IntensityMeter.tsx
 *   LiveAlertPanel ...... broadcast/LiveAlertPanel.tsx
 *   EventOverlay ........ broadcast/EventOverlay.tsx (reticle + tracking label + lower third)
 *   WorldReport ......... broadcast/WorldReportDeck + WorldSituationPanel + WorldWatchPanel + WorldFeed
 *   Monitors ............ broadcast/MonitorCluster.tsx (Seismic / Tsunami / Weather)
 *   Left deck card ...... broadcast/SlideDeck.tsx + BroadcastCard.tsx (deck template) + mode-slides.tsx
 *   Syslog / Up next .... broadcast/SyslogFeed.tsx + UpNextPanel.tsx
 *   Layout .............. broadcast/BroadcastFrame.tsx (region anchors)
 *
 * A small floating THEME SWITCHER (top-right, pointer-enabled — the only
 * non-broadcast chrome) lets you preview all four themes incl. "claude".
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ============================================================================
 * THEME TOKENS  — mirror broadcast/config.ts
 * ==========================================================================*/
interface BroadcastTheme {
  name: string;
  tagline: string;
  strapline?: string;
  tickerTitle: string;
  meterTitle: string;
  accent: string;
  panelBg: string;
  panelBorder: string;
}

const THEMES: Record<string, BroadcastTheme> = {
  command: {
    name: "G.O.D.S.",
    tagline: "Global Orbital Detection System",
    strapline: "DETECT. TRACK. PROTECT.",
    tickerTitle: "VIGIL TAPE",
    meterTitle: "THREAT MATRIX",
    accent: "#4dc8ff",
    panelBg: "linear-gradient(180deg, rgba(10,20,38,0.86), rgba(6,13,26,0.93))",
    panelBorder: "1px solid rgba(90,150,210,0.32)",
  },
  aurora: {
    name: "G.O.D.S.",
    tagline: "Global Orbital Detection System",
    tickerTitle: "GLOBAL FEED",
    meterTitle: "INTENSITY METER",
    accent: "#38bdf8",
    panelBg: "linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.9))",
    panelBorder: "1px solid rgba(120,140,170,0.25)",
  },
  storm: {
    name: "STORM WATCH LIVE",
    tagline: "SEVERE WEATHER OPERATIONS",
    tickerTitle: "STORM FEED",
    meterTitle: "INTENSITY METER",
    accent: "#f43f5e",
    panelBg: "linear-gradient(180deg, rgba(24,12,20,0.84), rgba(14,8,14,0.92))",
    panelBorder: "1px solid rgba(200,120,140,0.26)",
  },
  // Claude's brand language — coral/terracotta accent over warm espresso glass.
  claude: {
    name: "CLAUDE",
    tagline: "LIVE PLANETARY WEATHER",
    tickerTitle: "GLOBAL FEED",
    meterTitle: "INTENSITY",
    accent: "#d97757",
    panelBg: "linear-gradient(180deg, rgba(32,26,22,0.84), rgba(21,17,14,0.93))",
    panelBorder: "1px solid rgba(217,119,87,0.28)",
  },
};

const LIVE_RED = "#ff3b3b";
// Shared left-column ink tokens (BroadcastCard.tsx)
const INK = "#e6edf7";
const MUTED = "#9fb3cc";
const DIM = "#8ea3bf";
const DIVIDER = "1px solid rgba(120,140,170,0.15)";
const ON_AIR_RED = "#ff3b3b";

function accentBorder(base: string, left: string) {
  return { borderTop: base, borderRight: base, borderBottom: base, borderLeft: left };
}

// Per-kind accent + labels (broadcast/kinds.ts)
const KIND_COLOR: Record<string, string> = {
  intro: "#1f9d72", global: "#1f9d72", ocean: "#1c7fb8", orbital: "#6a59c0",
  country: "#3f8f8f", region: "#4a8f6f", point: "#2f8f4e", storm: "#d23a3a",
  volcano: "#c2410c", quake: "#e08a1e", flight: "#2aa6c0", ship: "#3b6ea5", ad: "#d4a017",
};
const KIND_LABEL: Record<string, string> = {
  intro: "Live", global: "Live", ocean: "Ocean", orbital: "Orbital", country: "Country",
  region: "Region", point: "Point", storm: "Severe", volcano: "Volcano", quake: "Seismic",
  flight: "Aircraft", ship: "Vessel", ad: "Sponsor",
};

const STAGE_W = 1920;
const STAGE_H = 1080;
const TICKER_H = 34;
const INSET = 30;
const BRAND_STACK_H = 150;

const FONT = "system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/* ============================================================================
 * FAKE DATA  — swap freely; shapes mirror the real props
 * ==========================================================================*/
const SEGMENT = {
  kind: "storm",
  title: "Tropical Cyclone Freya",
  subtitle: "Category 4 · Coral Sea",
  details: [
    { label: "Severity", value: "Extreme" },
    { label: "Type", value: "Tropical Cyclone" },
    { label: "Max Winds", value: "215 km/h" },
    { label: "Pressure", value: "934 hPa" },
    { label: "Movement", value: "WSW 22 km/h" },
  ],
};

const TICKER_ITEMS = [
  "⚠ EXTREME · Tropical Cyclone Freya nears Queensland coast — evacuations ordered",
  "M6.2 earthquake · 42km SW of Valparaíso, Chile · depth 31km",
  "✈ AF1 (VC-25) · FL410 over North Atlantic · 912 km/h",
  "🌋 Sakurajima · ongoing eruption · ash to 3,400 m",
  "SEVERE · Flash-flood emergency · Rio Grande do Sul, Brazil",
  "🚢 Ever Given · 24.1 kn · approaching Suo-nada",
];

const WORLD = {
  alertTotal: 342,
  quakeCount: 63,
  volcanoCount: 7,
  maxQuake: { mag: 6.2, place: "Valparaíso, Chile" },
  bySeverity: [
    { rank: 4, label: "Extreme", count: 34, color: "#b91c1c" },
    { rank: 3, label: "Severe", count: 96, color: "#ef4444" },
    { rank: 2, label: "Moderate", count: 142, color: "#f59e0b" },
    { rank: 1, label: "Minor", count: 70, color: "#eab308" },
  ],
  byMagClass: [
    { cls: "major", label: "Major 6+", count: 3, color: "#b91c1c" },
    { cls: "strong", label: "Strong 5+", count: 12, color: "#f97316" },
    { cls: "moderate", label: "Moderate 4+", count: 48, color: "#eab308" },
  ],
  byVolcanoStatus: [
    { status: "erupting", label: "Erupting", count: 4, color: "#ef4444" },
    { status: "warning", label: "Warning", count: 3, color: "#f59e0b" },
  ],
  byContinent: [
    { continent: "Asia", alertCount: 129, quakeCount: 28, volcanoCount: 3,
      bySeverity: [{ rank: 4, color: "#b91c1c", count: 14 }, { rank: 3, color: "#ef4444", count: 41 }, { rank: 2, color: "#f59e0b", count: 74 }],
      byMagClass: [{ cls: "major", color: "#b91c1c", count: 2 }, { cls: "strong", color: "#f97316", count: 7 }, { cls: "moderate", color: "#eab308", count: 19 }],
      byVolcanoStatus: [{ status: "erupting", color: "#ef4444", count: 2 }, { status: "warning", color: "#f59e0b", count: 1 }] },
    { continent: "Americas", alertCount: 96, quakeCount: 21, volcanoCount: 3,
      bySeverity: [{ rank: 4, color: "#b91c1c", count: 11 }, { rank: 3, color: "#ef4444", count: 30 }, { rank: 2, color: "#f59e0b", count: 55 }],
      byMagClass: [{ cls: "major", color: "#b91c1c", count: 1 }, { cls: "strong", color: "#f97316", count: 4 }, { cls: "moderate", color: "#eab308", count: 16 }],
      byVolcanoStatus: [{ status: "erupting", color: "#ef4444", count: 2 }, { status: "warning", color: "#f59e0b", count: 1 }] },
    { continent: "Europe", alertCount: 63, quakeCount: 7, volcanoCount: 1,
      bySeverity: [{ rank: 3, color: "#ef4444", count: 18 }, { rank: 2, color: "#f59e0b", count: 45 }],
      byMagClass: [{ cls: "moderate", color: "#eab308", count: 7 }],
      byVolcanoStatus: [{ status: "warning", color: "#f59e0b", count: 1 }] },
    { continent: "Africa", alertCount: 32, quakeCount: 4, volcanoCount: 0,
      bySeverity: [{ rank: 2, color: "#f59e0b", count: 32 }],
      byMagClass: [{ cls: "moderate", color: "#eab308", count: 4 }],
      byVolcanoStatus: [] },
    { continent: "Oceania", alertCount: 22, quakeCount: 3, volcanoCount: 0,
      bySeverity: [{ rank: 4, color: "#b91c1c", count: 9 }, { rank: 2, color: "#f59e0b", count: 13 }],
      byMagClass: [{ cls: "moderate", color: "#eab308", count: 3 }],
      byVolcanoStatus: [] },
  ],
  feed: [
    { key: "a1", kind: "alert", icon: "⚠", tag: "EXT", color: "#b91c1c", flag: "🇦🇺", title: "Tropical Cyclone Warning", sub: "Queensland Coast", expiresIn: "6h" },
    { key: "q1", kind: "quake", icon: "🌐", tag: "M6.2", color: "#f97316", flag: "🇨🇱", title: "42km SW of Valparaíso", sub: "Depth 31 km", expiresIn: "" },
    { key: "a2", kind: "alert", icon: "🌊", tag: "SEV", color: "#ef4444", flag: "🇧🇷", title: "Flash Flood Emergency", sub: "Rio Grande do Sul", expiresIn: "3h" },
    { key: "v1", kind: "volcano", icon: "🌋", tag: "ERUPT", color: "#ef4444", flag: "🇯🇵", title: "Sakurajima", sub: "Ash to 3,400 m", expiresIn: "" },
    { key: "a3", kind: "alert", icon: "❄", tag: "SEV", color: "#ef4444", flag: "🇺🇸", title: "Winter Storm Warning", sub: "Upper Midwest", expiresIn: "12h" },
    { key: "q2", kind: "quake", icon: "🌐", tag: "M5.4", color: "#f97316", flag: "🇮🇩", title: "Molucca Sea", sub: "Depth 62 km", expiresIn: "" },
    { key: "a4", kind: "alert", icon: "🔥", tag: "MOD", color: "#f59e0b", flag: "🇬🇷", title: "Extreme Fire Danger", sub: "Attica Region", expiresIn: "8h" },
  ],
};

// Wind intensity palette (IntensityMeter reproduced with a fixed ramp)
const WIND_PALETTE: [number, string][] = [
  [0, "#2b4c8c"], [0.15, "#3b82c4"], [0.35, "#38a169"], [0.55, "#eab308"],
  [0.72, "#f97316"], [0.86, "#dc2626"], [1, "#8b2fb0"],
];
const WIND_STOPS = [
  { t: 0, label: "0" }, { t: 0.2, label: "20" }, { t: 0.4, label: "40" },
  { t: 0.6, label: "80" }, { t: 0.8, label: "140" }, { t: 1, label: "220+" },
];
const METER_META = { label: "Wind Speed", unit: "km/h" };
const FRESHNESS = { source: "NOAA GFS", generatedLabel: "12Z", updatedLabel: "14m ago", runLabel: "12Z" };

// deterministic pseudo-noise (MonitorCluster.tsx)
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}
function seismoPath(w: number, h: number, amp: number): string {
  const mid = h / 2; const pts: string[] = []; const n = 120;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const base = noise(i) * 0.18;
    const spike = Math.abs(noise(i * 1.7)) > 0.86 ? noise(i * 3.1) * 0.9 : 0;
    pts.push(`${x.toFixed(1)},${(mid - (base + spike) * amp * (h * 0.46)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}
function realWavePath(vals: number[], w: number, h: number): string {
  const n = vals.length; if (!n) return `M0,${h} L${w},${h} Z`;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const norm = span > 1e-6 ? (vals[i] - min) / span : 0.5;
    pts.push(`${x.toFixed(1)},${(h * 0.85 - norm * (h * 0.7)).toFixed(1)}`);
  }
  return `M0,${h} L${pts.join(" L")} L${w},${h} Z`;
}
function realLinePath(vals: number[], w: number, h: number): string {
  const n = vals.length; if (!n) return `M0,${h / 2} L${w},${h / 2}`;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const norm = span > 1e-6 ? (vals[i] - min) / span : 0.5;
    pts.push(`${x.toFixed(1)},${(h * 0.85 - norm * (h * 0.7)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}
const TIDE_SAMPLES = [1.2, 1.35, 1.5, 1.42, 1.28, 1.15, 1.05, 1.18, 1.44, 1.62, 1.75, 1.68, 1.5, 1.33, 1.2, 1.28];
const WIND_SERIES = [12, 15, 22, 34, 41, 55, 62, 58, 47, 39, 44, 51, 63, 71, 68, 59];
const PRESS_SERIES = [1012, 1009, 1004, 998, 991, 984, 978, 972, 968, 966, 969, 974, 980, 986, 992, 997];
const WAVE_SERIES = [1.1, 1.4, 1.9, 2.6, 3.4, 4.1, 4.8, 5.2, 4.9, 4.3, 3.8, 3.1, 2.7, 2.3, 2.0, 1.8];

/* ============================================================================
 * ICONS + GLYPHS  (icons.tsx / glyphs.tsx)
 * ==========================================================================*/
function HeartbeatIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (<svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}><path d="M1 8 L4 8 L5.5 3 L8 13 L10 5 L11.5 8 L15 8" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function WaveIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (<svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}><path d="M1 10.5 C2.5 6.5 4.5 6.5 6 10.5 C7.5 14.5 9.5 14.5 11 10.5 C12.5 6.5 14.5 6.5 15 10.5" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function WindIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (<svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}><path d="M1 5 H9 C11.5 5 11.5 2 9 2 M1 8.2 H12.3 C15 8.2 15 11.5 12.3 11.5 M1 11.5 H7" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>);
}
function GaugeIcon({ active = false, size = 12 }: { active?: boolean; size?: number }) {
  const color = active ? "#43d9ff" : "#c8d5e6";
  return (<svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}><path d="M2 12.5 A6 6 0 0 1 14 12.5" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><path d="M8 12.5 L11 7.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="12.5" r="1.1" fill={color} /></svg>);
}
// Targeted-event identity mark (glyphs.tsx KindGlyph — storm shown; others analogous)
function KindGlyph({ kind, color, size = 24 }: { kind: string; color: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    storm: (<><circle cx="12" cy="12" r="2" fill={color} /><path d="M12 3.5 C17.5 3.5 19.5 7 18.2 11 C17.4 8 14.5 6.4 12 7 Z" fill={color} /><path d="M12 20.5 C6.5 20.5 4.5 17 5.8 13 C6.6 16 9.5 17.6 12 17 Z" fill={color} /></>),
    quake: (<><circle cx="12" cy="12" r="2.6" fill={color} /><path d="M6.5 5.5 A9 9 0 0 0 6.5 18.5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" /><path d="M17.5 5.5 A9 9 0 0 1 17.5 18.5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" /></>),
    volcano: (<path d="M2 21 L9 7.5 L11.5 11.5 L15 4 L22 21 Z" fill={color} />),
  };
  const draw = paths[kind]; if (!draw) return null;
  return (<svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", display: "block" }} aria-hidden>{draw}</svg>);
}

/* ============================================================================
 * TICKER  (Ticker.tsx)
 * ==========================================================================*/
function Ticker({ title, items, edge, height = 34, theme }: { title: string; items: string[]; edge: "top" | "bottom"; height?: number; theme: BroadcastTheme }) {
  const line = items.length ? items.join("     ❯     ") : "STANDING BY · AWAITING LIVE FEED";
  const dur = Math.max(24, line.length * 0.16);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, [edge]: 0, height, display: "flex", alignItems: "center", background: "linear-gradient(180deg, rgba(6,10,18,0.94), rgba(4,7,13,0.9))", borderBottom: edge === "top" ? "1px solid rgba(120,140,170,0.2)" : undefined, borderTop: edge === "bottom" ? "1px solid rgba(120,140,170,0.2)" : undefined, overflow: "hidden", color: "#dfe7f5", fontFamily: FONT, pointerEvents: "none" }}>
      <style>{"@keyframes bcast-crawl{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ flex: "0 0 auto", zIndex: 2, height: "100%", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#fff", background: theme.accent, clipPath: "polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)", paddingRight: 20, textTransform: "uppercase", whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden", height: "100%" }}>
        <div style={{ position: "absolute", top: 0, display: "inline-flex", alignItems: "center", height: "100%", whiteSpace: "nowrap", animation: `bcast-crawl ${dur}s linear infinite`, fontSize: 12, fontWeight: 600, letterSpacing: 0.6 }}>
          <span style={{ paddingLeft: 24 }}>{line}</span>
          <span style={{ paddingLeft: 24 }}>{line}</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * BRAND PANEL  (BrandPanel.tsx) — text/monogram variant (no external banner png)
 * ==========================================================================*/
const WORLD_CLOCKS = [
  { label: "LONDON", tz: "Europe/London" }, { label: "NEW YORK", tz: "America/New_York" },
  { label: "BEIJING", tz: "Asia/Shanghai" }, { label: "TOKYO", tz: "Asia/Tokyo" }, { label: "MOSCOW", tz: "Europe/Moscow" },
];
function useWorldClocks() {
  const [clocks, setClocks] = useState(() => WORLD_CLOCKS.map((c) => ({ label: c.label, time: "" })));
  useEffect(() => {
    const tick = () => setClocks(WORLD_CLOCKS.map((c) => ({ label: c.label, time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: c.tz }) })));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, []);
  return clocks;
}
function BrandPanel({ theme, live = false, status }: { theme: BroadcastTheme; live?: boolean; status: { shotKind: string | null; shotTarget: string | null; attribute: string | null } }) {
  const clocks = useWorldClocks();
  const cells = [...(status.shotKind ? [{ label: status.shotKind, value: status.shotTarget ?? "—" }] : []), { label: "MAP", value: status.attribute ?? "—" }];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      <style>{"@keyframes bcast-livepulse{0%,100%{opacity:1}50%{opacity:0.35}}"}</style>
      {/* Mark + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 14px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 12, boxShadow: "0 8px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}>
        <svg width={34} height={34} viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r="18" fill="none" stroke={theme.accent} strokeWidth="2" />
          <circle cx="20" cy="20" r="18" fill="rgba(120,190,255,0.06)" />
          <path d="M13 12h9a6 6 0 0 1 0 12h-9z M22 24l6 5" fill="none" stroke="#cfe2ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: 1.3, color: "#fff", fontFamily: FONT }}>{theme.name}</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: "#8fb6e6", opacity: 0.8, fontFamily: FONT }}>{theme.tagline}</span>
          {theme.strapline && <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: 1.4, color: "#5f87ad", opacity: 0.85, marginTop: 1, fontFamily: FONT }}>{theme.strapline}</span>}
        </div>
      </div>
      {/* LIVE + status + clocks strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", marginTop: -6 }}>
        {live && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 8px", clipPath: "polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)", background: "linear-gradient(180deg, rgba(40,6,6,0.95), rgba(20,3,3,0.95))", border: `1px solid ${LIVE_RED}8c`, fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: "#fff", textShadow: `0 0 8px ${LIVE_RED}cc`, boxShadow: `0 0 14px ${LIVE_RED}73, inset 0 0 8px ${LIVE_RED}33` }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", boxShadow: `0 0 6px ${LIVE_RED}`, animation: "bcast-livepulse 1.4s ease-in-out infinite" }} />LIVE
          </div>
        )}
        <div style={{ display: "flex", alignItems: "stretch", gap: 6, padding: "5px 11px", background: "linear-gradient(180deg, rgba(8,13,24,0.72), rgba(5,9,18,0.84))", border: theme.panelBorder, borderRadius: 7, boxShadow: "0 8px 22px rgba(0,0,0,0.34)", backdropFilter: "blur(8px)", fontFamily: FONT }}>
          {cells.map((cell, i) => (
            <div key={cell.label} style={{ display: "flex", alignItems: "baseline", gap: 4, ...(i > 0 ? { borderLeft: "1px solid rgba(255,255,255,0.09)", paddingLeft: 7 } : {}) }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.9, color: theme.accent, opacity: 0.85, textTransform: "uppercase" }}>{cell.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: "#dce9fb", whiteSpace: "nowrap", textTransform: "uppercase" }}>{cell.value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${WORLD_CLOCKS.length}, minmax(0, 1fr))`, gap: 6, padding: "7px 12px", background: "linear-gradient(180deg, rgba(8,13,24,0.72), rgba(5,9,18,0.84))", border: theme.panelBorder, borderRadius: 10, boxShadow: "0 8px 22px rgba(0,0,0,0.34)", backdropFilter: "blur(8px)" }}>
          {clocks.map((clock, i) => {
            const primary = i === 0;
            return (
              <div key={clock.label} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
                <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT, fontSize: primary ? 8 : 6.5, fontWeight: 800, letterSpacing: 0.7, color: theme.accent, opacity: 0.9 }}>{clock.label}</span>
                <span style={{ fontFamily: MONO, fontSize: primary ? 12.5 : 10, fontWeight: 700, color: "#dce9fb", fontVariantNumeric: "tabular-nums", textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>{clock.time || "--:--:--"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * INTENSITY METER  (IntensityMeter.tsx)
 * ==========================================================================*/
function IntensityMeter({ theme }: { theme: BroadcastTheme }) {
  const gradient = `linear-gradient(to right, ${WIND_PALETTE.map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`).join(", ")})`;
  const barW = 360;
  const hexAt = (t: number) => {
    let best = WIND_PALETTE[0][1], bd = Infinity;
    for (const [stop, hex] of WIND_PALETTE) { const d = Math.abs(stop - t); if (d < bd) { bd = d; best = hex; } }
    return best;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none", fontFamily: FONT, color: "#dfe7f5", transform: "translateY(-22px)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginTop: 2, fontSize: 12, fontWeight: 800, letterSpacing: 0.9, color: "#dfe7f5", opacity: 0.82, textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
          SOURCE {FRESHNESS.source} · CREATED {FRESHNESS.generatedLabel} ({FRESHNESS.updatedLabel}) · RUN {FRESHNESS.runLabel}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.05, color: "#fff", marginTop: 2, textShadow: "0 1px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)" }}>
          {METER_META.label}<span style={{ fontSize: 15, fontWeight: 700, color: hexAt(1), marginLeft: 6 }}>{METER_META.unit}</span>
        </div>
      </div>
      <div style={{ width: barW, height: 19, borderRadius: 5, background: gradient, border: "1px solid rgba(0,0,0,0.6)", boxShadow: "0 4px 14px rgba(0,0,0,0.5), inset 0 0 6px rgba(0,0,0,0.4)" }} />
      <div style={{ width: barW, display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {WIND_STOPS.map((s, i) => (<span key={i} style={{ color: hexAt(s.t), opacity: 0.95, whiteSpace: "nowrap", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>{s.label}</span>))}
      </div>
    </div>
  );
}

/* ============================================================================
 * LIVE ALERT PANEL  (LiveAlertPanel.tsx — single most-severe active alert)
 * ==========================================================================*/
function LiveAlertPanel({ theme }: { theme: BroadcastTheme }) {
  const color = "#f97316"; // severity colour (severe)
  const top = { banner: "AU · Tropical Cyclone Warning — Queensland Coast", ago: "12m", pos: 1, total: 3, instruction: "Destructive winds and a dangerous storm surge near landfall. Move indoors, away from windows, and follow evacuation orders." };
  return (
    <div style={{ position: "relative", maxWidth: 340, padding: "10px 30px 10px 14px", background: theme.panelBg, ...accentBorder(theme.panelBorder, `3px solid ${color}`), borderRadius: 10, boxShadow: `0 8px 26px rgba(0,0,0,0.45), 0 0 14px ${color}33`, backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT, textAlign: "right" }}>
      <style>{"@keyframes bcast-alertpulse{0%,100%{opacity:1}50%{opacity:0.5}}"}</style>
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 18, background: color, borderRadius: "0 9px 9px 0", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 8, fontWeight: 800, letterSpacing: 2, writingMode: "vertical-rl", textShadow: "0 1px 1px rgba(0,0,0,0.5)" }}>NEW</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color: "#9fb0c8", marginBottom: 3 }}>
        <span>NEW ALERTS</span><span style={{ color, letterSpacing: 1, fontWeight: 700 }}>ISSUED {top.ago.toUpperCase()} AGO</span><span style={{ color, letterSpacing: 1 }}>{top.pos}/{top.total}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, fontSize: 14, fontWeight: 700, color, textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
        <span>{top.banner}</span>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, animation: "bcast-alertpulse 1.2s ease-in-out infinite", flex: "0 0 auto" }} />
      </div>
      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 500, color: "#c9d3e3", textShadow: "0 1px 2px rgba(0,0,0,0.8)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{top.instruction}</div>
    </div>
  );
}

/* ============================================================================
 * SPACE WEATHER METER + KP  (SpaceWeatherMeter.tsx / KpIndexPanel.tsx)
 * ==========================================================================*/
function SpaceWeatherMeter({ theme }: { theme: BroadcastTheme }) {
  const auroraGradient = "linear-gradient(to right, #1ef07a 0%, #7bf05a 35%, #e6f23a 60%, #f2802e 80%, #ff2e5a 100%)";
  const geomagGradient = "linear-gradient(to right, #2b2f8f 0%, #2f7dc6 25%, #48c9a9 50%, #cfe05a 70%, #f29b2e 85%, #c0181f 100%)";
  const Ramp = ({ label, gradient, loLabel, hiLabel }: { label: string; gradient: string; loLabel: string; hiLabel: string }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700 }}>{label}</span>
      <div style={{ height: 7, borderRadius: 4, background: gradient, border: "1px solid rgba(0,0,0,0.5)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, opacity: 0.75 }}><span>{loLabel}</span><span>{hiLabel}</span></div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "9px 11px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 12, boxShadow: "0 8px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT, color: "#dfe7f5", width: 300 }}>
      <Ramp label="Aurora oval" gradient={auroraGradient} loLabel="3%" hiLabel="50%+" />
      <Ramp label="Magnetic field" gradient={geomagGradient} loLabel="23k nT" hiLabel="65k nT" />
    </div>
  );
}
function KpIndexPanel({ theme, kp = 5.3 }: { theme: BroadcastTheme; kp?: number }) {
  const level = kp >= 7 ? { code: "G3", name: "Strong storm", color: "#dc2626" } : kp >= 5 ? { code: "G1", name: "Minor storm", color: "#eab308" } : { code: "G0", name: "Quiet", color: "#34d399" };
  const SEGMENTS = 9;
  const filled = Math.max(0, Math.min(SEGMENTS, Math.round(kp)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 12, boxShadow: "0 8px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT, color: "#dfe7f5", width: 196 }}>
      <div style={{ lineHeight: 1, textAlign: "center" }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1.4, opacity: 0.55 }}>Kp</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: level.color, fontVariantNumeric: "tabular-nums", textShadow: `0 0 10px ${level.color}66` }}>{kp.toFixed(kp % 1 ? 1 : 0)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1.4, opacity: 0.55 }}>GEOMAGNETIC</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", marginTop: 1 }}><span style={{ color: level.color }}>{level.code}</span><span style={{ opacity: 0.85 }}> · {level.name}</span></div>
        <div style={{ display: "flex", gap: 2, marginTop: 5 }}>
          {Array.from({ length: SEGMENTS }, (_, i) => (<div key={i} style={{ flex: 1, height: 5, borderRadius: 1, background: i < filled ? level.color : "rgba(255,255,255,0.14)", boxShadow: i < filled ? `0 0 5px ${level.color}88` : "none" }} />))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * EVENT OVERLAY  (EventOverlay.tsx) — reticle + tracking label + lower third
 * ==========================================================================*/
const RETICLE_W = 660;
const RETICLE_H = 440;
function ReticleMarks({ color }: { color: string }) {
  const outer = 42, inGap = 8, inLen = 24, tick = 16, cx = RETICLE_W / 2, cy = RETICLE_H / 2;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${RETICLE_W} ${RETICLE_H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, filter: `drop-shadow(0 0 5px ${color}55)` }} aria-hidden>
      <g fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <path d={`M2 ${outer} L2 2 L${outer} 2`} /><path d={`M${RETICLE_W - 2} ${outer} L${RETICLE_W - 2} 2 L${RETICLE_W - outer} 2`} />
        <path d={`M2 ${RETICLE_H - outer} L2 ${RETICLE_H - 2} L${outer} ${RETICLE_H - 2}`} /><path d={`M${RETICLE_W - 2} ${RETICLE_H - outer} L${RETICLE_W - 2} ${RETICLE_H - 2} L${RETICLE_W - outer} ${RETICLE_H - 2}`} />
        <path d={`M${cx} 2 L${cx} ${2 + tick}`} /><path d={`M${cx} ${RETICLE_H - 2} L${cx} ${RETICLE_H - 2 - tick}`} />
        <path d={`M2 ${cy} L${2 + tick} ${cy}`} /><path d={`M${RETICLE_W - 2} ${cy} L${RETICLE_W - 2 - tick} ${cy}`} />
      </g>
      <g fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.5">
        <path d={`M${inGap} ${inGap + inLen} L${inGap} ${inGap} L${inGap + inLen} ${inGap}`} /><path d={`M${RETICLE_W - inGap} ${inGap + inLen} L${RETICLE_W - inGap} ${inGap} L${RETICLE_W - inGap - inLen} ${inGap}`} />
        <path d={`M${inGap} ${RETICLE_H - inGap - inLen} L${inGap} ${RETICLE_H - inGap} L${inGap + inLen} ${RETICLE_H - inGap}`} /><path d={`M${RETICLE_W - inGap} ${RETICLE_H - inGap - inLen} L${RETICLE_W - inGap} ${RETICLE_H - inGap} L${RETICLE_W - inGap - inLen} ${RETICLE_H - inGap}`} />
      </g>
    </svg>
  );
}
function LabelRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, padding: "2px 0", borderTop: "1px solid rgba(120,140,170,0.12)" }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: "#8ea3bf", minWidth: 92 }}>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
function EventOverlay({ theme, historyPanel, forecastPanel }: { theme: BroadcastTheme; historyPanel?: React.ReactNode; forecastPanel?: React.ReactNode }) {
  const color = KIND_COLOR[SEGMENT.kind] ?? "#38bdf8";
  const name = SEGMENT.title.toUpperCase();
  const left = (STAGE_W - RETICLE_W) / 2;
  const top0 = (STAGE_H - RETICLE_H) / 2 - 40;
  return (
    <div style={{ position: "absolute", left, top: top0, width: RETICLE_W, height: RETICLE_H, pointerEvents: "none" }}>
      <style>{`@keyframes bcast-reticle-scan{0%{transform:translateY(0);opacity:0}12%{opacity:0.5}88%{opacity:0.5}100%{transform:translateY(${RETICLE_H - 20}px);opacity:0}}`}</style>
      <div style={{ position: "absolute", inset: 0, transform: "perspective(1500px) rotateX(11deg) rotateY(-9deg)", transformOrigin: "center center", border: `1px solid ${color}55`, borderRadius: 6, background: `linear-gradient(180deg, ${color}0d, rgba(10,16,28,0.02))`, boxShadow: `inset 0 0 40px ${color}14`, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 10, right: 10, top: 10, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, boxShadow: `0 0 12px ${color}`, animation: "bcast-reticle-scan 4s ease-in-out infinite" }} />
        <ReticleMarks color={color} />
      </div>
      {/* Tracking-detail readout, top-left corner */}
      <div style={{ position: "absolute", top: -52, left: -48 }}>
        <div style={{ minWidth: 250, padding: "10px 14px", background: theme.panelBg, ...accentBorder(theme.panelBorder, `3px solid ${color}`), borderRadius: 10, boxShadow: "0 10px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", fontFamily: FONT, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, background: color, color: "#fff" }}>{KIND_LABEL[SEGMENT.kind]}</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color: "#9fb3cc" }}>▸ EVENT DETECTION OVERLAY</span>
          </div>
          <LabelRow label="EVENT TRACKING" value={`${name} [ACTIVE]`} color={color} />
          {SEGMENT.details.map((d) => (<LabelRow key={d.label} label={d.label.toUpperCase()} value={d.value} color={color} />))}
        </div>
      </div>
      {historyPanel ? <div style={{ position: "absolute", top: -44, right: -150 }}>{historyPanel}</div> : null}
      {forecastPanel ? <div style={{ position: "absolute", bottom: -108, right: -80 }}>{forecastPanel}</div> : null}
      {/* Lower-third event name */}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", maxWidth: RETICLE_W - 40, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: FONT, textShadow: "0 2px 12px rgba(0,0,0,0.85)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: "100%" }}>
          <KindGlyph kind={SEGMENT.kind} color={color} size={24} />
          <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: 1.5, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        </div>
        <div style={{ width: 130, height: 2, marginTop: 8, borderRadius: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, maxWidth: "100%" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, flex: "none" }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "#dbe7f7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{SEGMENT.subtitle}</span>
        </div>
      </div>
    </div>
  );
}

/* Compact point-history + forecast strips that hang off the reticle corners. */
function PointHistoryStrip({ theme }: { theme: BroadcastTheme }) {
  const path = realLinePath(PRESS_SERIES, 150, 40);
  return (
    <div style={{ width: 176, padding: "8px 12px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 10, boxShadow: "0 8px 22px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", fontFamily: FONT, pointerEvents: "none" }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: MUTED, marginBottom: 5 }}>▸ POINT HISTORY · 48H</div>
      <svg width="150" height="40" viewBox="0 0 150 40" preserveAspectRatio="none" style={{ display: "block" }}>
        <path d={path} fill="none" stroke={theme.accent} strokeWidth="1.4" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, fontWeight: 700, color: INK }}>
        <span>Pressure</span><span style={{ color: theme.accent }}>966 hPa ▼</span>
      </div>
    </div>
  );
}
function ForecastStrip({ theme }: { theme: BroadcastTheme }) {
  const days = [
    { d: "TODAY", hi: 29, lo: 24, c: "storm" }, { d: "FRI", hi: 27, lo: 23, c: "rain" },
    { d: "SAT", hi: 30, lo: 24, c: "partly-cloudy" },
  ];
  return (
    <div style={{ padding: "8px 12px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 10, boxShadow: "0 8px 22px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", fontFamily: FONT, pointerEvents: "none", display: "flex", gap: 12 }}>
      {days.map((d) => (
        <div key={d.d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 44 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, color: MUTED }}>{d.d}</span>
          <span style={{ fontSize: 18 }}>{d.c === "storm" ? "⛈" : d.c === "rain" ? "🌧" : "⛅"}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{d.hi}°</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: DIM }}>{d.lo}°</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
 * WORLD REPORT (top-right)  — DETECTION GRID + ACTIVE FEED (WorldReportDeck default slide)
 * ==========================================================================*/
function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 36, fontWeight: 800, color: "#fff", lineHeight: 1, textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color, marginTop: 5 }}>{label}</div>
    </div>
  );
}
function BreakdownChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, boxShadow: `0 0 5px ${color}99`, flex: "0 0 auto" }} />
      <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#c3cee0", letterSpacing: 0.3 }}>{label}</span>
    </span>
  );
}
function MiniBar({ count, segments, max }: { count: number; segments: { key: string; color: string; count: number }[]; max: number }) {
  const pct = max > 0 && count > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: 9, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", display: "flex" }}>
        {count > 0 && segments.map((s, i) => (<div key={s.key} style={{ width: `${(s.count / count) * 100}%`, height: "100%", background: s.color, borderRight: i < segments.length - 1 ? "1px solid rgba(0,0,0,0.4)" : undefined }} />))}
      </div>
    </div>
  );
}
function WorldSituationPanel({ theme }: { theme: BroadcastTheme }) {
  const s = WORLD;
  const topColor = s.bySeverity[0].color;
  const volcanoColor = s.byVolcanoStatus[0].color;
  const maxAlert = Math.max(1, ...s.byContinent.map((c) => c.alertCount));
  const maxQuake = Math.max(1, ...s.byContinent.map((c) => c.quakeCount));
  const maxVolcano = Math.max(1, ...s.byContinent.map((c) => c.volcanoCount));
  return (
    <div style={{ position: "relative", width: 400, padding: "20px 24px", background: theme.panelBg, ...accentBorder(theme.panelBorder, `5px solid ${topColor}`), borderRadius: 16, boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${topColor}28`, backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, fontWeight: 800, letterSpacing: 1.8, color: "#dfe7f5" }}>
        <span>DETECTION GRID</span><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>LAST 24H</span>
      </div>
      <div style={{ display: "flex", gap: 18 }}>
        <StatTile label="ALERTS" value={s.alertTotal} color={topColor} />
        <StatTile label="SEISMIC" value={s.quakeCount} color={theme.accent} />
        <StatTile label="VOLCANIC" value={s.volcanoCount} color={volcanoColor} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
        {s.bySeverity.map((b) => (<BreakdownChip key={b.rank} label={b.label} count={b.count} color={b.color} />))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
        {s.byMagClass.map((b) => (<BreakdownChip key={b.cls} label={b.label} count={b.count} color={b.color} />))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: "0 0 66px" }} />
          <span style={{ flex: 1, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: topColor }}>ALERTS</span>
          <span style={{ flex: "0 0 18px" }} />
          <span style={{ flex: 1, textAlign: "right", fontSize: 9, fontWeight: 800, letterSpacing: 1, color: theme.accent }}>SEISMIC</span>
          <span style={{ flex: "0 0 18px" }} />
          <span style={{ flex: 1, textAlign: "right", fontSize: 9, fontWeight: 800, letterSpacing: 1, color: volcanoColor }}>VOLCANIC</span>
          <span style={{ flex: "0 0 18px" }} />
        </div>
        {s.byContinent.map((c) => (
          <div key={c.continent} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: "0 0 66px", fontSize: 11, fontWeight: 700, color: "#c3cee0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.continent}</span>
            <MiniBar count={c.alertCount} max={maxAlert} segments={c.bySeverity.map((b) => ({ key: `sev:${b.rank}`, color: b.color, count: b.count }))} />
            <span style={{ flex: "0 0 18px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#9fb0c8", fontVariantNumeric: "tabular-nums" }}>{c.alertCount}</span>
            <MiniBar count={c.quakeCount} max={maxQuake} segments={c.byMagClass.map((b) => ({ key: `mag:${b.cls}`, color: b.color, count: b.count }))} />
            <span style={{ flex: "0 0 18px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#9fb0c8", fontVariantNumeric: "tabular-nums" }}>{c.quakeCount}</span>
            <MiniBar count={c.volcanoCount} max={maxVolcano} segments={c.byVolcanoStatus.map((b) => ({ key: `volc:${b.status}`, color: b.color, count: b.count }))} />
            <span style={{ flex: "0 0 18px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#9fb0c8", fontVariantNumeric: "tabular-nums" }}>{c.volcanoCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
const FEED_ROW_H = 42;
function WorldFeedRow({ item }: { item: (typeof WORLD.feed)[number] }) {
  return (
    <div style={{ height: FEED_ROW_H, display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid rgba(255,255,255,0.05)", background: `${item.color}14` }}>
      <span style={{ flex: "0 0 auto", width: 30, textAlign: "center", fontSize: 17, lineHeight: 1 }}>{item.icon}</span>
      <span style={{ flex: "0 0 auto", minWidth: 46, textAlign: "center", fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: item.color, padding: "3px 7px", borderRadius: 5, background: `${item.color}26`, border: `1px solid ${item.color}66` }}>{item.tag}</span>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e6edf7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 210 }}>{item.flag ? `${item.flag} ` : ""}{item.title}</span>
        {item.sub ? <span style={{ fontSize: 11, fontWeight: 600, color: "#8fa0b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 210, letterSpacing: 0.3 }}>{item.sub}</span> : null}
      </div>
      {item.expiresIn ? <span style={{ flex: "0 0 auto", fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: "#7f8ea6" }}>{item.expiresIn}</span> : null}
    </div>
  );
}
function WorldWatchPanel({ theme }: { theme: BroadcastTheme }) {
  return (
    <div style={{ position: "relative", width: 400, padding: "14px 20px 18px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 14, boxShadow: "0 10px 32px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: theme.accent, borderBottom: `2px solid ${theme.accent}55`, paddingBottom: 4 }}>ACTIVE FEED</div>
      <div style={{ height: FEED_ROW_H * 7, overflow: "hidden", position: "relative" }}>
        <style>{"@keyframes bcast-wwscroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}"}</style>
        <div style={{ animation: `bcast-wwscroll ${Math.max(12, WORLD.feed.length * 2.4)}s linear infinite`, willChange: "transform" }}>
          {WORLD.feed.map((item) => (<WorldFeedRow key={item.key} item={item} />))}
          {WORLD.feed.map((item) => (<WorldFeedRow key={`dup:${item.key}`} item={item} />))}
        </div>
      </div>
    </div>
  );
}
function WorldReportDeck({ theme }: { theme: BroadcastTheme }) {
  const slides = ["detection", "hourly", "alerts", "seismic", "volcanoes", "about"];
  const page = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-end" }}>
        <WorldSituationPanel theme={theme} />
        <WorldWatchPanel theme={theme} />
      </div>
      <div style={{ display: "flex", gap: 6, paddingRight: 4 }}>
        {slides.map((id, i) => (<span key={id} style={{ width: i === page ? 16 : 6, height: 6, borderRadius: 3, background: i === page ? theme.accent : "rgba(255,255,255,0.25)", transition: "width 0.3s, background 0.3s" }} />))}
      </div>
    </div>
  );
}

/* ============================================================================
 * MONITOR CLUSTER (bottom-centre)  (MonitorCluster.tsx)
 * ==========================================================================*/
const TRACE_H = 34;
const MON_W = 250;
function MonPanel({ title, icon, tag, caption, theme, children }: { title: string; icon: React.ReactNode; tag?: string; caption?: React.ReactNode; theme: BroadcastTheme; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8, fontWeight: 800, letterSpacing: 1, color: "#9fb0c8" }}>{icon}{title}</span>
        {tag ? <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: 0.8, color: theme.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 98 }}>{tag}</span> : null}
      </div>
      <div style={{ height: TRACE_H, borderRadius: 5, background: "rgba(4,10,20,0.72)", border: "1px solid rgba(90,120,160,0.25)", overflow: "hidden", position: "relative" }}>
        {children}
        {caption ? <div style={{ position: "absolute", left: 5, bottom: 3, fontSize: 7.5, fontWeight: 700, letterSpacing: 0.4, color: "#cdd8ea", textShadow: "0 1px 2px rgba(0,0,0,0.8)", pointerEvents: "none" }}>{caption}</div> : null}
      </div>
    </div>
  );
}
function MonCardShell({ theme, label = "GLOBAL MONITOR", children }: { theme: BroadcastTheme; label?: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 172, display: "flex", flexDirection: "column", gap: 7, padding: "8px 10px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 10, boxShadow: "0 8px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT }}>
      <style>{"@keyframes bcast-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#dfe7f5" }}>{label}</div>
      {children}
    </div>
  );
}
function SeismicMonitor({ theme }: { theme: BroadcastTheme }) {
  const amp = Math.min(1, Math.max(0.2, 6.2 / 7));
  return (
    <MonCardShell theme={theme}>
      <MonPanel title="SEISMIC MONITOR" icon={<HeartbeatIcon active />} tag="M6.2" caption="Valparaíso · 1/3" theme={theme}>
        <svg width="200%" height="100%" viewBox={`0 0 ${MON_W * 2} ${TRACE_H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, animation: "bcast-trace 6s linear infinite" }}>
          <path d={seismoPath(MON_W, TRACE_H, amp)} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
          <path d={seismoPath(MON_W, TRACE_H, amp)} transform={`translate(${MON_W},0)`} fill="none" stroke="#43d9ff" strokeWidth="1.2" />
        </svg>
      </MonPanel>
    </MonCardShell>
  );
}
function TsunamiMonitor({ theme }: { theme: BroadcastTheme }) {
  return (
    <MonCardShell theme={theme}>
      <MonPanel title="TSUNAMI GAUGE" icon={<WaveIcon active />} tag="Cairns · 1/2" caption={<span>1.28 m <span style={{ color: "#ff7a7a" }}>▲</span></span>} theme={theme}>
        <svg width="200%" height="100%" viewBox={`0 0 ${MON_W * 2} ${TRACE_H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, animation: "bcast-trace 11s linear infinite" }}>
          <path d={realWavePath(TIDE_SAMPLES, MON_W, TRACE_H)} fill="rgba(60,150,230,0.5)" />
          <path d={realWavePath(TIDE_SAMPLES, MON_W, TRACE_H)} transform={`translate(${MON_W},0)`} fill="rgba(60,150,230,0.5)" />
        </svg>
      </MonPanel>
    </MonCardShell>
  );
}
const ROW_BOX_W = 132, ROW_BOX_H = 42;
function WeatherMonitorBox({ title, icon, color, series, latest, wave, theme }: { title: string; icon: React.ReactNode; color: string; series: number[]; latest: string; wave?: boolean; theme: BroadcastTheme }) {
  const path = wave ? realWavePath(series, ROW_BOX_W, ROW_BOX_H) : realLinePath(series, ROW_BOX_W, ROW_BOX_H);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: ROW_BOX_W }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: "#c8d5e6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Coral Sea</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: theme.accent, whiteSpace: "nowrap" }}>{latest}</span>
      </div>
      <div style={{ height: ROW_BOX_H, borderRadius: 6, background: "rgba(4,10,20,0.72)", border: "1px solid rgba(90,120,160,0.25)", overflow: "hidden", position: "relative" }}>
        <svg width="200%" height="100%" viewBox={`0 0 ${ROW_BOX_W * 2} ${ROW_BOX_H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, animation: "weather-row-trace 8s linear infinite" }}>
          {wave ? (<><path d={path} fill="rgba(60,150,230,0.5)" /><path d={path} transform={`translate(${ROW_BOX_W},0)`} fill="rgba(60,150,230,0.5)" /></>) : (<><path d={path} fill="none" stroke={color} strokeWidth="1.1" /><path d={path} transform={`translate(${ROW_BOX_W},0)`} fill="none" stroke={color} strokeWidth="1.1" /></>)}
        </svg>
        <div style={{ position: "absolute", left: 5, bottom: 3, display: "flex", alignItems: "center", gap: 3, fontSize: 7.5, fontWeight: 800, letterSpacing: 0.6, color: "#dfe7f5", textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>{icon}{title}</div>
      </div>
    </div>
  );
}
function WeatherMonitors({ theme }: { theme: BroadcastTheme }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", pointerEvents: "none", padding: "8px 12px", background: theme.panelBg, border: theme.panelBorder, borderRadius: 10, boxShadow: "0 8px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", fontFamily: FONT }}>
      <style>{"@keyframes weather-row-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "#dfe7f5" }}><WindIcon active size={11} />LOCAL MONITORS</span>
      <div style={{ display: "flex", gap: 10 }}>
        <WeatherMonitorBox title="WIND MONITOR" icon={<WindIcon active />} color="#9085e9" series={WIND_SERIES} latest="59 km/h" theme={theme} />
        <WeatherMonitorBox title="PRESSURE MONITOR" icon={<GaugeIcon active />} color="#f2a33d" series={PRESS_SERIES} latest="997 hPa" theme={theme} />
        <WeatherMonitorBox title="WAVE MONITOR" icon={<WaveIcon active />} color="#3987e5" series={WAVE_SERIES} latest="1.8 m" wave theme={theme} />
      </div>
    </div>
  );
}

/* ============================================================================
 * LEFT DECK CARD  (SlideDeck.tsx + BroadcastCard.tsx deck template)
 * Deck-slide BODIES come from the subagent extraction — integrated below.
 * ==========================================================================*/
const CARD_W = 420, CARD_H = 520;
function CardEyebrow({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return (<div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase", color }}>{children}</div>);
}
function CardSection({ eyebrow, first = false, children, style }: { eyebrow?: React.ReactNode; first?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginTop: first ? 0 : 12, paddingTop: first ? 0 : 12, borderTop: first ? undefined : DIVIDER, ...style }}>
      {eyebrow ? <div style={{ marginBottom: 6 }}><CardEyebrow>{eyebrow}</CardEyebrow></div> : null}
      {children}
    </div>
  );
}
/** The shared deck card template — badge + title bar, scrolling body. */
function DeckCard({ theme, badge, badgeColor, title, accent, children }: { theme: BroadcastTheme; badge: string; badgeColor?: string; title: string; accent?: string; children: React.ReactNode }) {
  const stripe = accent ?? theme.accent;
  return (
    <div style={{ width: CARD_W, height: CARD_H, display: "flex", flexDirection: "column", background: theme.panelBg, ...accentBorder(theme.panelBorder, `4px solid ${stripe}`), borderRadius: 14, boxShadow: "0 8px 26px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", pointerEvents: "none", fontFamily: FONT, color: INK, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 64px 11px 20px", flexShrink: 0 }}>
        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", padding: "3px 10px", borderRadius: 5, background: badgeColor ?? stripe, color: "#fff" }}>{badge}</span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "hidden", padding: "2px 20px 16px" }}>{children}</div>
    </div>
  );
}

const fmtT = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString());

/** Shared "NOW temp + 3 day chips" strip (CityForecastStrip / DayChip). */
function DayChips({ now, days, color }: { now: number; days: { label: string; hi: number; lo: number }[]; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 44 }}>
        <span style={{ fontSize: 18, fontWeight: 850, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>{`${fmtT(now)}°`}</span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color }}>NOW</span>
      </div>
      <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
        {days.map((d) => (
          <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 40, padding: "3px 4px", borderRadius: 6, background: "rgba(4,10,20,0.5)" }}>
            <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: "#8ea3bf" }}>{d.label}</span>
            <span style={{ fontSize: 13, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>
              {`${fmtT(d.hi)}°`}<span style={{ fontSize: 9.5, fontWeight: 700, color, marginLeft: 3 }}>{`${fmtT(d.lo)}°`}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Deck slide bodies (faithful reproductions of the real mode-slide panels) ----

function NowViewingBody({ theme }: { theme: BroadcastTheme }) {
  return (
    <>
      <CardSection first eyebrow="Now Viewing · Coral Sea">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ width: 96, height: 72, borderRadius: 8, background: "linear-gradient(135deg,#1a2a44,#0c1626)", border: theme.panelBorder, flex: "none" }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.4, color: MUTED }}>
            A powerful Category 4 system tracking WSW toward the Queensland coast. Destructive winds and a dangerous storm surge are forecast near landfall.
          </div>
        </div>
      </CardSection>
      <CardSection eyebrow="Storm Vitals">
        {[["Max sustained", "215 km/h"], ["Central pressure", "934 hPa"], ["Gusts", "295 km/h"], ["Sea temp", "29.4 °C"]].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
            <span style={{ color: DIM }}>{k}</span><span style={{ fontWeight: 700, color: INK }}>{v}</span>
          </div>
        ))}
      </CardSection>
      <CardSection eyebrow="In View · Last 24h">
        <div style={{ display: "flex", gap: 18 }}>
          <StatTile label="ALERTS" value={22} color={WORLD.bySeverity[0].color} />
          <StatTile label="QUAKES" value={3} color={theme.accent} />
        </div>
      </CardSection>
    </>
  );
}

function CountryPanelBody() {
  const country = { flag: "🇮🇸", name: "Iceland", capital: "Reykjavík", populationLabel: "372.9K", currency: "Icelandic króna",
    wikiPhoto: "https://upload.wikimedia.org/wikipedia/commons/8/8d/Gullfoss%2C_an_iconic_waterfall_of_Iceland.jpg",
    wikiExtract: "Iceland is a Nordic island country in the North Atlantic Ocean and the most sparsely populated country in Europe. Its capital and largest city is Reykjavík, home to about a third of the population. Volcanically and geologically active, the island sits on the Mid-Atlantic Ridge, giving it dramatic landscapes of glaciers, geysers and lava fields." };
  const meta = [`Capital ${country.capital}`, `Pop. ${country.populationLabel}`, country.currency].join(" · ");
  return (
    <>
      <img src={country.wikiPhoto} alt={country.name} style={{ width: "100%", height: 190, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 10 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 30, lineHeight: 1 }}>{country.flag}</span>
        <span style={{ fontSize: 26, fontWeight: 800, color: "#fff", lineHeight: 1.05 }}>{country.name}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#aebfd6", marginTop: 5 }}>{meta}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: "#cdd9ec", marginTop: 9, display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{country.wikiExtract}</div>
    </>
  );
}

function CityConditionsPanelBody() {
  const color = "#3f8f8f";
  const cities = [
    { id: "1", name: "Reykjavík", pop: "128.8K", now: 9.4, days: [{ label: "TODAY", hi: 11, lo: 6 }, { label: "TMRW", hi: 10, lo: 5 }, { label: "THU", hi: 12, lo: 7 }] },
    { id: "2", name: "Kópavogur", pop: "38.5K", now: 9.1, days: [{ label: "TODAY", hi: 11, lo: 5 }, { label: "TMRW", hi: 9, lo: 4 }, { label: "THU", hi: 11, lo: 6 }] },
    { id: "3", name: "Hafnarfjörður", pop: "30.0K", now: 8.7, days: [{ label: "TODAY", hi: 10, lo: 5 }, { label: "TMRW", hi: 9, lo: 4 }, { label: "THU", hi: 11, lo: 6 }] },
    { id: "4", name: "Akureyri", pop: "19.2K", now: 6.3, days: [{ label: "TODAY", hi: 8, lo: 2 }, { label: "TMRW", hi: 7, lo: 1 }, { label: "THU", hi: 9, lo: 3 }] },
  ];
  return (
    <CardSection first style={{ fontSize: 13 }}>
      {cities.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div style={{ fontWeight: 800, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "#8ea3bf", whiteSpace: "nowrap" }}>{c.pop}</div>
          </div>
          <div style={{ textAlign: "right", minWidth: 46 }}>
            <div style={{ fontSize: 22, fontWeight: 850, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>{`${fmtT(c.now)}°`}</div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.5, color }}>NOW</div>
          </div>
          <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
            {c.days.map((d) => (
              <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 40, padding: "3px 4px", borderRadius: 6, background: "rgba(4,10,20,0.5)" }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: "#8ea3bf" }}>{d.label}</span>
                <span style={{ fontSize: 13, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>{`${fmtT(d.hi)}°`}<span style={{ fontSize: 9.5, fontWeight: 700, color, marginLeft: 3 }}>{`${fmtT(d.lo)}°`}</span></span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </CardSection>
  );
}

function QuakeReportBody() {
  const near = [
    { id: "1", name: "Kahramanmaraş", cc: "TR", pop: "1.1M", dist: "38 km", bearing: "NE", now: 12.4, days: [{ label: "TODAY", hi: 15, lo: 4 }, { label: "TMRW", hi: 14, lo: 3 }, { label: "THU", hi: 16, lo: 5 }] },
    { id: "2", name: "Gaziantep", cc: "TR", pop: "1.6M", dist: "74 km", bearing: "S", now: 13.1, days: [{ label: "TODAY", hi: 16, lo: 5 }, { label: "TMRW", hi: 15, lo: 4 }, { label: "THU", hi: 17, lo: 6 }] },
    { id: "3", name: "Malatya", cc: "TR", pop: "441.9K", dist: "112 km", bearing: "N", now: 8.8, days: [{ label: "TODAY", hi: 11, lo: 1 }, { label: "TMRW", hi: 10, lo: 0 }, { label: "THU", hi: 12, lo: 2 }] },
  ];
  const Chip = ({ text, c }: { text: string; c: string }) => (<span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, color: "#0a0e16", background: c }}>{text}</span>);
  const Reading = ({ label, value, chip, chipColor, blurb }: { label: string; value: string; chip: string; chipColor: string; blurb: string }) => (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: MUTED, width: 62 }}>{label}</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <Chip text={chip} c={chipColor} />
      </div>
      <div style={{ fontSize: 10.5, lineHeight: 1.4, color: "#aebfd6", marginTop: 3 }}>{blurb}</div>
    </div>
  );
  return (
    <>
      <Reading label="MAGNITUDE" value="M6.3" chip="Strong" chipColor="#f97316" blurb="Can be destructive in populated areas up to ~160 km across." />
      <Reading label="DEPTH" value="24 km" chip="Shallow" chipColor="#ef4444" blurb="Ruptures near the surface — shaking is concentrated and felt hardest at the epicentre." />
      <CardSection eyebrow="Nearest Cities">
        {near.map((n) => (
          <div key={n.id} style={{ padding: "3px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11 }}>
              <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ fontWeight: 700, color: "#e6eefb" }}>{n.name}</span><span style={{ color: "#7d8da5" }}>{` ${n.cc} · ${n.pop}`}</span>
              </span>
              <span style={{ color: "#8ea3bf", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{n.dist} {n.bearing}</span>
            </div>
            <DayChips now={n.now} days={n.days} color="#e08a1e" />
          </div>
        ))}
      </CardSection>
    </>
  );
}

function TopCitiesPanelBody() {
  const color = "#3f8f8f";
  const CHART_W = 288;
  const spark = (values: number[], height: number) => {
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(1e-9, max - min), pad = 6;
    return `M${values.map((v, i) => `${((i / (values.length - 1)) * CHART_W).toFixed(1)},${(pad + (1 - (v - min) / span) * (height - 2 * pad)).toFixed(1)}`).join(" L")}`;
  };
  const tempYear = [3, 4, 6, 8, 11, 13, 14, 13, 10, 7, 5, 4];
  const humidityYear = [82, 80, 78, 74, 72, 75, 78, 80, 83, 85, 84, 83];
  const rainYear = [78, 66, 64, 58, 44, 50, 52, 62, 74, 86, 84, 80];
  const featured = { name: "Reykjavík", pop: "128.8K", photo: "https://upload.wikimedia.org/wikipedia/commons/9/91/Reykjavik_seen_from_Perlan.jpg", extract: "Reykjavík is the capital and largest city of Iceland, and the world's northernmost capital of a sovereign state. It is a hub of geothermal heating, colourful rooftops and North-Atlantic culture, with Hallgrímskirkja and the harbourfront defining its skyline." };
  const rest = [
    { id: "2", name: "Kópavogur", meta: "38.5K", latest: 4.9 }, { id: "3", name: "Hafnarfjörður", meta: "30.0K", latest: 4.6 },
    { id: "4", name: "Akureyri", meta: "19.2K", latest: 2.1 }, { id: "5", name: "Reykjanesbær", meta: "18.9K", latest: 5.3 },
  ];
  const climateCells = [
    { key: "temp", label: "TEMP", units: "°C", color: "#e66767", values: tempYear, latest: 4, caption: "yr hi 16 · lo -3" },
    { key: "humidity", label: "HUMIDITY", units: "%", color: "#199e70", values: humidityYear, latest: 83, caption: "avg 80" },
    { key: "rain", label: "RAIN", units: "mm", color: "#3987e5", values: rainYear, latest: 80, caption: "total 798 mm" },
  ];
  return (
    <>
      <div>
        <img src={featured.photo} alt={featured.name} style={{ width: "100%", height: 175, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 9 }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{featured.name}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color }}>{featured.pop}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#aebfd6", marginTop: 2 }}>Iceland · capital</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "#cdd9ec", marginTop: 7, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{featured.extract}</div>
      </div>
      <CardSection style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <CardEyebrow>{featured.name.toUpperCase()} · Past Year</CardEyebrow>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          {climateCells.map((c) => {
            const h = 58, d = spark(c.values, h), area = `${d} L${CHART_W},${h} L0,${h} Z`;
            return (
              <div key={c.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: "#aebdd2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ color: c.color, marginRight: 3 }}>▮</span>{c.label}</span>
                <span style={{ fontSize: 16, fontWeight: 850, color: "#f3f7ff", whiteSpace: "nowrap" }}>{fmtT(c.latest)}<span style={{ fontSize: 9, fontWeight: 700, color: "#9db0ca", marginLeft: 2 }}>{c.units}</span></span>
                <svg width="100%" height={h} viewBox={`0 0 ${CHART_W} ${h}`} preserveAspectRatio="none" style={{ display: "block", borderRadius: 5, background: "rgba(4,10,20,0.78)" }}>
                  <path d={area} fill={c.color} opacity={0.18} /><path d={d} fill="none" stroke={c.color} strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, color: "#91a1b9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.caption}</span>
              </div>
            );
          })}
        </div>
      </CardSection>
      <CardSection style={{ fontSize: 13 }}>
        {rest.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "4px 0" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#e6eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ color: "#8ea3bf", whiteSpace: "nowrap" }}>{c.meta}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#e66767" }}>{fmtT(c.latest)}°</span>
              <svg width={64} height={24} viewBox={`0 0 ${CHART_W} 24`} preserveAspectRatio="none"><path d={spark(tempYear, 24)} fill="none" stroke="#e66767" strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" /></svg>
            </div>
          </div>
        ))}
      </CardSection>
    </>
  );
}

function TrackInfoPanelBody() {
  const color = "#2aa6c0";
  const info = {
    category: "Head of State", photoUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Air_Force_One_over_Mt._Rushmore.jpg", photoCredit: "USAF",
    title: "AIR FORCE ONE", typeLine: "Boeing VC-25A · United States Air Force", idLine: "🇺🇸 United States · 82-8000", statusLine: "En route KADW → EGLL · FL370",
    extract: "A VC-25A is a militarised Boeing 747-200B operated by the United States Air Force. When the President is aboard, the aircraft uses the callsign \"Air Force One\". The two airframes are configured with secure communications, in-flight refuelling capability and a medical suite.",
    liveStats: [{ label: "Altitude", value: "37,000 ft" }, { label: "Heading", value: "071°" }, { label: "Speed", value: "521 kt" }, { label: "Callsign", value: "AF1" }],
  };
  return (
    <>
      <div style={{ display: "flex", marginBottom: 6 }}>
        <span style={{ marginLeft: "auto", fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: MUTED, background: "rgba(159,179,204,0.14)", padding: "2px 6px", borderRadius: 999, textTransform: "uppercase" }}>{info.category}</span>
      </div>
      <div style={{ position: "relative", marginBottom: 7 }}>
        <img src={info.photoUrl} alt={info.title} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 6, display: "block" }} />
        <div style={{ position: "absolute", right: 4, bottom: 4, fontSize: 8, color: "#dbe6f6", background: "rgba(0,0,0,0.5)", padding: "1px 4px", borderRadius: 3 }}>© {info.photoCredit}</div>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", lineHeight: 1.15 }}>{info.title}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginTop: 2 }}>{info.typeLine}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#aebfd6", marginTop: 1 }}>{info.idLine}</div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "#8ea3bf", marginTop: 1 }}>{info.statusLine}</div>
      <div style={{ fontSize: 11, lineHeight: 1.45, color: "#cdd9ec", marginTop: 6, display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{info.extract}</div>
      <div style={{ marginTop: 10, paddingTop: 9, borderTop: DIVIDER, display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
        {info.liveStats.map((d) => (<div key={d.label} style={{ fontSize: 11, whiteSpace: "nowrap" }}><span style={{ color: "#8ea3bf" }}>{d.label} </span><span style={{ fontWeight: 700, color: "#e6eefb" }}>{d.value}</span></div>))}
      </div>
    </>
  );
}

function VolcanoFactsPanelBody() {
  const USGS_COLOR: Record<string, string> = { RED: "#ef4444", ORANGE: "#f97316", YELLOW: "#eab308", GREEN: "#34d399" };
  const info = {
    gallery: ["https://upload.wikimedia.org/wikipedia/commons/1/1a/Fagradalsfjall_2021.jpg", "https://upload.wikimedia.org/wikipedia/commons/8/8d/Gullfoss%2C_an_iconic_waterfall_of_Iceland.jpg", "https://upload.wikimedia.org/wikipedia/commons/9/91/Reykjavik_seen_from_Perlan.jpg", "https://upload.wikimedia.org/wikipedia/commons/8/8d/Gullfoss%2C_an_iconic_waterfall_of_Iceland.jpg"],
    facts: "Stratovolcano · summit 1,491 m · last eruption 2023 · Reykjanes Peninsula, Iceland",
    alert: { colorCode: "ORANGE", level: "WATCH", synopsis: "Elevated unrest with continued ground deformation and seismic swarms beneath the intrusion. An eruption could begin with little additional warning." },
    reportFacts: "VEI 2 · plume to ~3.5 km · lava effusion ~9 m³/s · SO₂ flux elevated · fissure ~900 m active along the dike, per this week's GVP bulletin.",
  };
  return (
    <>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {info.gallery.slice(0, 4).map((url, i) => (<img key={i} src={url} alt="" style={{ flex: 1, height: 60, objectFit: "cover", borderRadius: 4, display: "block" }} />))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#e6eefb" }}>{info.facts}</div>
      <CardSection>
        <div style={{ fontSize: 11, fontWeight: 800, color: USGS_COLOR[info.alert.colorCode] }}>● USGS {info.alert.colorCode} / {info.alert.level}</div>
        <div style={{ fontSize: 11, lineHeight: 1.4, color: "#cdd9ec", marginTop: 3 }}>{info.alert.synopsis}</div>
      </CardSection>
      <CardSection eyebrow="This week's bulletin, parsed">
        <div style={{ fontSize: 12, fontWeight: 700, color: "#e6eefb" }}>{info.reportFacts}</div>
      </CardSection>
    </>
  );
}

/** The rotating left card — cross-fades through the panel archetypes so every
 *  deck-slide look is visible for design iteration. (Live, one segment's kind
 *  drives which slides appear; here we show one of each to exercise the system.) */
const DECK_SLIDES: { kind: string; title: string; body: (t: BroadcastTheme) => React.ReactNode }[] = [
  { kind: "storm", title: "Tropical Cyclone Freya", body: (t) => <NowViewingBody theme={t} /> },
  { kind: "quake", title: "M6.3 · Kahramanmaraş", body: () => <QuakeReportBody /> },
  { kind: "country", title: "Iceland", body: () => <CountryPanelBody /> },
  { kind: "country", title: "Iceland · Top Cities", body: () => <TopCitiesPanelBody /> },
  { kind: "country", title: "Iceland · City Conditions", body: () => <CityConditionsPanelBody /> },
  { kind: "flight", title: "Air Force One", body: () => <TrackInfoPanelBody /> },
  { kind: "volcano", title: "Fagradalsfjall", body: () => <VolcanoFactsPanelBody /> },
];

function SlideDeck({ theme }: { theme: BroadcastTheme }) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % DECK_SLIDES.length), 6500);
    return () => clearInterval(t);
  }, []);
  const cur = DECK_SLIDES[page];
  const color = KIND_COLOR[cur.kind];
  return (
    <div style={{ position: "relative", width: CARD_W, height: CARD_H }}>
      {DECK_SLIDES.map((s, i) => (
        <div key={i} style={{ position: "absolute", inset: 0, opacity: i === page ? 1 : 0, transition: "opacity 0.6s ease", pointerEvents: "none" }}>
          <DeckCard theme={theme} badge={KIND_LABEL[s.kind]} badgeColor={KIND_COLOR[s.kind]} title={s.title} accent={KIND_COLOR[s.kind]}>
            {i === page ? s.body(theme) : null}
          </DeckCard>
        </div>
      ))}
      {/* Page dots (top-right, clear of the badge/title bar) */}
      <div style={{ position: "absolute", top: 14, right: 16, display: "flex", gap: 5 }}>
        {DECK_SLIDES.map((_, i) => (<span key={i} style={{ width: i === page ? 14 : 6, height: 6, borderRadius: 3, background: i === page ? color : "rgba(255,255,255,0.25)", transition: "width 0.3s, background 0.3s" }} />))}
      </div>
    </div>
  );
}

/* ============================================================================
 * SYSLOG + UP NEXT + BUILD (bottom-right)  (SyslogFeed / UpNextPanel)
 * ==========================================================================*/
function SyslogFeed() {
  const [lines, setLines] = useState<{ id: number; at: number; text: string }[]>([]);
  const idRef = useRef(0);
  const MSGS = ["weather run 12Z ingested", "tracks tick · 1,284 aircraft", "alerts poll · 342 active", "cities updated", "focus bundle refreshed", "seismic feed · M6.2 Chile", "tide gauges cached · 6"];
  useEffect(() => {
    const push = () => setLines((prev) => [...prev.slice(-5), { id: idRef.current++, at: Date.now(), text: MSGS[Math.floor((idRef.current * 2654435761) % MSGS.length)] }]);
    push(); const t = setInterval(push, 2600); return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const LIFE = 16000;
  const clock = (at: number) => { const d = new Date(at); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  return (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 3, fontFamily: MONO, fontSize: 11, letterSpacing: 0.2, pointerEvents: "none" }}>
      <style>{"@keyframes bcast-logline{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}"}</style>
      {lines.map((l) => (
        <div key={l.id} style={{ opacity: Math.max(0.15, 1 - (now - l.at) / LIFE), animation: "bcast-logline 0.35s ease-out", textShadow: "0 1px 3px rgba(0,0,0,0.9)", whiteSpace: "nowrap" }}>
          <span style={{ color: "#5c7a94" }}>{clock(l.at)}</span>{" "}
          <span style={{ color: "#6fa8dc", fontWeight: 700 }}>[SYS]</span>{" "}
          <span style={{ color: "#8fe3b0" }}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}
function UpNextPanel({ items }: { items: { kind: string; title: string }[] }) {
  if (!items.length) return null;
  return (
    <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "#9fb0c8", textShadow: "0 1px 3px rgba(0,0,0,0.85)", textAlign: "right", pointerEvents: "none" }}>
      UP NEXT · {items.map((u) => u.title).join("  ·  ")}
    </div>
  );
}
function BuildInfoTag() {
  return (<div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: 0.4, color: "#4a5a70", textAlign: "right", pointerEvents: "none" }}>build seed · design stage</div>);
}

/* ============================================================================
 * THEME SWITCHER  (the only pointer-enabled, non-broadcast chrome)
 * ==========================================================================*/
function ThemeSwitcher({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: "fixed", top: 10, right: 10, zIndex: 100, display: "flex", gap: 4, padding: 4, background: "rgba(0,0,0,0.6)", borderRadius: 8, fontFamily: FONT, backdropFilter: "blur(6px)" }}>
      {Object.keys(THEMES).map((k) => (
        <button key={k} onClick={() => onChange(k)} style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "capitalize", padding: "5px 10px", borderRadius: 5, border: value === k ? `1px solid ${THEMES[k].accent}` : "1px solid transparent", background: value === k ? THEMES[k].accent : "rgba(255,255,255,0.08)", color: value === k ? "#fff" : "#cbd5e1" }}>{k}</button>
      ))}
    </div>
  );
}

/* ============================================================================
 * ROOT — the scaled 1920×1080 stage over a globe backdrop  (BroadcastFrame.tsx)
 * ==========================================================================*/
function useStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const compute = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    compute(); window.addEventListener("resize", compute); return () => window.removeEventListener("resize", compute);
  }, []);
  return scale;
}

export default function WatchChromeSeed() {
  const [themeId, setThemeId] = useState("command");
  const theme = THEMES[themeId] ?? THEMES.command;
  const scale = useStageScale();

  const brandStatus = { shotKind: KIND_LABEL[SEGMENT.kind], shotTarget: SEGMENT.title, attribute: METER_META.label };
  const upNext = [{ kind: "quake", title: "M6.2 Chile" }, { kind: "country", title: "Japan" }];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0e16", overflow: "hidden" }}>
      <ThemeSwitcher value={themeId} onChange={setThemeId} />

      {/* Fake globe backdrop (stands in for the deck.gl globe) */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 120% at 50% 40%, #10233f 0%, #0a1424 45%, #05080f 100%)" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: "58vh", height: "58vh", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle at 38% 32%, #2b6cb0 0%, #1a4a7a 34%, #123a5c 55%, #0a2038 78%, #061422 100%)", boxShadow: "inset -40px -30px 90px rgba(0,0,0,0.6), 0 0 120px rgba(60,130,200,0.25)", opacity: 0.9 }} />
      </div>

      {/* 1920×1080 design stage, uniformly scaled + centred */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 5 }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center center" }}>

          {/* Centred event reticle + lower-third (targeted event) */}
          <EventOverlay theme={theme} historyPanel={<PointHistoryStrip theme={theme} />} forecastPanel={<ForecastStrip theme={theme} />} />

          {/* Bottom-left: rotating mode deck card */}
          <div style={{ position: "absolute", left: INSET, bottom: TICKER_H + INSET, display: "flex", flexDirection: "column-reverse", alignItems: "flex-start", gap: 10 }}>
            <SlideDeck theme={theme} />
          </div>

          {/* Top ticker */}
          <Ticker title={theme.tickerTitle} items={TICKER_ITEMS} edge="top" height={TICKER_H} theme={theme} />

          {/* Top-left brand block */}
          <div style={{ position: "absolute", top: TICKER_H + 12, left: -4 }}>
            <BrandPanel theme={theme} live status={brandStatus} />
          </div>

          {/* Geomagnetic Kp readout, tucked under the brand block (shows when aurora on) */}
          <div style={{ position: "absolute", top: TICKER_H + 12 + BRAND_STACK_H, left: -4 }}>
            <KpIndexPanel theme={theme} />
          </div>

          {/* Top-centre column: live alert + intensity meter + space-weather key */}
          <div style={{ position: "absolute", top: TICKER_H + INSET, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <LiveAlertPanel theme={theme} />
            <IntensityMeter theme={theme} />
            <SpaceWeatherMeter theme={theme} />
          </div>

          {/* Top-right: world report deck */}
          <div style={{ position: "absolute", top: TICKER_H + INSET, right: INSET - 12 }}>
            <WorldReportDeck theme={theme} />
          </div>

          {/* Bottom-right column: up next, syslog, build stamp */}
          <div style={{ position: "absolute", bottom: TICKER_H + INSET, right: INSET, display: "flex", flexDirection: "column-reverse", alignItems: "flex-end", gap: 10 }}>
            <BuildInfoTag />
            <SyslogFeed />
            <UpNextPanel items={upNext} />
          </div>

          {/* Bottom-centre row: seismic · weather · tsunami monitors */}
          <div style={{ position: "absolute", bottom: TICKER_H + INSET, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 16 }}>
            <SeismicMonitor theme={theme} />
            <WeatherMonitors theme={theme} />
            <TsunamiMonitor theme={theme} />
          </div>

          {/* Bottom ticker */}
          <Ticker title={theme.tickerTitle} items={TICKER_ITEMS} edge="bottom" height={TICKER_H} theme={theme} />
        </div>
      </div>
    </div>
  );
}
