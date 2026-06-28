"use client";

/** Operator controls for the wind particle look: quick presets + fine sliders. */
import {
  WIND_PRESETS,
  type WindSettings,
  type WindMode,
} from "@photonsurge/shared/control";

export interface WindControlsProps {
  wind: WindSettings;
  mode: WindMode;
  onWind: (wind: WindSettings) => void;
  onMode: (mode: WindMode) => void;
}

const SLIDERS: Array<{ key: keyof WindSettings; label: string; min: number; max: number; step: number }> = [
  { key: "numParticles", label: "Count", min: 1000, max: 20000, step: 500 },
  { key: "speedFactor", label: "Speed", min: 1, max: 30, step: 1 },
  { key: "maxAge", label: "Trail", min: 5, max: 60, step: 1 },
  { key: "width", label: "Width", min: 0.5, max: 5, step: 0.5 },
];

export default function WindControls({ wind, mode, onWind, onMode }: WindControlsProps) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["particles", "barbs"] as WindMode[]).map((m) => (
          <button key={m} type="button" onClick={() => onMode(m)} style={chip(mode === m)}>
            {m === "particles" ? "Particles" : "Barbs"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.keys(WIND_PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onWind({ ...WIND_PRESETS[name] })}
            style={chip(false)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>

      {mode === "particles" &&
        SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key} style={{ display: "grid", gap: 2, fontSize: 12, color: "#cfd6e4" }}>
            <span style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{label}</span>
              <span style={{ opacity: 0.7 }}>{wind[key]}</span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={wind[key]}
              onChange={(e) => onWind({ ...wind, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "4px 9px",
    borderRadius: 6,
    border: "1px solid #333",
    background: active ? "#2563eb" : "#1a1f2b",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
  };
}
