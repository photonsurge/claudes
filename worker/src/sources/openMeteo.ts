// sources/openMeteo.ts
// Pure helpers for the Open-Meteo spatial-grid NESTS (JMA first; AU/CN/KR are a
// one-line add). Read from the FREE public AWS Open Data bucket `s3://openmeteo`
// (us-west-2, keyless) over plain HTTPS — the SAME no-SDK/no-signing style as the
// UKV/Met-Office mirror. This file is network-free and unit-testable: the ingest
// (worker/src/weather/openMeteo.ts) injects fetch/download and the OM-Files read.
//
// S3 ACCESS: bucket `openmeteo`, region us-west-2, PUBLIC / no credentials.
//   object:  https://openmeteo.s3.amazonaws.com/<key>
//   latest:  https://openmeteo.s3.amazonaws.com/data_spatial/<model>/latest.json
//   file:    data_spatial/<model>/<YYYY>/<MM>/<DD>/<HHMM>Z/<YYYY-MM-DDTHHMM>.om
// (Equivalent to `aws s3 ls --no-sign-request s3://openmeteo/data_spatial/`.)
//
// SPATIAL `.om` LAYOUT (VERIFIED against the live bucket 2026-07-01): ONE `.om`
// file per TIMESTAMP holds ALL variables for that time-step as named children
// (temperature_2m, wind_u_component_10m, …). Analysis (f0) is the file whose
// timestamp == the run's reference_time. Values are decoded in DISPLAY units
// already (temp °C, RH %, wind m/s earth-relative) — no unit conversion, no
// longitude roll, but the grid is lat SOUTH→north so the ingest flips rows to the
// bake's north-up convention.

// ── Bucket constants ──────────────────────────────────────────────────────────
/** Public HTTPS endpoint for the Open-Meteo AWS Open Data bucket. */
export const OPENMETEO_S3_BASE = "https://openmeteo.s3.amazonaws.com";

/** Open-Meteo variable name → our app variable id (keys into VARIABLE_REGISTRY).
 *  Scalars map 1:1; wind is the u/v pair (both earth-relative m/s). */
export interface OmVarMap {
  /** app-scalar id → Open-Meteo child name. */
  scalars: Record<string, string>;
  /** wind u/v Open-Meteo child names (earth-relative → bake directly). */
  windUV?: { u: string; v: string };
}

/** One Open-Meteo model → everything the ingest needs. Adding AU/CN/KR = ONE entry. */
export interface OmModel {
  /** Our SourceDescriptor id (getSource key), e.g. "jma-msm". */
  sourceId: string;
  /** Open-Meteo bucket model id, e.g. "jma_msm". */
  omModel: string;
  /** [W,S,E,N] — MUST equal the descriptor bbox and the `.om` grid extent. */
  bbox: [number, number, number, number];
  /** Grid dims [nx(lon), ny(lat)] = descriptor {width,height}. */
  dims: { width: number; height: number };
  /** Per-axis resolution (the `.om` is anisotropic for JMA MSM). */
  res: { lon: number; lat: number };
  /** Open-Meteo → our variable-name map. */
  varMap: OmVarMap;
}

/**
 * The OM_MODELS table. START with jma-msm. Every field VERIFIED against the live
 * bucket + a decoded f0 `.om` (2026-07-01):
 *   dims [nx=481, ny=505], bbox [120,22.4,150,47.6],
 *   lon res (150-120)/(481-1)=0.0625, lat res (47.6-22.4)/(505-1)=0.05.
 * Adding australia/china/korea later is ONE entry each (see the note at bottom).
 */
export const OM_MODELS: Record<string, OmModel> = {
  "jma-msm": {
    sourceId: "jma-msm",
    omModel: "jma_msm", // VERIFY: confirmed present at data_spatial/jma_msm/latest.json.
    bbox: [120.0, 22.4, 150.0, 47.6],
    dims: { width: 481, height: 505 },
    res: { lon: 0.0625, lat: 0.05 },
    varMap: {
      scalars: {
        temp: "temperature_2m", // decoded °C already → skipUnitConvert.
        humidity: "relative_humidity_2m", // decoded % already → skipUnitConvert.
        // gust: "wind_gusts_10m" — VERIFY: ABSENT from jma_msm as of 2026-07; the
        // ingest skips any mapped var whose `.om` child is missing, so `gust` in
        // the descriptor variables list is simply not produced here (no crash).
      },
      windUV: { u: "wind_u_component_10m", v: "wind_v_component_10m" }, // m/s, earth-relative.
    },
  },

  // ── EU national high-res nests (keyless via Open-Meteo `.om`) ────────────────
  // All grids DECODED from a live f0 (2026-07-01): bbox from latest.json crs_wkt,
  // dims [ny,nx] from the reader, per-axis res = (max-min)/(n-1). All are lat
  // SOUTH-first → the ingest's flipRows applies (same as JMA). Only France HD &
  // MeteoSwiss carry wind_u/v; the rest expose wind_gusts_10m (→ gust) not u/v —
  // the ingest skips whatever child is absent, so listing an unavailable var is safe.

  // Météo-France AROME France HD — ~1 km, the finest EU nest. temp/humidity/wind (no gust child).
  "arome-france-hd": {
    sourceId: "arome-france-hd",
    omModel: "meteofrance_arome_france_hd",
    bbox: [-12.0, 37.5, 16.0, 55.4],
    dims: { width: 2801, height: 1791 },
    // res = EXACT span/(n-1) so alignment holds to float precision (res is metadata
    // only — the bake stretches bbox over width×height). Same pattern for all below.
    res: { lon: (16.0 - -12.0) / (2801 - 1), lat: (55.4 - 37.5) / (1791 - 1) },
    varMap: {
      scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m" },
      windUV: { u: "wind_u_component_10m", v: "wind_v_component_10m" },
    },
  },
  // MeteoSwiss ICON-CH2 — 2 km Alps. temp/humidity/wind/gust (all present).
  "meteoswiss-ch2": {
    sourceId: "meteoswiss-ch2",
    omModel: "meteoswiss_icon_ch2",
    bbox: [1.2333984, 42.57854, 16.846222, 49.786846],
    dims: { width: 545, height: 353 },
    res: { lon: (16.846222 - 1.2333984) / (545 - 1), lat: (49.786846 - 42.57854) / (353 - 1) },
    varMap: {
      scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" },
      windUV: { u: "wind_u_component_10m", v: "wind_v_component_10m" },
    },
  },
  // KNMI HARMONIE-AROME Netherlands — ~2 km. temp/humidity/gust (no u/v wind child).
  "knmi-nl": {
    sourceId: "knmi-nl",
    omModel: "knmi_harmonie_arome_netherlands",
    bbox: [0.0, 49.0, 11.281, 56.002],
    dims: { width: 390, height: 390 },
    res: { lon: (11.281 - 0.0) / (390 - 1), lat: (56.002 - 49.0) / (390 - 1) },
    varMap: { scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" } },
  },
  // DMI HARMONIE-AROME Europe — wide ~2–3 km net (Nordic/Baltic/W-Europe). temp/humidity/gust.
  "dmi-europe": {
    sourceId: "dmi-europe",
    omModel: "dmi_harmonie_arome_europe",
    bbox: [-25.421997, 39.670998, 40.069855, 62.667618],
    dims: { width: 1906, height: 1606 },
    res: { lon: (40.069855 - -25.421997) / (1906 - 1), lat: (62.667618 - 39.670998) / (1606 - 1) },
    varMap: { scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" } },
  },
  // GeoSphere AROME Austria — 2 km Alps/Danube. temp/humidity/gust.
  "arome-austria": {
    sourceId: "arome-austria",
    omModel: "geosphere_arome_austria",
    bbox: [5.498, 42.981, 22.102001, 51.819],
    dims: { width: 594, height: 492 },
    res: { lon: (22.102001 - 5.498) / (594 - 1), lat: (51.819 - 42.981) / (492 - 1) },
    varMap: { scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" } },
  },
  // ItaliaMeteo ARPAE ICON-2I — 2 km Italy/central-Med. temp/humidity/gust.
  "icon-2i-italy": {
    sourceId: "icon-2i-italy",
    omModel: "italia_meteo_arpae_icon_2i",
    bbox: [3.0, 33.7, 22.0, 48.9],
    dims: { width: 761, height: 761 },
    res: { lon: (22.0 - 3.0) / (761 - 1), lat: (48.9 - 33.7) / (761 - 1) },
    varMap: { scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" } },
  },
  // MET Norway Nordic-PP — ~1 km Scandinavia. temp/humidity/gust.
  "metno-nordic": {
    sourceId: "metno-nordic",
    omModel: "metno_nordic_pp",
    bbox: [1.918457, 52.302723, 41.764282, 72.18527],
    dims: { width: 1796, height: 2321 },
    res: { lon: (41.764282 - 1.918457) / (1796 - 1), lat: (72.18527 - 52.302723) / (2321 - 1) },
    varMap: { scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" } },
  },
  // UK Met Office UKV 2 km (via Open-Meteo) — temp/humidity/gust. Beats our direct
  // UKV nest (temp/humidity only) inside the UK; adds the gust the free AWS mirror lacked.
  "ukmo-uk": {
    sourceId: "ukmo-uk",
    omModel: "ukmo_uk_deterministic_2km",
    bbox: [-17.152863, 44.508755, 15.352753, 61.92511],
    dims: { width: 1042, height: 970 },
    res: { lon: (15.352753 - -17.152863) / (1042 - 1), lat: (61.92511 - 44.508755) / (970 - 1) },
    varMap: { scalars: { temp: "temperature_2m", humidity: "relative_humidity_2m", gust: "wind_gusts_10m" } },
  },

  // NOT AVAILABLE on the Open-Meteo spatial bucket (checked 2026-07-01): Australia
  // (no bom_*), Korea (no kma_*), Russia (none). China is only cma_grapes_global
  // (a GLOBAL 0.125° grid — no finer than our ICON-global nest, so not added).
};

/** Enabled-agnostic list (the ingest additionally gates on descriptor.enabled). */
export const omModels = (): OmModel[] => Object.values(OM_MODELS);

// ── latest.json shape ─────────────────────────────────────────────────────────
/** The subset of `data_spatial/<model>/latest.json` we consume. */
export interface OmLatest {
  completed?: boolean;
  /** ISO run time, e.g. "2026-07-01T00:00:00Z". */
  reference_time: string;
  /** ISO valid times available for this run (each has its own `.om`). */
  valid_times: string[];
  /** Open-Meteo variable names present in the run. */
  variables: string[];
}

/** URL of a model's latest-run pointer. */
export function buildLatestUrl(omModel: string): string {
  return `${OPENMETEO_S3_BASE}/data_spatial/${omModel}/latest.json`;
}

// ── Object-key builder ────────────────────────────────────────────────────────
function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/**
 * Build the `.om` object KEY for one (model, run, valid-time). The run directory
 * is the reference_time as `YYYY/MM/DD/HHMMZ`; the file is the VALID time as
 * `YYYY-MM-DDTHHMM.om`. For f0 (analysis) validTime == runTime.
 *
 * Example (jma_msm, 00Z run 2026-07-01, f0):
 *   data_spatial/jma_msm/2026/07/01/0000Z/2026-07-01T0000.om
 */
export function buildOmKey(omModel: string, runDate: Date, validDate: Date): string {
  const rY = runDate.getUTCFullYear();
  const rMo = pad(runDate.getUTCMonth() + 1);
  const rD = pad(runDate.getUTCDate());
  const rH = pad(runDate.getUTCHours());
  const rMi = pad(runDate.getUTCMinutes());
  const runDir = `${rY}/${rMo}/${rD}/${rH}${rMi}Z`;

  const vY = validDate.getUTCFullYear();
  const vMo = pad(validDate.getUTCMonth() + 1);
  const vD = pad(validDate.getUTCDate());
  const vH = pad(validDate.getUTCHours());
  const vMi = pad(validDate.getUTCMinutes());
  const stamp = `${vY}-${vMo}-${vD}T${vH}${vMi}`;

  return `data_spatial/${omModel}/${runDir}/${stamp}.om`;
}

/** Full public HTTPS URL for one `.om` file. */
export function buildOmUrl(omModel: string, runDate: Date, validDate: Date): string {
  return `${OPENMETEO_S3_BASE}/${buildOmKey(omModel, runDate, validDate)}`;
}

// ── Latest-run resolver ───────────────────────────────────────────────────────
export interface OmRun {
  /** reference_time as a Date (UTC). */
  runDate: Date;
  /** f0 valid time (== runDate for analysis). */
  validDate: Date;
  /** Open-Meteo variable names present in the run. */
  variables: string[];
}

/** Injected JSON fetcher (so the resolver is unit-testable with no network). */
export type FetchJson = (url: string) => Promise<unknown>;

/**
 * Parse a latest.json body into an OmRun (f0). Pure — no network. Throws when the
 * run is not completed or malformed so the ingest can skip/retry.
 */
export function parseLatest(latest: OmLatest): OmRun {
  if (!latest || typeof latest.reference_time !== "string") {
    throw new Error("open-meteo latest.json: missing reference_time");
  }
  if (latest.completed === false) {
    throw new Error("open-meteo latest.json: run not completed");
  }
  const runDate = new Date(latest.reference_time);
  if (Number.isNaN(runDate.getTime())) {
    throw new Error(`open-meteo latest.json: bad reference_time ${latest.reference_time}`);
  }
  // f0 = the valid time equal to the run time (first entry is the analysis).
  const validDate = runDate;
  return { runDate, validDate, variables: Array.isArray(latest.variables) ? latest.variables : [] };
}

/**
 * Resolve the latest completed run for a model via its latest.json.
 * `fetchJson` is injected (the ingest passes a real fetch; tests pass a stub).
 */
export async function omLatestRun(omModel: string, fetchJson: FetchJson): Promise<OmRun> {
  const body = (await fetchJson(buildLatestUrl(omModel))) as OmLatest;
  return parseLatest(body);
}
