"use client";

/**
 * "Now viewing" broadcast overlay: a nicely styled lower-left card showing the
 * on-air shot — kind badge, location/event title + subtitle, the live lat/lon +
 * zoom, and which weather map (variable) is currently shown. Draggable when
 * `draggable` is set (operator console); its position persists to localStorage.
 * On the captured /watch surface it's rendered non-draggable + pointer-inert.
 */
import { useEffect, useRef, useState } from "react";
import type { ControlState } from "@photonsurge/shared/control";
import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import { getVariable } from "@photonsurge/shared/variables";

/** Max zoom a push-in adds over a hold — keep in sync with Globe's MAX_PUSH_IN. */
const MAX_PUSH_IN = 1.2;

const KIND: Record<SegmentKind, { label: string; color: string }> = {
  intro: { label: "Live", color: "#1f9d72" },
  tour: { label: "Region", color: "#3b6ea5" },
  weather: { label: "Weather", color: "#2f8f4e" },
  storm: { label: "Severe", color: "#d23a3a" },
  quake: { label: "Seismic", color: "#e08a1e" },
  flight: { label: "Aircraft", color: "#2aa6c0" },
  ship: { label: "Vessel", color: "#3b6ea5" },
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

export default function ViewingOverlay({
  segment,
  variable,
  state,
  upNext,
  draggable = false,
}: {
  segment: Segment;
  variable: string | null;
  /** The on-air control state — supplies the camera anchor + live spin/push-in. */
  state: ControlState;
  upNext: { kind: SegmentKind; title: string }[];
  draggable?: boolean;
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
  const epoch = state.spinEpoch || 0;
  const [live, setLive] = useState({ lng: lng0, lat: lat0, zoom: baseZoom });
  useEffect(() => {
    const tick = () => {
      const dt = Math.max(0, (Date.now() - epoch) / 1000);
      let lng = lng0 + spinSpeed * dt;
      lng = ((((lng + 180) % 360) + 360) % 360) - 180;
      setLive({ lng, lat: lat0, zoom: baseZoom + Math.min(zoomDrift * dt, MAX_PUSH_IN) });
    };
    tick();
    if (spinSpeed === 0 && zoomDrift === 0) return; // static shot — no timer
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [lng0, lat0, baseZoom, spinSpeed, zoomDrift, epoch]);

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
        fontFamily: "system-ui, sans-serif",
        color: "#fff",
        background: "linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.88))",
        border: "1px solid rgba(120,140,170,0.22)",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5252", boxShadow: "0 0 6px #ff5252" }} />
          ON AIR
        </span>
        {draggable ? <span style={{ marginLeft: "auto", opacity: 0.4, fontSize: 14, letterSpacing: -1 }}>⠿</span> : null}
      </div>

      {/* Body */}
      <div style={{ padding: "11px 13px 13px" }}>
        <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.12 }}>{segment.title}</div>
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

        {upNext.length ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 11, letterSpacing: 0.4 }}>
            UP NEXT · {upNext.map((u) => u.title).join("  ·  ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
