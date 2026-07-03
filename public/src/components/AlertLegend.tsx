"use client";

/**
 * Overlay key — a compact top-left card explaining the alert + seismic + space-
 * weather colours on the globe. Sections, each shown only when its overlay is on
 * screen:
 *
 *  • Events        — every alert area (and its badge dot) is tinted by hazard
 *                    *type* (flood = blue, fire = red…, see HAZARDS); names the
 *                    types actually drawn so a viewer reads *what* each glowing
 *                    area is.
 *  • Seismic       — the earthquake epicentre ring (size = magnitude) + its
 *                    depth colour coding.
 *  • Space weather — the aurora oval (probability, green→red) and/or the global
 *                    magnetic field (total intensity, blue→red) colour ramps.
 *
 * We intentionally do NOT key severity: the map encodes hazard *type* as hue and
 * only uses severity to modulate glow/opacity, so there's no distinct colour for
 * a severity swatch to label.
 *
 * Plain HTML/CSS overlay (not a deck.gl layer) — it reads only React props, so
 * it renders identically regardless of which basemap (or none) is active,
 * including orbit-focused views with no globe surface underneath.
 *
 * Mirrors the lower-left "now viewing" card's styling. Renders nothing when no
 * section has anything to show.
 */
import type { AlertFeature } from "../lib/alerts";
import { hazardMeta, type HazardType } from "../lib/hazard";
import { QUAKE_DEPTH_COLORS } from "./layers/seismic";
import type { Quake } from "../lib/tracks/types";
import { getPalette } from "@photonsurge/shared/palettes";
import { AURORA_DOMAIN } from "@photonsurge/shared/aurora/types";
import { GEOMAG_DOMAIN } from "@photonsurge/shared/geomag/types";
import type { AuroraOverlay } from "../lib/aurora-overlay";
import type { GeomagOverlay } from "../lib/geomag-overlay";

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

/** Horizontal colour-ramp swatch (palette + domain endpoints), shared by the
 *  aurora / geomag rows below. */
function GradientRow({
  label,
  palette,
  loLabel,
  hiLabel,
  badge,
}: {
  label: string;
  palette: ReturnType<typeof getPalette>;
  loLabel: string;
  hiLabel: string;
  badge?: string;
}) {
  const gradient = `linear-gradient(to right, ${palette
    .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
    .join(", ")})`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</span>
        {badge ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              opacity: 0.85,
              padding: "1px 6px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div
        style={{ height: 8, borderRadius: 4, background: gradient, border: "1px solid rgba(0,0,0,0.4)" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, opacity: 0.75 }}>
        <span>{loLabel}</span>
        <span>{hiLabel}</span>
      </div>
    </div>
  );
}

export default function AlertLegend({
  alerts,
  quakes = [],
  aurora = null,
  geomag = null,
}: {
  alerts: AlertFeature[];
  quakes?: Quake[];
  /** Aurora overlay hook result — present (non-null meta) only when the toggle is on and a frame has loaded. */
  aurora?: AuroraOverlay | null;
  /** Geomagnetic-field overlay hook result — present only when the toggle is on and a frame has loaded. */
  geomag?: GeomagOverlay | null;
}) {
  const hasAlerts = alerts.length > 0;
  const hasQuakes = quakes.length > 0;
  const hasAurora = aurora?.meta != null;
  const hasGeomag = geomag?.meta != null;
  const hasSpaceWeather = hasAurora || hasGeomag;
  if (!hasAlerts && !hasQuakes && !hasSpaceWeather) return null;

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

        {/* ── Space weather (aurora oval + magnetic field ramps) ── */}
        {hasSpaceWeather ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={sectionLabel}>SPACE WEATHER</span>
            {hasAurora ? (
              <GradientRow
                label="Aurora oval"
                palette={getPalette("aurora")}
                loLabel={`${AURORA_DOMAIN[0]}%`}
                hiLabel={`${AURORA_DOMAIN[1]}%+`}
                badge={aurora?.meta.kp != null ? `Kp ${aurora.meta.kp.toFixed(1)}` : undefined}
              />
            ) : null}
            {hasGeomag ? (
              <GradientRow
                label="Magnetic field"
                palette={getPalette("geomag")}
                loLabel={`${Math.round(GEOMAG_DOMAIN[0] / 1000)}k nT`}
                hiLabel={`${Math.round(GEOMAG_DOMAIN[1] / 1000)}k nT`}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
