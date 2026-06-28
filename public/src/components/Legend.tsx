"use client";

/**
 * Colour-ramp legend for the active variable, with °C/°F and kt/(m/s) unit
 * toggles. All the math lives in lib/legend.ts (pure + tested); this just
 * renders a gradient bar from the variable's palette and labelled stops.
 */
import { getPalette } from "@photonsurge/shared/palettes";
import { getVariable } from "@photonsurge/shared/variables";
import type { TempUnit, WindUnit } from "@photonsurge/shared/control";
import { buildLegend } from "../lib/legend";

export interface LegendProps {
  variableId: string | null;
  units: { wind: WindUnit; temp: TempUnit };
  onUnitsChange?: (units: { wind: WindUnit; temp: TempUnit }) => void;
}

export default function Legend({ variableId, units, onUnitsChange }: LegendProps) {
  if (!variableId) return null;
  const meta = getVariable(variableId);
  const legend = buildLegend(variableId, units);
  if (!meta || !legend) return null;

  const palette = getPalette(meta.palette);
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
