"use client";

/**
 * "Now viewing" broadcast overlay: a nicely styled lower-left card showing the
 * on-air shot — kind badge, location/event title + subtitle, the live lat/lon +
 * zoom, and which weather map (variable) is currently shown. Draggable when
 * `draggable` is set (operator console); its position persists to localStorage.
 * On the captured /watch surface it's rendered non-draggable + pointer-inert.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import type { ControlState } from "@photonsurge/shared/control";
import { upNextLabel, type Segment, type SegmentKind, type UpNextItem } from "@photonsurge/shared/director";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { getVariable } from "@photonsurge/shared/variables";
import { getPalette } from "@photonsurge/shared/palettes";
import { buildLegend } from "../lib/legend";
import { mapFreshness } from "../lib/manifest";
import { idleBreatheActive, idleBreatheZoom, MAX_PUSH_IN } from "../lib/idle-motion";
import { UI_SANS } from "../lib/fonts";
import { HazardGlyph, type HazardGlyphId } from "./broadcast/glyphs";


const KIND: Record<SegmentKind, { label: string; color: string }> = {
  intro: { label: "Live", color: "#1f9d72" },
  global: { label: "Live", color: "#1f9d72" },
  ocean: { label: "Ocean", color: "#1c7fb8" },
  orbital: { label: "Orbital", color: "#6a59c0" },
  country: { label: "Country", color: "#3f8f8f" },
  region: { label: "Region", color: "#4a8f6f" },
  point: { label: "Point", color: "#2f8f4e" },
  storm: { label: "Severe", color: "#d23a3a" },
  volcano: { label: "Volcano", color: "#c2410c" },
  quake: { label: "Seismic", color: "#e08a1e" },
  flight: { label: "Aircraft", color: "#2aa6c0" },
  ship: { label: "Vessel", color: "#3b6ea5" },
  ad: { label: "Sponsor", color: "#d4a017" },
};

const STORAGE_KEY = "viewingOverlayPos";

const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;
const fmtLng = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "E" : "W"}`;

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.55, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/**
 * Compact colour-ramp legend for the on-air variable: a palette gradient bar
 * with evenly-spaced value labels. Returns null when no scalar map is shown
 * (e.g. wind-only shots) so the card stays tight. Reuses the pure legend math.
 */
function MapLegend({
  variable,
  units,
  manifest,
}: {
  variable: string | null;
  units: ControlState["units"];
  manifest?: WeatherManifest | null;
}) {
  if (!variable) return null;
  const meta = getVariable(variable);
  const legend = buildLegend(variable, units);
  if (!meta || !legend) return null;

  const palette = getPalette(meta.palette);
  const gradient = `linear-gradient(to right, ${palette
    .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
    .join(", ")})`;
  const freshness = manifest ? mapFreshness(manifest, variable, Date.now()) : null;

  return (
    <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid rgba(120,140,170,0.15)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.55, fontWeight: 700 }}>LEGEND</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{legend.unit}</span>
      </div>
      <div
        style={{
          height: 9,
          marginTop: 5,
          borderRadius: 4,
          background: gradient,
          border: "1px solid rgba(0,0,0,0.4)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        {legend.stops.map((s, i) => (
          <span key={i} style={{ fontSize: 9, opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
            {s.label}
          </span>
        ))}
      </div>
      {freshness && (
        <div style={{ marginTop: 4, fontSize: 9, opacity: 0.7 }}>
          {freshness.source} ·{" "}
          {freshness.note ?? `run ${freshness.runLabel} · updated ${freshness.updatedLabel}`}
        </div>
      )}
    </div>
  );
}

/** "4m ago", "1h 12m ago", "just now" — compact relative time. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

/**
 * The vector mark for a shot, or undefined when there is nothing to draw but the
 * segment's own text. Storms carry their classified hazard; volcano and quake
 * shots map to the matching hazard mark; a country/region shot's `icon` is a
 * flag, which the self-hosted flag face renders as text.
 */
function segmentMark(segment: Segment): HazardGlyphId | undefined {
  if (segment.hazard) return segment.hazard;
  if (segment.kind === "volcano") return "volcano";
  if (segment.kind === "quake") return "quake";
  return undefined;
}

export default function ViewingOverlay({
  segment,
  variable,
  state,
  upNext,
  draggable = false,
  lastShownAt,
  timesShown,
  label = "ON AIR",
  accent = "#ff5252",
  onClose,
  manifest,
  footer,
}: {
  segment: Segment;
  variable: string | null;
  /** The on-air control state — supplies the camera anchor + live spin/push-in. */
  state: ControlState;
  upNext: UpNextItem[];
  draggable?: boolean;
  /** Operator-only: when this exact shot last aired + how many times this session. */
  lastShownAt?: number;
  timesShown?: number;
  /** Status pill text + dot colour — "SELECTED" for a manual click-select card. */
  label?: string;
  accent?: string;
  /** When set, a ✕ dismisses the card (manual selection only). */
  onClose?: () => void;
  /** When supplied, the legend shows the source + data age. */
  manifest?: WeatherManifest | null;
  /** Extra content rendered inside the card body, below the legend (e.g. the
   *  sandbox's inline 3-day forecast strip). */
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Live camera readout: the orbit/push-in move the camera every frame but only
  // in the globe's rAF loop (not React), so recompute the same deterministic
  // longitude/zoom here off spinEpoch and tick a few times a second.
  const [lng0, lat0] = state.camera.center;
  const baseZoom = state.camera.zoom;
  const spinSpeed = state.autoSpin ? state.spinSpeed : 0;
  const zoomDrift = state.zoomDrift || 0;
  // Channel idle drift: the readout tracks its zoom breathe (the small lat/lng
  // orbit is omitted here, same as the director orbit above).
  const idleBreathe = idleBreatheActive(state) ? state.idleBreathe : 0;
  const idlePeriodS = state.idlePeriodS;
  const flightSec = (state.cutTransitionMs || 0) / 1000;
  const epoch = state.spinEpoch || 0;
  const [live, setLive] = useState({ lng: lng0, lat: lat0, zoom: baseZoom });
  useEffect(() => {
    const tick = () => {
      const dt = Math.max(0, (Date.now() - epoch) / 1000);
      let lng = lng0 + spinSpeed * dt;
      lng = ((((lng + 180) % 360) + 360) % 360) - 180;
      // A channel breathe OWNS the zoom (the globe skips the push-in for it —
      // in-and-back from the anchor, visible from the first hold second).
      const pushIn = idleBreathe > 0 ? 0 : zoomDrift;
      let zoom = baseZoom + Math.min(pushIn * dt, MAX_PUSH_IN);
      zoom += idleBreatheZoom(idleBreathe, idlePeriodS, Math.max(0, dt - flightSec));
      setLive({ lng, lat: lat0, zoom });
    };
    tick();
    if (spinSpeed === 0 && zoomDrift === 0 && idleBreathe === 0) return; // static shot — no timer
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [lng0, lat0, baseZoom, spinSpeed, zoomDrift, idleBreathe, idlePeriodS, flightSec, epoch]);

  // Restore a saved position (operator only).
  useEffect(() => {
    if (!draggable) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPos(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [draggable]);

  // Persist position as it moves.
  useEffect(() => {
    if (!draggable || !pos) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [draggable, pos]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!draggable || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const left = Math.max(8, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx));
    const top = Math.max(8, Math.min(window.innerHeight - 48, e.clientY - drag.current.dy));
    setPos({ left, top });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const kind = KIND[segment.kind] ?? { label: segment.kind, color: "#3a4a66" };
  const mapLabel = variable ? getVariable(variable)?.label ?? variable : "No map";
  const anchor: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { left: 24, bottom: 56 };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        ...anchor,
        width: 320,
        pointerEvents: draggable ? "auto" : "none",
        fontFamily: UI_SANS,
        color: "#fff",
        background: "linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.88))",
        border: "1px solid rgba(120,140,170,0.22)",
        borderRadius: 12,
        backdropFilter: "var(--panel-blur, blur(10px))",
        WebkitBackdropFilter: "var(--panel-blur, blur(10px))",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Header / drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid rgba(120,140,170,0.15)",
          cursor: draggable ? "grab" : "default",
          touchAction: "none",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            padding: "3px 7px",
            borderRadius: 4,
            background: kind.color,
          }}
        >
          {kind.label}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1, opacity: 0.85 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: `0 0 6px ${accent}` }} />
          {label}
        </span>
        {onClose ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            aria-label="Deselect"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "#fff",
              opacity: 0.55,
              cursor: "pointer",
              fontSize: 15,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ✕
          </button>
        ) : draggable ? (
          <span style={{ marginLeft: "auto", opacity: 0.4, fontSize: 14, letterSpacing: -1 }}>⠿</span>
        ) : null}
      </div>

      {/* Body */}
      <div style={{ padding: "11px 13px 13px" }}>
        <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.12 }}>
          {/* `segment.icon` is an EMOJI from the shared vocabulary, and the
              encoder's Chromium has no emoji font — so anything we can name a
              vector for is drawn as one, and only the flag (a country/region
              shot, covered by the self-hosted flag face) falls through as text. */}
          {segmentMark(segment) ? (
            <span style={{ marginRight: 8, display: "inline-flex", verticalAlign: "-3px" }}>
              <HazardGlyph id={segmentMark(segment)!} color="currentColor" size={21} />
            </span>
          ) : segment.icon ? (
            <span style={{ marginRight: 8 }}>{segment.icon}</span>
          ) : null}
          {segment.title}
        </div>
        {segment.subtitle ? (
          <div style={{ fontSize: 13, opacity: 0.82, marginTop: 3 }}>{segment.subtitle}</div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.7fr 1.4fr",
            gap: 10,
            marginTop: 12,
            paddingTop: 11,
            borderTop: "1px solid rgba(120,140,170,0.15)",
          }}
        >
          <Meta label="LOCATION" value={`${fmtLat(live.lat)} ${fmtLng(live.lng)}`} />
          <Meta label="ZOOM" value={live.zoom.toFixed(1)} />
          <Meta label="MAP" value={mapLabel} />
        </div>

        {segment.details?.length ? (
          <div
            style={{
              marginTop: 11,
              paddingTop: 11,
              borderTop: "1px solid rgba(120,140,170,0.15)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              rowGap: 4,
              columnGap: 12,
              fontSize: 12.5,
            }}
          >
            {segment.details.map((d) => (
              <Fragment key={d.label}>
                <span style={{ opacity: 0.55, fontWeight: 700, letterSpacing: 0.3 }}>{d.label}</span>
                <span style={{ fontWeight: 600, textAlign: "right" }}>{d.value}</span>
              </Fragment>
            ))}
          </div>
        ) : null}

        <MapLegend variable={variable} units={state.units} manifest={manifest} />

        {footer}

        {/* Operator-only recurrence readout — not on the /watch broadcast. */}
        {draggable && timesShown ? (
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 11, letterSpacing: 0.4 }}>
            SHOWN · {timesShown}× this session
            {lastShownAt ? ` · last ${ago(lastShownAt)}` : " · first time"}
          </div>
        ) : null}

        {upNext.length ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, letterSpacing: 0.4 }}>
            {upNext.map((u, i) => (
              <div key={i}>
                {i === 0 ? "UP NEXT · " : ""}
                {upNextLabel(u)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
