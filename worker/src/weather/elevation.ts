// weather/elevation.ts
// Bake a STATIC global elevation raster (land topography + ocean-floor
// bathymetry) from NOAA NCEI ETOPO 2022 (60 arc-second) into a single grayscale
// PNG and publish it as its own one-step `elevation` WeatherRun. The client draws
// it as topographic/bathymetric contour lines (weatherlayers ContourLayer), gated
// by the `showElevation` toggle. Terrain never changes, so this only needs
// running once — re-run to change the bake resolution or swap the DEM source.
//
// Shared by the admin "Bake elevation relief" button (jobs/elevation.ts) and the
// `yarn refresh:elevation` one-shot script. This core NEVER closes the Mongo
// connection (the worker owns it) — the script wrapper handles its own teardown.

import { mkdir, stat, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";

import { fromFile } from "geotiff";
import { getVariable } from "@photonsurge/shared/variables";
import { log } from "@photonsurge/shared/utill/logger";

import { encodeScalarPng } from "../grib/encode";
import { imageUnscaleFor } from "../grib/bake";
import { publishSourceRun } from "./publishSourceRun";

const TAG = "elevation";

/**
 * ETOPO 2022, 60 arc-second, "surface" (ice-surface) elevation, single global
 * GeoTIFF with origin N90/W180 → row 0 = north, column 0 = −180°, matching the
 * baker's grid convention exactly (so NO longitude roll is needed).
 *
 * ETOPO releases are STATIC — a new version lands only every few years (2022 is
 * current), so the cached file below effectively never needs re-fetching.
 */
export const DEFAULT_DEM_URL =
  "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif";

/** Output rows read per strip — bounds peak memory to one horizontal band. */
const STRIP_OUT_ROWS = 120;

/** Persistent DEM cache dir (override with ELEVATION_CACHE_DIR). */
function cacheDir(): string {
  return process.env.ELEVATION_CACHE_DIR ?? join(homedir(), ".cache", "weatherchannel", "dem");
}

/**
 * Return a local path to the DEM, downloading it into the persistent cache only
 * the first time. The 466 MB source is STATIC, so once cached it's reused forever
 * — no more re-downloading on every bake. Streams to a `.part` file and renames
 * on success, so an interrupted download never leaves a truncated "cached" file.
 */
async function ensureCachedDem(url: string): Promise<string> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const dest = join(dir, basename(new URL(url).pathname) || "dem.tif");
  try {
    const s = await stat(dest);
    if (s.size > 0) {
      log(TAG, `using cached DEM: ${dest} (${(s.size / 1e6).toFixed(0)} MB)`);
      return dest;
    }
  } catch {
    // not cached yet
  }
  log(TAG, `downloading DEM → cache (~466 MB, one time): ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`DEM download failed ${res.status} for ${url}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  await rename(part, dest);
  log(TAG, `cached DEM → ${dest}`);
  return dest;
}

export interface IngestElevationOpts {
  /** Local GeoTIFF path — skips the ~466 MB download. */
  demPath?: string;
  /** Remote GeoTIFF to download when no local path is given. */
  demUrl?: string;
  /** Output grid width / height (default 2160×1080). */
  width?: number;
  height?: number;
}

export interface IngestElevationResult {
  width: number;
  height: number;
  bytes: number;
  runId: string;
}

/**
 * Bake + publish the static elevation relief texture. Reads the DEM in
 * horizontal strips and resamples each to the output grid, so a 21600×10800 Int16
 * source never has to sit fully in memory at once (safe inside the worker).
 */
export async function ingestElevation(opts: IngestElevationOpts = {}): Promise<IngestElevationResult> {
  const W = opts.width ?? Number(process.env.ELEVATION_BAKE_WIDTH ?? 2160);
  const H = opts.height ?? Number(process.env.ELEVATION_BAKE_HEIGHT ?? 1080);
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 2 || H < 2) {
    throw new Error(`bad bake dims ${W}×${H}`);
  }

  const localPath = opts.demPath ?? process.env.ELEVATION_DEM_PATH;
  const url = opts.demUrl ?? process.env.ELEVATION_DEM_URL ?? DEFAULT_DEM_URL;

  // Explicit local file wins; otherwise use (and populate) the persistent cache.
  const demPath = localPath ?? (await ensureCachedDem(url));
  if (localPath) log(TAG, `using local DEM: ${demPath}`);

  {
    const tiff = await fromFile(demPath);
    const image = await tiff.getImage();
    const srcW = image.getWidth();
    const srcH = image.getHeight();
    const nodata = image.getGDALNoData();
    log(TAG, `reading ${srcW}×${srcH} DEM, resampling to ${W}×${H} …`);

    const values = new Float32Array(W * H);
    for (let oy0 = 0; oy0 < H; oy0 += STRIP_OUT_ROWS) {
      const oy1 = Math.min(H, oy0 + STRIP_OUT_ROWS);
      const rows = oy1 - oy0;
      // The source-row band this output strip covers (proportional mapping).
      const sy0 = Math.floor((oy0 * srcH) / H);
      const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((oy1 * srcH) / H)));
      const rasters = await image.readRasters({
        window: [0, sy0, srcW, sy1],
        width: W,
        height: rows,
        resampleMethod: "bilinear",
      });
      const band = (Array.isArray(rasters) ? rasters[0] : rasters) as ArrayLike<number>;
      if (!band || band.length !== W * rows) {
        throw new Error(`unexpected strip length ${band?.length} (want ${W * rows})`);
      }
      const off = oy0 * W;
      for (let i = 0; i < band.length; i++) {
        const v = band[i];
        // GDAL nodata (if any) → sea level, so a fill sentinel never paints a
        // spike. ETOPO 2022 has full global coverage, so this is just defensive.
        values[off + i] = nodata != null && v === nodata ? 0 : v;
      }
    }

    const meta = getVariable("elevation");
    if (!meta) throw new Error("elevation variable missing from VARIABLE_REGISTRY");
    const imageUnscale = imageUnscaleFor("elevation");
    const buffer = await encodeScalarPng(values, W, H, imageUnscale);
    log(TAG, `baked PNG ${W}×${H} (${(buffer.byteLength / 1024).toFixed(0)} KiB)`);

    const now = new Date();
    const { runId } = await publishSourceRun({
      model: "elevation",
      runDate: now,
      bounds: [-180, -90, 180, 90],
      grid: { width: W, height: H, res: 360 / W },
      steps: [{ fhr: 0, validTime: now.toISOString() }],
      variables: {
        elevation: {
          meta: {
            encoding: "scalar",
            units: meta.units,
            domain: meta.domain,
            imageUnscale,
            palette: meta.palette,
            sourceId: "etopo",
            resolutionDeg: 360 / W,
            bbox: [-180, -90, 180, 90],
            priority: 5,
          },
          buffers: { 0: buffer },
        },
      },
      // Keep only the newest elevation run (it's static; no history needed).
      retainRuns: 1,
    });

    return { width: W, height: H, bytes: buffer.byteLength, runId };
  }
}
