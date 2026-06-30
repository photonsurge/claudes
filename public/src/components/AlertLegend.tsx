"use client";

/**
 * Overlay key — a compact top-left card explaining the alert + seismic colours
 * on the globe. Two sections, each shown only when its overlay is on screen:
 *
 *  • Events   — every alert area (and its badge dot) is tinted by hazard *type*
 *               (flood = blue, fire = red…, see HAZARDS); names the types
 *               actually drawn so a viewer reads *what* each glowing area is.
 *  • Seismic  — the earthquake epicentre ring (size = magnitude) + its depth
 *               colour coding.
 *
 * We intentionally do NOT key severity: the map encodes hazard *type* as hue and
 * only uses severity to modulate glow/opacity, so there's no distinct colour for
 * a severity swatch to label.
 *
 * Mirrors the lower-left "now viewing" card's styling. Renders nothing when no
 * alert or quake overlay is visible.
 */
import type { AlertFeature } from "../lib/alerts";
import { hazardMeta, type HazardType } from "../lib/hazard";
import { QUAKE_DEPTH_COLORS } from "./layers/seismic";
import type { Quake } from "../lib/tracks/types";

const rgbCss = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Quake epicentre depth tints — sourced from layers/seismic.ts so they can't drift. */
const QUAKE_DEPTH = [
  { label: "Shallow", hex: rgbCss(QUAKE_DEPTH_COLORS.shallow) },
  { label: "Mid", hex: rgbCss(QUAKE_DEPTH_COLORS.intermediate) },
  { label: "Deep", hex: rgbCss(QUAKE_DEPTH_COLORS.deep) },
];

const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 1,
  opacity: 0.55,
  fontWeight: 700,
};

export default function AlertLegend({
  alerts,
  quakes = [],
}: {
  alerts: AlertFeature[];
  quakes?: Quake[];
}) {
  const hasAlerts = alerts.length > 0;
  const hasQuakes = quakes.length > 0;
  if (!hasAlerts && !hasQuakes) return null;

  // Hazard types actually drawn, each at the worst severity it appears at, so
  // the most serious hazards lead the key.
  const worst = new Map<HazardType, number>();
  for (const f of alerts) {
    const h = f.properties.hazard;
    worst.set(h, Math.max(worst.get(h) ?? 0, f.properties.severityRank));
  }
  const types = Array.from(worst.keys()).sort((a, b) => (worst.get(b) ?? 0) - (worst.get(a) ?? 0));

  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        top: 24,
        width: 208,
        pointerEvents: "none",
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 12px",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid rgba(120,140,170,0.15)",
        }}
      >
        <span style={{ fontSize: 13 }}>⚠️</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85 }}>
          Map Key
        </span>
      </div>

      <div style={{ padding: "10px 12px 11px", display: "flex", flexDirection: "column", gap: 11 }}>
        {/* ── Hazard types (badge / area colour) ── */}
        {hasAlerts ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={sectionLabel}>EVENTS</span>
            {types.map((id) => {
              const h = hazardMeta(id);
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 4,
                      flexShrink: 0,
                      background: h.color,
                      boxShadow: `0 0 7px ${h.color}`,
                      border: "1px solid rgba(255,255,255,0.35)",
                    }}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {h.icon} {h.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ── Seismic (epicentre ring + depth) ── */}
        {hasQuakes ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={sectionLabel}>SEISMIC</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  border: "1.5px solid #ef4444",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>
                Earthquake <span style={{ opacity: 0.6, fontWeight: 400 }}>· ring size = magnitude</span>
              </span>
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 1 }}>
              {QUAKE_DEPTH.map((d) => (
                <span key={d.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: d.hex }} />
                  <span style={{ fontSize: 10, opacity: 0.78 }}>{d.label}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
