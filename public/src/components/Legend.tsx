"use client";

/**
 * Colour-ramp legend for the active variable, with °C/°F and kt/(m/s) unit
 * toggles. All the math lives in lib/legend.ts (pure + tested); this just
 * renders a gradient bar from the variable's palette and labelled stops.
 */
import { getPalette } from "@photonsurge/shared/palettes";
import { getVariable } from "@photonsurge/shared/variables";
import type { TempUnit, WindUnit } from "@photonsurge/shared/control";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { buildLegend } from "../lib/legend";
import { mapFreshness } from "../lib/manifest";

export interface LegendProps {
  variableId: string | null;
  units: { wind: WindUnit; temp: TempUnit };
  onUnitsChange?: (units: { wind: WindUnit; temp: TempUnit }) => void;
  /** When supplied, shows the source + data age under the colour ramp. */
  manifest?: WeatherManifest | null;
  /** Palette actually painting the screen when it differs from the variable's
   *  default — e.g. height-coloured elevation contour LINES use the brighter
   *  `elevation_line` ramp, not the relief fill ramp (see legendPaletteFor). */
  paletteId?: string | null;
}

export default function Legend({ variableId, units, onUnitsChange, manifest, paletteId }: LegendProps) {
  if (!variableId) return null;
  const meta = getVariable(variableId);
  const legend = buildLegend(variableId, units);
  if (!meta || !legend) return null;

  const freshness = manifest ? mapFreshness(manifest, variableId, Date.now()) : null;

  const palette = getPalette(paletteId ?? meta.palette);
  const gradient = `linear-gradient(to right, ${palette
    .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
    .join(", ")})`;

  const showTemp = meta.units === "°C";
  const showWind = meta.units === "m/s";

  return (
    <div style={{ color: "#fff", fontSize: 12, minWidth: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{meta.label}</span>
        <span>{legend.unit}</span>
      </div>
      <div
        data-testid="legend-gradient"
        style={{ height: 12, borderRadius: 4, background: gradient, border: "1px solid #222" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {legend.stops.map((s, i) => (
          <span key={i} style={{ fontSize: 10, opacity: 0.85 }}>
            {s.label}
          </span>
        ))}
      </div>

      {freshness && (
        <div style={{ marginTop: 4, fontSize: 10, opacity: 0.7 }}>
          {freshness.source} · run {freshness.runLabel} · updated {freshness.updatedLabel}
        </div>
      )}

      {(showTemp || showWind) && onUnitsChange && (
        <div style={{ marginTop: 6 }}>
          {showTemp && (
            <button
              type="button"
              onClick={() =>
                onUnitsChange({ ...units, temp: units.temp === "C" ? "F" : "C" })
              }
              style={toggleBtn}
            >
              Show {units.temp === "C" ? "°F" : "°C"}
            </button>
          )}
          {showWind && (
            <button
              type="button"
              onClick={() =>
                onUnitsChange({ ...units, wind: units.wind === "kt" ? "m/s" : "kt" })
              }
              style={toggleBtn}
            >
              Show {units.wind === "kt" ? "m/s" : "kt"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const toggleBtn: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderRadius: 5,
  border: "1px solid #333",
  background: "#1a1f2b",
  color: "#fff",
  cursor: "pointer",
};
