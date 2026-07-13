// satimg/frame.ts
// Reusable: fetch a georeferenced satellite image over an ARBITRARY bbox. This is
// deliberately feature-agnostic — the alert-snapshot job is the first consumer,
// but any feature that wants a framed satellite still (an event card, a country
// spotlight image, a side-by-side compare) can call it. One keyless GIBS WMS GET
// of a finished PNG (no Python, Docker-trivial), walking back past unpublished
// days for the daily true-colour mosaic.

import { dataFraction, dimsFor, fetchMergedTrueColor, GIBS_TRUECOLOR_LAYERS, shiftDate } from "./gibs";

/** Re-exported for callers/tests: fraction of a frame carrying real (non-black) imagery. */
export { dataFraction as frameDataFraction } from "./gibs";

/** Named presets → GIBS layer stacks. `truecolor` is the global daily mosaic. */
export type SatelliteView = "truecolor";
const VIEW_LAYERS: Record<SatelliteView, string[]> = {
  truecolor: GIBS_TRUECOLOR_LAYERS,
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
 * Fetch a satellite still over `bounds` ([w,s,e,n]), or null if nothing usable is
 * available in the look-back window. Each day is composited from the instrument layers
 * CLIENT-SIDE (`fetchMergedTrueColor`) — a single stacked WMS request goes fully black
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

  for (let i = 0; i <= lookback; i++) {
    const date = shiftDate(base, -i);
    const buf = await fetchMergedTrueColor(f, layers, bounds, width, height, date);
    if (!buf) continue; // whole day blank/unpublished — try an older day
    // Guard the "blank satellite" bug: a bbox in polar night / off-swath comes back as a
    // valid-but-mostly-black frame. Reject it (walk back, else give up) so we never store
    // or broadcast a black box.
    if ((await dataFraction(buf)) < MIN_DATA_FRAC) continue;
    return { png: buf, width, height, view, layers, bounds, observationTime: new Date(`${date}T00:00:00Z`) };
  }
  return null;
}
