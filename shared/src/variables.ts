/**
 * The variable registry — the single source of truth for what we ingest, how it
 * is encoded, and how it is displayed. Mirrors spec §4.2. The worker reads the
 * GFS var/level + render kind; the web reads units/palette/domain/encoding.
 *
 * Unit discipline: conversion happens ONCE, in the worker, before baking. The
 * `convert`/`altConvert` fns here are the display-unit conversions used by the
 * legend toggle on the client (e.g. °C↔°F), not the K→°C bake conversion.
 */

export type RenderKind = "particle" | "raster" | "contour";
export type Encoding = "uv" | "scalar";

export interface iGfsField {
  /** GFS variable name(s) (UGRD/VGRD for wind, single name otherwise). */
  vars: string[];
  /** GRIB-filter level token(s), e.g. "10_m_above_ground". */
  levels: string[];
  /** Accumulated field that must be de-accumulated into a rate (e.g. APCP). */
  accumulated?: boolean;
}

export interface iVariableMeta {
  id: string;
  label: string;
  encoding: Encoding;
  kind: RenderKind;
  /** Primary display unit. */
  units: string;
  /** Optional alternate display unit + conversion from primary. */
  altUnit?: string;
  altConvert?: (v: number) => number;
  /** Palette id (see PALETTES). */
  palette: string;
  /** Expected [min,max] in the primary display unit (for the colour ramp). */
  domain: [number, number];
  gfs: iGfsField;
}

export const VARIABLE_REGISTRY: Record<string, iVariableMeta> = {
  wind: {
    id: "wind",
    label: "Wind",
    encoding: "uv",
    kind: "particle",
    units: "m/s",
    altUnit: "kt",
    altConvert: (v) => v * 1.943844,
    palette: "wind",
    domain: [0, 60],
    gfs: { vars: ["UGRD", "VGRD"], levels: ["10_m_above_ground"] },
  },
  temp: {
    id: "temp",
    label: "Temperature",
    encoding: "scalar",
    kind: "raster",
    units: "°C",
    altUnit: "°F",
    altConvert: (v) => (v * 9) / 5 + 32,
    palette: "temp",
    domain: [-40, 50],
    gfs: { vars: ["TMP"], levels: ["2_m_above_ground"] },
  },
  humidity: {
    id: "humidity",
    label: "Humidity",
    encoding: "scalar",
    kind: "raster",
    units: "%",
    palette: "humidity",
    domain: [0, 100],
    gfs: { vars: ["RH"], levels: ["2_m_above_ground"] },
  },
  rain: {
    id: "rain",
    label: "Rain rate",
    encoding: "scalar",
    kind: "raster",
    units: "mm/h",
    palette: "rain",
    domain: [0, 20],
    // PRATE = instantaneous precip rate (kg m⁻² s⁻¹ = mm/s). Exists at EVERY
    // forecast hour incl. f000 and is already a rate, so no de-accumulation and
    // no missing-f000 gap (unlike accumulated APCP, which has no f000 record).
    gfs: { vars: ["PRATE"], levels: ["surface"] },
  },
  storm: {
    id: "storm",
    label: "Storm (CAPE)",
    encoding: "scalar",
    kind: "raster",
    units: "J/kg",
    palette: "storm",
    domain: [0, 4000],
    gfs: { vars: ["CAPE"], levels: ["surface"] },
  },
  gust: {
    id: "gust",
    label: "Wind gust",
    encoding: "scalar",
    kind: "raster",
    units: "m/s",
    altUnit: "kt",
    altConvert: (v) => v * 1.943844,
    palette: "gust",
    domain: [0, 50],
    gfs: { vars: ["GUST"], levels: ["surface"] },
  },
  pressure: {
    id: "pressure",
    label: "Pressure (MSLP)",
    encoding: "scalar",
    kind: "contour",
    units: "hPa",
    palette: "temp",
    domain: [950, 1050],
    gfs: { vars: ["PRMSL"], levels: ["mean_sea_level"] },
  },
};

/** Scalar variables that can be the single active colour field. */
export const SCALAR_VARIABLE_IDS = Object.values(VARIABLE_REGISTRY)
  .filter((v) => v.kind === "raster")
  .map((v) => v.id);

export const getVariable = (id: string): iVariableMeta | undefined => VARIABLE_REGISTRY[id];

// ── Bake-time unit conversions (worker), kept here so there is one home ──────
/** Kelvin → Celsius. */
export const kelvinToCelsius = (k: number): number => k - 273.15;
/** m/s → knots. */
export const msToKnots = (v: number): number => v * 1.943844;
/** Celsius → Fahrenheit. */
export const celsiusToFahrenheit = (c: number): number => (c * 9) / 5 + 32;
/** Pascals → hectopascals. */
export const paToHpa = (p: number): number => p / 100;
