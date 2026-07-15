// satimg/frame.ts
// Reusable: fetch a georeferenced satellite image over an ARBITRARY bbox. This is
// deliberately feature-agnostic — the alert-snapshot job is the first consumer,
// but any feature that wants a framed satellite still (an event card, a country
// spotlight image, a side-by-side compare) can call it. One keyless GIBS WMS GET
// of a finished PNG (no Python, Docker-trivial), walking back past unpublished
// days for the daily true-colour mosaic.

import { dataFraction, dimsFor, fetchMergedLayers, GIBS_LANDTEMP_LAYERS, GIBS_TRUECOLOR_LAYERS, shiftDate } from "./gibs";

/** Re-exported for callers/tests: fraction of a frame carrying real (non-black) imagery. */
export { dataFraction as frameDataFraction } from "./gibs";

/**
 * Named presets → GIBS layer stacks. `truecolor` is the global daily cloud/photo mosaic;
 * `landtemp` is the MODIS land-surface-temperature heat raster (picked for heat hazards,
 * where a true-colour still is just a photo of clear sky — see snapshot-select#viewForAlert).
 */
export type SatelliteView = "truecolor" | "landtemp";
const VIEW_LAYERS: Record<SatelliteView, string[]> = {
  truecolor: GIBS_TRUECOLOR_LAYERS,
  landtemp: GIBS_LANDTEMP_LAYERS,
};

export interface SatelliteFrame {
  png: Buffer;
  width: number;
  height: number;
  view: string;
  layers: string[];
  bounds: [number, number, number, number];
  /** The imagery date actually served (UTC midnight of the mosaic day). */
  observationTime: Date;
}

export interface FetchSatelliteFrameOpts {
  /** Named preset (default "truecolor"). */
  view?: SatelliteView;
  /** Explicit GIBS layer list — overrides `view` for advanced callers. */
  layers?: string[];
  /** Target long-edge resolution in px (default 1024). */
  maxPx?: number;
  /** Base date YYYY-MM-DD (UTC); defaults to yesterday (newest complete mosaic). */
  date?: string;
  /** How many days back to try when the newest day isn't published (default 4). */
  lookbackDays?: number;
  /** Override the view's minimum usable-pixel fraction (see VIEW_MIN_DATA_FRAC). */
  minDataFrac?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Fraction of pixels below which a frame is treated as an all-black GIBS no-data
 * response (polar night, an off-swath bbox, or a whole-day source gap). GIBS renders
 * no-data as SOLID BLACK, so an empty frame is a large, valid PNG; without this check it
 * gets stored and rendered as a black box (the "blank satellite" bug). Env-tunable; a
 * real daytime frame is ~100% data, so 2% only kills the essentially-empty ones. */
const MIN_DATA_FRAC = Number(process.env.SATIMG_MIN_DATA_FRAC || 0.02);

/**
 * Minimum usable-pixel fraction PER VIEW. True-colour only has to not be black. But
 * `landtemp` is land-only AND cloud-masked, so a cloudy or sea-heavy bbox returns a patchy
 * mess that reads badly on air — demand a properly-covered frame and let the caller fall
 * back to true-colour instead (see jobs/alerts#snapshotSatellite). Measured live: a clear
 * land bbox merges to ~.97, a monsoon-clouded one only ~.35.
 */
const VIEW_MIN_DATA_FRAC: Record<SatelliteView, number> = {
  truecolor: MIN_DATA_FRAC,
  landtemp: Number(process.env.SATIMG_LANDTEMP_MIN_DATA_FRAC || 0.5),
};

/**
 * Fetch a satellite still over `bounds` ([w,s,e,n]), or null if nothing usable is
 * available in the look-back window. Each day is composited from the instrument layers
 * CLIENT-SIDE (`fetchMergedLayers`) — a single stacked WMS request goes fully black
 * whenever the top layer has a data gap, since GIBS renders no-data as opaque black.
 * Walks back day-by-day from `date` (yesterday) past unpublished / no-data days.
 */
export async function fetchSatelliteFrame(
  bounds: [number, number, number, number],
  opts: FetchSatelliteFrameOpts = {},
): Promise<SatelliteFrame | null> {
  const view = opts.view ?? "truecolor";
  const layers = opts.layers ?? VIEW_LAYERS[view];
  const maxPx = opts.maxPx ?? 1024;
  const f = opts.fetchImpl ?? fetch;
  const { width, height } = dimsFor(bounds, maxPx);
  const base = opts.date ?? shiftDate(new Date().toISOString().slice(0, 10), -1);
  const lookback = opts.lookbackDays ?? 4;
  const minFrac = opts.minDataFrac ?? VIEW_MIN_DATA_FRAC[view] ?? MIN_DATA_FRAC;

  for (let i = 0; i <= lookback; i++) {
    const date = shiftDate(base, -i);
    const buf = await fetchMergedLayers(f, layers, bounds, width, height, date);
    if (!buf) continue; // whole day blank/unpublished — try an older day
    // Guard the "blank satellite" bug: a bbox in polar night / off-swath comes back as a
    // valid-but-mostly-black frame. Reject it (walk back, else give up) so we never store
    // or broadcast a black box. `landtemp` sets a much higher bar (see VIEW_MIN_DATA_FRAC).
    if ((await dataFraction(buf)) < minFrac) continue;
    return { png: buf, width, height, view, layers, bounds, observationTime: new Date(`${date}T00:00:00Z`) };
  }
  return null;
}
