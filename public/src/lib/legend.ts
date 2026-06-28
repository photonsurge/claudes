/**
 * PURE legend math: convert a variable's display domain/value into the unit the
 * operator has toggled (°C↔°F, kt↔m/s) using the shared conversion fns.
 *
 * Discipline: textures are baked in the variable's *primary* unit (e.g. temp in
 * °C, wind in m/s). The legend only re-labels for display; it never affects the
 * baked texture decode.
 */
import {
  celsiusToFahrenheit,
  msToKnots,
  getVariable,
} from "@photonsurge/shared/variables";
import type { TempUnit, WindUnit } from "@photonsurge/shared/control";

export interface LegendStop {
  /** Value in the displayed unit. */
  value: number;
  /** Normalised position 0..1 across the domain. */
  t: number;
  label: string;
}

export interface LegendView {
  unit: string;
  domain: [number, number];
  stops: LegendStop[];
}

/** Convert a single value from a variable's primary unit into the chosen unit. */
export function convertValue(
  variableId: string,
  value: number,
  units: { wind: WindUnit; temp: TempUnit },
): { value: number; unit: string } {
  const meta = getVariable(variableId);
  if (!meta) return { value, unit: "" };

  // Temperature: primary °C → optionally °F.
  if (meta.units === "°C") {
    return units.temp === "F"
      ? { value: celsiusToFahrenheit(value), unit: "°F" }
      : { value, unit: "°C" };
  }
  // Wind / gust: primary m/s → optionally kt.
  if (meta.units === "m/s") {
    return units.wind === "kt"
      ? { value: msToKnots(value), unit: "kt" }
      : { value, unit: "m/s" };
  }
  return { value, unit: meta.units };
}

/**
 * Build a legend view (domain + evenly-spaced labelled stops) for a variable in
 * the operator's chosen units.
 */
export function buildLegend(
  variableId: string,
  units: { wind: WindUnit; temp: TempUnit },
  steps = 5,
): LegendView | null {
  const meta = getVariable(variableId);
  if (!meta) return null;

  const [min, max] = meta.domain;
  const lo = convertValue(variableId, min, units);
  const hi = convertValue(variableId, max, units);
  const unit = lo.unit;

  const stops: LegendStop[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    // Interpolate in the primary domain, then convert so non-linear-safe.
    const primary = min + (max - min) * t;
    const { value } = convertValue(variableId, primary, units);
    stops.push({ value, t, label: formatLabel(value, unit) });
  }

  return {
    unit,
    domain: [lo.value, hi.value],
    stops,
  };
}

function formatLabel(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${unit ? ` ${unit}` : ""}`;
}
