"use client";

/**
 * Operator controls for the per-scene auto-director. Off/Auto toggle, hold time,
 * which kinds are eligible, event thresholds, and a Skip button — plus a live
 * "on air / up next" readout fed by the worker's director:state. Edits PATCH the
 * scene's director config; the worker picks them up within ~1s.
 */
import { useEffect, useState } from "react";
import { SEGMENT_KINDS, type SegmentKind } from "@photonsurge/shared/director";
import { useDirectorConfig, useDirector } from "../lib/director";

const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Intro spin",
  tour: "Region tour",
  weather: "Weather",
  storm: "Severe storms",
  quake: "Earthquakes",
  flight: "Aircraft",
  ship: "Ships",
};

const box: React.CSSProperties = {
  background: "#0a0e16",
  color: "#fff",
  border: "1px solid #2a3344",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
};

export default function DirectorPanel({ sceneId }: { sceneId: string }) {
  const { config, update } = useDirectorConfig(sceneId);
  const live = useDirector(sceneId);
  const auto = config.mode === "auto";

  // Live countdown for the on-air readout.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const remaining = live?.endsAt ? Math.max(0, Math.round((live.endsAt - now) / 1000)) : 0;

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid #1b2030", paddingBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Auto-director</h3>
        <span style={{ fontSize: 11, opacity: 0.6 }}>scene: {sceneId}</span>
      </div>

      {/* Mode + skip */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => update({ mode: auto ? "off" : "auto" })}
          style={{
            ...box,
            cursor: "pointer",
            flex: 1,
            fontWeight: 700,
            background: auto ? "#1f7a3f" : "#1a2030",
            borderColor: auto ? "#2bbe63" : "#2a3344",
          }}
        >
          {auto ? "● AUTO — ON" : "○ Auto — Off"}
        </button>
        <button
          onClick={() => update({ skipNonce: config.skipNonce + 1 })}
          disabled={!auto}
          style={{ ...box, cursor: auto ? "pointer" : "not-allowed", opacity: auto ? 1 : 0.5 }}
          title="Cut to the next shot now"
        >
          Skip ⏭
        </button>
      </div>

      {/* On-air readout */}
      {auto && live?.segment ? (
        <div style={{ ...box, marginBottom: 12, padding: 10, borderColor: "#3a4a66" }}>
          <div style={{ fontSize: 11, color: "#ff6a6a", fontWeight: 700, letterSpacing: 1 }}>
            ON AIR · {remaining}s
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{live.segment.title}</div>
          {live.segment.subtitle ? (
            <div style={{ fontSize: 12, opacity: 0.8 }}>{live.segment.subtitle}</div>
          ) : null}
          {live.upNext.length ? (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              Up next: {live.upNext.map((u) => u.title).join(" · ")}
            </div>
          ) : null}
        </div>
      ) : auto ? (
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Starting up…</div>
      ) : null}

      {/* Hold time */}
      <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
        Hold per shot: <strong>{config.holdSeconds}s</strong>
        <input
          type="range"
          min={4}
          max={40}
          step={1}
          value={config.holdSeconds}
          onChange={(e) => update({ holdSeconds: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>

      {/* Eligible kinds */}
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Show:</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", marginBottom: 12 }}>
        {SEGMENT_KINDS.map((k) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={config.kinds[k]}
              onChange={(e) => update({ kinds: { [k]: e.target.checked } as Record<SegmentKind, boolean> })}
            />
            {KIND_LABEL[k]}
          </label>
        ))}
      </div>

      {/* Thresholds */}
      <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
        Min quake magnitude: <strong>M{config.minQuakeMag.toFixed(1)}</strong>
        <input
          type="range"
          min={2}
          max={8}
          step={0.5}
          value={config.minQuakeMag}
          onChange={(e) => update({ minQuakeMag: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
        Min storm severity: <strong>{config.minAlertSeverity}/4</strong>
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={config.minAlertSeverity}
          onChange={(e) => update({ minAlertSeverity: Number(e.target.value) })}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
    </section>
  );
}
