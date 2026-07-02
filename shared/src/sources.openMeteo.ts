/**
 * Open-Meteo spatial-grid NESTS — the "reach extender" for models we can't pull
 * directly (JMA/Japan, BOM/Australia, CMA/China, KMA/Korea, …). Read from the
 * public AWS Open Data bucket `s3://openmeteo` (`data_spatial/<model>/<run>/
 * <timestamp>.om`, CC BY 4.0, keyless). Custom `.om` format → read via the
 * OM-Files library (NOT GRIB/wgrib2). Each model is a zoom-gated nest (declares
 * `minZoom`). Same alignment rule as every other nest: dims·res == bbox, and the
 * `.om` grid origin/extent == this bbox == publishSourceRun bounds.
 *
 * NOTE: Open-Meteo re-serves the SAME upstream national models — so this is for
 * BROADER coverage (unlocking gated countries), not higher quality than the
 * direct-GRIB nests we already run. Keep direct for the marquee/live sources.
 *
 * Filled by the Open-Meteo adapter (JMA first, then AU/CN/KR). Spread into
 * SOURCE_REGISTRY by sources.ts.
 */
import type { SourceDescriptor } from "./sources";

export const OPENMETEO_SOURCES: Record<string, SourceDescriptor> = {
  // ── JMA MSM 5 km (Japan / Korea) via Open-Meteo `.om` spatial files ──────────
  // format "netcdf": the descriptor's SourceFormat has no ".om" member, so we tag
  // it as the closest non-GRIB family (like RTOFS/UKV netCDF). It is ACTUALLY the
  // Open-Meteo `.om` format, read by worker/src/sources/openMeteo.ts via the
  // @openmeteo/file-reader OM-Files reader — there is no cdo/wgrib2 in this path.
  //
  // GRID (VERIFIED against the live bucket 2026-07-01 + a decoded f0 `.om`):
  //   latest.json crs_wkt BBOX = [22.4,120.0,47.6,150.0]  (lat_min,lon_min,lat_max,lon_max)
  //   → our [W,S,E,N] bbox = [120.0, 22.4, 150.0, 47.6]  EXACT.
  //   decoded var dims = [505, 481] = [ny(lat), nx(lon)] row-major, lat SOUTH→north.
  //   ANISOTROPIC resolution — lon 0.0625°, lat 0.05°:
  //     lon: (150-120)/(481-1) = 0.0625,  lat: (47.6-22.4)/(505-1) = 0.05.
  //   The SourceDescriptor carries a single scalar `resolutionDeg`; we set it to the
  //   FINER axis (0.05°, lat) for priority/tie-breaking. The exact per-axis res +
  //   the dims·res==bbox alignment (per axis) live in worker OM_MODELS/its test —
  //   the bake only needs width/height, and the RasterLayer stretches this bbox
  //   over the WxH texture, so anisotropy is correct as long as bbox is exact.
  "jma-msm": {
    id: "jma-msm",
    label: "JMA MSM 5 km (Japan)",
    format: "netcdf", // actually Open-Meteo `.om`; see note above.
    grid: "regular",
    dims: { width: 481, height: 505 }, // VERIFY: [nx=481, ny=505] from decoded f0 .om.
    resolutionDeg: 0.05, // finer (lat) axis; lon is 0.0625° — see OM_MODELS for per-axis.
    bbox: [120.0, 22.4, 150.0, 47.6], // VERIFY: exact from latest.json crs_wkt BBOX.
    // JMA MSM runs 8×/day (00,03,06,09,12,15,18,21Z). VERIFY: Open-Meteo republishes
    // hourly-ish; we key runs by the 3-hourly reference_time it exposes in latest.json.
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 120, // VERIFY: ~2h from reference_time to a completed run on the bucket.
    variables: ["temp", "wind", "gust", "humidity"], // gust may be absent upstream → skipped.
    priority: 30, // nest: beats the GFS/IFS global base inside Japan.
    minZoom: 3.5,
    enabled: true,
    attribution: "JMA via Open-Meteo (CC BY 4.0)",
  },

  // ── EU national high-res nests (keyless via Open-Meteo `.om`) ─────────────────
  // Grids DECODED from a live f0 (2026-07-01): bbox from latest.json crs_wkt, dims
  // [width=nx, height=ny] from the reader, res = finer axis (see OM_MODELS for
  // per-axis). All lat SOUTH-first → ingest flips. priority sits ABOVE ICON-D2 (30)
  // / ICON-EU (28) so the national model wins in its country, below MRMS (40).
  // minZoom gates each to roughly its footprint (small countries → zoom in more).

  // Météo-France AROME France HD — ~1 km (finest EU nest). temp/humidity/wind.
  "arome-france-hd": {
    id: "arome-france-hd",
    label: "AROME France HD 1 km",
    format: "netcdf", // Open-Meteo `.om`; see jma-msm note.
    grid: "regular",
    dims: { width: 2801, height: 1791 },
    resolutionDeg: (55.4 - 37.5) / (1791 - 1), // exact finer(lat) axis; matches OM_MODELS.res.
    bbox: [-12.0, 37.5, 16.0, 55.4],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 180,
    variables: ["temp", "wind", "humidity"],
    priority: 34,
    minZoom: 4.5,
    enabled: true,
    attribution: "Météo-France AROME via Open-Meteo (CC BY 4.0)",
  },
  // MeteoSwiss ICON-CH2 — 2 km Alps. temp/humidity/wind/gust.
  "meteoswiss-ch2": {
    id: "meteoswiss-ch2",
    label: "MeteoSwiss ICON-CH2 2 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 545, height: 353 },
    resolutionDeg: (49.786846 - 42.57854) / (353 - 1),
    bbox: [1.2333984, 42.57854, 16.846222, 49.786846],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 180,
    variables: ["temp", "wind", "gust", "humidity"],
    priority: 33,
    minZoom: 4.5,
    // DISABLED 2026-07-02: projected native grid (ICON-CH2) baked as flat lat/lon →
    // stretched/misaligned on the globe (verified vs coastline + icon-eu). Re-enable
    // only after the ingest reprojects it to regular lat/lon (like the direct UKV cdo
    // path). ICON-EU/ICON-global cover this region correctly meanwhile. See [[country-highres-nests]].
    enabled: false,
    attribution: "MeteoSwiss via Open-Meteo (CC BY 4.0)",
  },
  // KNMI HARMONIE-AROME Netherlands — ~2 km. temp/humidity/gust.
  "knmi-nl": {
    id: "knmi-nl",
    label: "KNMI HARMONIE Netherlands 2 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 390, height: 390 },
    resolutionDeg: (56.002 - 49.0) / (390 - 1),
    bbox: [0.0, 49.0, 11.281, 56.002],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 120,
    variables: ["temp", "gust", "humidity"],
    priority: 33,
    minZoom: 4.5,
    enabled: true,
    attribution: "KNMI via Open-Meteo (CC BY 4.0)",
  },
  // DMI HARMONIE-AROME Europe — wide ~2–3 km net (Nordic/Baltic/W-Europe).
  "dmi-europe": {
    id: "dmi-europe",
    label: "DMI HARMONIE Europe 2 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 1906, height: 1606 },
    resolutionDeg: (62.667618 - 39.670998) / (1606 - 1),
    bbox: [-25.421997, 39.670998, 40.069855, 62.667618],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 180,
    variables: ["temp", "gust", "humidity"],
    priority: 31,
    minZoom: 3.5,
    // DISABLED 2026-07-02: projected native grid (DMI HARMONIE) baked as flat lat/lon
    // → badly distorted (UK appeared over France/Belgium). Re-enable after reprojection.
    enabled: false,
    attribution: "DMI via Open-Meteo (CC BY 4.0)",
  },
  // GeoSphere AROME Austria — 2 km Alps/Danube. temp/humidity/gust.
  "arome-austria": {
    id: "arome-austria",
    label: "GeoSphere AROME Austria 2 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 594, height: 492 },
    resolutionDeg: (51.819 - 42.981) / (492 - 1),
    bbox: [5.498, 42.981, 22.102001, 51.819],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 180,
    variables: ["temp", "gust", "humidity"],
    priority: 33,
    minZoom: 4.5,
    // DISABLED 2026-07-02: projected native grid (AROME Austria) baked as flat lat/lon
    // → stretched/misaligned. Re-enable after reprojection.
    enabled: false,
    attribution: "GeoSphere Austria via Open-Meteo (CC BY 4.0)",
  },
  // ItaliaMeteo ARPAE ICON-2I — 2 km Italy/central-Med. temp/humidity/gust.
  "icon-2i-italy": {
    id: "icon-2i-italy",
    label: "ItaliaMeteo ICON-2I 2 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 761, height: 761 },
    resolutionDeg: (48.9 - 33.7) / (761 - 1),
    bbox: [3.0, 33.7, 22.0, 48.9],
    cadence: { kind: "cron", runsUtc: [0, 12] },
    latencyMinutes: 240,
    variables: ["temp", "gust", "humidity"],
    priority: 33,
    minZoom: 4.5,
    // DISABLED 2026-07-02: projected/rotated native grid (ICON-2I) baked as flat lat/lon
    // → stretched/misaligned. Re-enable after reprojection.
    enabled: false,
    attribution: "ItaliaMeteo ARPAE via Open-Meteo (CC BY 4.0)",
  },
  // MET Norway Nordic-PP — ~1 km Scandinavia. temp/humidity/gust.
  "metno-nordic": {
    id: "metno-nordic",
    label: "MET Norway Nordic 1 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 1796, height: 2321 },
    resolutionDeg: (72.18527 - 52.302723) / (2321 - 1),
    bbox: [1.918457, 52.302723, 41.764282, 72.18527],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 90,
    variables: ["temp", "gust", "humidity"],
    priority: 33,
    minZoom: 4,
    // DISABLED 2026-07-02: projected native grid (MET Nordic Lambert) baked as flat
    // lat/lon → shifted ~+1.5° lon + stretched. Re-enable after reprojection.
    enabled: false,
    attribution: "MET Norway via Open-Meteo (CC BY 4.0)",
  },
  // UK Met Office UKV 2 km (via Open-Meteo) — temp/humidity/gust. Wins over our
  // direct UKV nest (temp/humidity only) inside the UK and adds gust.
  "ukmo-uk": {
    id: "ukmo-uk",
    label: "UKMO UKV 2 km",
    format: "netcdf",
    grid: "regular",
    dims: { width: 1042, height: 970 },
    resolutionDeg: (61.92511 - 44.508755) / (970 - 1),
    bbox: [-17.152863, 44.508755, 15.352753, 61.92511],
    cadence: { kind: "cron", runsUtc: [0, 3, 6, 9, 12, 15, 18, 21] },
    latencyMinutes: 150,
    variables: ["temp", "gust", "humidity"],
    priority: 32,
    minZoom: 4,
    // DISABLED 2026-07-02: projected native grid (UKV Lambert-azimuthal) baked as flat
    // lat/lon → misaligned. Our DIRECT `ukv` nest (cdo-remapped Lambert→lat/lon) covers
    // the UK correctly with the same model. Re-enable this only after reprojection.
    enabled: false,
    attribution: "UK Met Office via Open-Meteo (CC BY 4.0)",
  },

  // NOT on the Open-Meteo spatial bucket (checked 2026-07-01): Australia (no bom_*),
  // Korea (no kma_*), Russia (none). China is only cma_grapes_global — a GLOBAL
  // 0.125° grid, no finer than our ICON-global nest, so not added as a nest.
};
