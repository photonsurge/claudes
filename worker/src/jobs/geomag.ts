import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import {
  fetchIgrfDipole,
  dipoleForYear,
  dipoleTotalIntensity,
} from "@photonsurge/shared/geomag/igrf";
import { GEOMAG_IMAGE_UNSCALE } from "@photonsurge/shared/geomag/types";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { encodeScalarPng } from "../grib/encode";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:geomag";
const W = 360; // 1° longitude
const H = 181; // -90..90 inclusive

/** Current time as a decimal year (e.g. 2026.5), for secular-variation extrapolation. */
function decimalYear(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (now.getTime() - start) / (end - start);
}

/**
 * Dispatched as type "geomag", event "refresh". Fetches the IGRF-14 dipole
 * coefficients, extrapolates to today, computes total-field intensity on a global
 * grid, and bakes a SCALAR texture into Mongo. Near-static (secular variation is
 * slow), so this runs on a slow cron. The public route reads only the cache.
 */
export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    const coeffs = await fetchIgrfDipole();
    const year = decimalYear();
    const g = dipoleForYear(coeffs, year);

    const values = new Float32Array(W * H);
    let minF = Infinity;
    let maxF = -Infinity;
    for (let r = 0; r < H; r++) {
      const lat = 90 - r; // row 0 = NORTH
      for (let c = 0; c < W; c++) {
        const lon = -180 + c; // col 0 = -180
        const f = dipoleTotalIntensity(lat, lon, g);
        values[r * W + c] = f;
        if (f < minF) minF = f;
        if (f > maxF) maxF = f;
      }
    }
    // Fully opaque scalar field (no nodata mask — the field is defined everywhere).
    const png = await encodeScalarPng(values, W, H, GEOMAG_IMAGE_UNSCALE);

    await db.geomag.replace({
      epoch: coeffs.epoch,
      year,
      nmax: 1,
      bounds: [-180, -90, 180, 90],
      width: W,
      height: H,
      minF: Math.round(minF),
      maxF: Math.round(maxF),
      png,
    });
    const result = { minF: Math.round(minF), maxF: Math.round(maxF), year: Number(year.toFixed(2)) };
    log(TAG, `geomag refresh done`, result);
    blogInfo(TAG, `geomag bake: ${result.minF}–${result.maxF} nT (IGRF-14 dipole)`, result, "geomag", "refresh");
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "geomag" } });
    return result;
  } catch (err) {
    log(TAG, `geomag refresh failed`, summarizeForLog(err));
    blogErr(TAG, `geomag refresh failed`, err, "geomag", "refresh");
    throw err;
  }
}
