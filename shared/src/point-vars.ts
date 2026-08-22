/**
 * Catalog of the weather variables the POINT / AREA HISTORY card can chart — the
 * single source of truth for the per-channel point-variable filter
 * (`ControlState.pointVarsOff`, an off-list — empty = show all) and its admin
 * editor. Ids match the archive series `variable` keys the card renders; the
 * card keeps its own display labels, this catalog carries the operator-facing
 * ones for the form.
 */

/** A point-history variable id (matches the archive series key). */
export type PointVar =
  | "temp"
  | "humidity"
  | "wind"
  | "gust"
  | "rain"
  | "storm"
  | "pressure"
  | "cloud"
  | "snow"
  | "sst"
  | "current"
  | "salinity"
  | "wave";

export interface PointVarMeta {
  id: PointVar;
  label: string;
  /** Ocean-only series — grouped apart in the form so land channels can ignore them. */
  ocean?: boolean;
}

export const POINT_VARS: readonly PointVarMeta[] = [
  { id: "temp", label: "Temperature" },
  { id: "rain", label: "Rain rate" },
  { id: "storm", label: "CAPE (storm energy)" },
  { id: "wind", label: "Wind" },
  { id: "gust", label: "Gusts" },
  { id: "humidity", label: "Humidity" },
  { id: "pressure", label: "Pressure" },
  { id: "cloud", label: "Cloud cover" },
  { id: "snow", label: "Snow depth" },
  { id: "sst", label: "Sea temperature", ocean: true },
  { id: "current", label: "Current", ocean: true },
  { id: "salinity", label: "Salinity", ocean: true },
  { id: "wave", label: "Wave height", ocean: true },
];

export const POINT_VAR_IDS: readonly PointVar[] = POINT_VARS.map((v) => v.id);

const POINT_VAR_SET: ReadonlySet<string> = new Set(POINT_VAR_IDS);

/** Narrow an untrusted value to a known point-history variable id. */
export function isPointVar(value: unknown): value is PointVar {
  return typeof value === "string" && POINT_VAR_SET.has(value);
}
