// satimg/frame.ts
// Reusable: fetch a georeferenced satellite image over an ARBITRARY bbox. This is
// deliberately feature-agnostic — the alert-snapshot job is the first consumer,
// but any feature that wants a framed satellite still (an event card, a country
// spotlight image, a side-by-side compare) can call it. One keyless GIBS WMS GET
// of a finished PNG (no Python, Docker-trivial), walking back past unpublished
// days for the daily true-colour mosaic.

import { dimsFor, GIBS_TRUECOLOR_LAYERS, shiftDate } from "./gibs";

/** GIBS WMS endpoint (EPSG:4326 "best" imagery). */
const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

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
  /** Reject bodies smaller than this as empty/error (default 3 KB). */
  minBytes?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

function frameUrl(
  layers: string[],
  bounds: [number, number, number, number],
  width: number,
  height: number,
  date: string,
): string {
  const [w, s, e, n] = bounds;
  const p = new URLSearchParams({
    version: "1.3.0",
    service: "WMS",
    request: "GetMap",
    format: "image/png",
    STYLE: "default",
    TRANSPARENT: "false", // a standalone still, not an overlay
    CRS: "EPSG:4326",
    // WMS 1.3.0 EPSG:4326 axis order is lat,lon → bbox = south,west,north,east.
    bbox: `${s},${w},${n},${e}`,
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: date,
    layers: layers.join(","),
  });
  return `${GIBS_WMS}?${p.toString()}`;
}

/**
 * Fetch a satellite still over `bounds` ([w,s,e,n]), or null if nothing usable is
 * available in the look-back window. Walks back day-by-day from `date`
 * (yesterday) past not-yet-published days (tiny/XML body).
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
  const minBytes = opts.minBytes ?? 3_000;

  for (let i = 0; i <= lookback; i++) {
    const date = shiftDate(base, -i);
    try {
      const res = await f(frameUrl(layers, bounds, width, height, date));
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (ct.includes("xml") || buf.length < minBytes) continue;
      return { png: buf, width, height, view, layers, bounds, observationTime: new Date(`${date}T00:00:00Z`) };
    } catch {
      // try an older day
    }
  }
  return null;
}
