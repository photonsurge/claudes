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
  /**
   * Which NOMADS GFS product the field comes from. "atmos" (default) is the
   * standard GFS 0.25° atmospheric filter; "wave" is the GFS-Wave global 0.25°
   * filter (different endpoint, dir and file naming).
   */
  product?: "atmos" | "wave";
  /**
   * Restrict the field to ocean or land using the GFS land-sea mask, baking the
   * other side as transparent (alpha 0 = WeatherLayers "nodata"). `sea` for SST
   * (WTMP carries fill values over land), `land` for snow depth.
   */
  mask?: "sea" | "land";
  /**
   * Floor (in the baked/display unit) below which pixels are baked transparent.
   * Lets "show clouds only where there are clouds" / "snow only where there's
   * snow" instead of painting clear/bare areas with the 0-value colour.
   */
  minVisible?: number;
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
  /**
   * GFS field binding. Optional now: ocean-only variables (`current`,
   * `salinity`) have no GFS source and are supplied by RTOFS instead — see
   * `sources.ts` (`sourcesForVariable`) for the full supplier list per variable.
   * The GFS ingest loop skips any variable without a `gfs` binding.
   */
  gfs?: iGfsField;
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
    palette: "pressure",
    domain: [950, 1050],
    gfs: { vars: ["PRMSL"], levels: ["mean_sea_level"] },
  },
  sst: {
    id: "sst",
    label: "Sea surface temp",
    encoding: "scalar",
    kind: "raster",
    units: "°C",
    altUnit: "°F",
    altConvert: (v) => (v * 9) / 5 + 32,
    palette: "sst",
    domain: [-2, 32],
    // GFS 0.25° pgrb2 carries no WTMP (water temp) field, so use TMP:surface —
    // the surface skin temperature, which over ocean is the model's SST — and
    // mask to sea (via the LAND field) so land skin temp is dropped.
    gfs: { vars: ["TMP"], levels: ["surface"], mask: "sea" },
  },
  // ── Sea temperature at depth (RTOFS 3-D, no GFS source) ─────────────────────
  // Same underlying quantity as `sst`, sliced at fixed depths from the global
  // 3-D RTOFS cube (see worker/src/sources/rtofsDepth.ts). Each depth gets its
  // own `domain`: the deep ocean's actual range collapses toward near-freezing,
  // so reusing `sst`'s -2..32 domain would render every depth as a flat,
  // uninformative colour past the thermocline. Domains calibrated (2026) against
  // a live-baked global run's p1/p50/p99: 100m -2.7..27.6..30.0°C,
  // 500m -2.3..15.0..21.7°C, 2000m -1.1..4.4..14.0°C, 5000m -1.8..2.2..3.9°C.
  sst100: {
    id: "sst100",
    label: "Sea temp @100m",
    encoding: "scalar",
    kind: "raster",
    units: "°C",
    altUnit: "°F",
    altConvert: (v) => (v * 9) / 5 + 32,
    palette: "sst",
    domain: [-2, 28],
  },
  sst500: {
    id: "sst500",
    label: "Sea temp @500m",
    encoding: "scalar",
    kind: "raster",
    units: "°C",
    altUnit: "°F",
    altConvert: (v) => (v * 9) / 5 + 32,
    palette: "sst",
    domain: [-2, 16],
  },
  sst2000: {
    id: "sst2000",
    label: "Sea temp @2000m",
    encoding: "scalar",
    kind: "raster",
    units: "°C",
    altUnit: "°F",
    altConvert: (v) => (v * 9) / 5 + 32,
    palette: "sst",
    domain: [-1, 5],
  },
  sst5000: {
    id: "sst5000",
    label: "Sea temp @5000m",
    encoding: "scalar",
    kind: "raster",
    units: "°C",
    altUnit: "°F",
    altConvert: (v) => (v * 9) / 5 + 32,
    palette: "sst",
    domain: [-1, 3],
  },
  cloud: {
    id: "cloud",
    label: "Cloud cover",
    encoding: "scalar",
    kind: "raster",
    units: "%",
    palette: "cloud",
    domain: [0, 100],
    // TCDC (total cloud cover) at entire-atmosphere is a forecast-hour average,
    // so like APCP it has no f000 record and is skipped at f000 by ingest.
    // minVisible: clear sky (<10%) bakes transparent so only cloud shows.
    gfs: { vars: ["TCDC"], levels: ["entire_atmosphere"], minVisible: 10 },
  },
  snow: {
    id: "snow",
    label: "Snow depth",
    encoding: "scalar",
    kind: "raster",
    units: "cm",
    palette: "snow",
    domain: [0, 100],
    // SNOD (snow depth, metres → cm at bake). Mask to land and hide a bare
    // dusting (<0.5 cm) so only real snowpack paints.
    gfs: { vars: ["SNOD"], levels: ["surface"], mask: "land", minVisible: 0.5 },
  },
  wave: {
    id: "wave",
    label: "Wave height",
    encoding: "scalar",
    kind: "raster",
    units: "m",
    palette: "wave_height",
    domain: [0, 12],
    // HTSGW (significant wave height) from the GFS-Wave global 0.25° product.
    // The grid is bitmap-masked over land (GRIB UNDEFINED), which bakeScalar
    // bakes transparent — no separate land mask needed.
    gfs: { vars: ["HTSGW"], levels: ["surface"], product: "wave" },
  },
  // ── Ocean variables (RTOFS, no GFS source) ──────────────────────────────────
  current: {
    id: "current",
    label: "Ocean current",
    // Vector field (u,v) — reuses the existing "uv" 2-channel encoding, coloured
    // by magnitude on the client like wind particles. Supplied by RTOFS surface
    // currents (m/s); land/nodata baked transparent.
    encoding: "uv",
    kind: "particle",
    units: "m/s",
    altUnit: "kt",
    altConvert: (v) => v * 1.943844,
    palette: "current",
    domain: [0, 3],
  },
  salinity: {
    id: "salinity",
    label: "Sea surface salinity",
    encoding: "scalar",
    kind: "raster",
    units: "PSU",
    palette: "salinity",
    // Open-ocean sea-surface salinity sits ~32–37 PSU; domain kept a touch wider.
    domain: [30, 40],
  },
  // ── Regional-nest-only variables (no global GFS base) ───────────────────────
  radar: {
    id: "radar",
    label: "Radar (reflectivity)",
    encoding: "scalar",
    kind: "raster",
    units: "dBZ",
    palette: "radar",
    // Reflectivity 5..75 dBZ. NEST-ONLY: supplied by regional radar mosaics
    // (MRMS over CONUS; OPERA/DWD over Europe next) — there is no global radar
    // base, so this variable renders only inside an active nest's bbox. The <5 dBZ
    // clear-air floor bakes transparent in the worker (minVisible) so the map
    // shows through where it isn't raining.
    domain: [5, 75],
  },
  // ── Static terrain (no forecast source) ─────────────────────────────────────
  elevation: {
    id: "elevation",
    label: "Elevation",
    encoding: "scalar",
    // Drawn as isolines like pressure — topographic + bathymetric contour lines.
    kind: "contour",
    units: "m",
    palette: "elevation",
    // Mariana Trench (~−10,900 m) → Everest (~8,850 m). Land + ocean floor.
    domain: [-11000, 9000],
    // No `gfs` (or any) source binding: elevation is STATIC terrain baked once
    // from a DEM by `yarn refresh:elevation`, not the forecast ingest loop. The
    // GFS ingest skips any variable without a `gfs` field, so this never rides a
    // weather run — it publishes its own tiny single-step "elevation" run.
  },
};

/**
 * Scalar variables that can be the single active colour field. Pressure is
 * `kind: "contour"` (it also draws isobar lines via the separate showPressure
 * toggle) but its baked texture is an ordinary scalar raster like temp/humidity,
 * so it's explicitly included here to be selectable as a coloured map too.
 */
export const SCALAR_VARIABLE_IDS = Object.values(VARIABLE_REGISTRY)
  .filter((v) => v.kind === "raster" || v.id === "pressure")
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
/** Metres → centimetres (snow depth). */
export const metersToCm = (m: number): number => m * 100;
