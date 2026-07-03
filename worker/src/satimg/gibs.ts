// satimg/gibs.ts
// Fetch a ready-made GLOBAL satellite image from NASA GIBS WMS — keyless, already
// reprojected to EPSG:4326 plate-carrée. ONE HTTP GET of a finished PNG: no Python,
// no HSD download-swarm, no satpy reproject. Pure Node fetch → Docker-trivial (this
// is why we default to GIBS over the raw satpy bake). The public app still never
// calls GIBS — the worker caches the frame in Mongo like every other overlay.

import sharp from "sharp";
import { SATIMG_FEEDS } from "@photonsurge/shared/satimg/types";

/** GIBS WMS endpoint (EPSG:4326 "best" available imagery). */
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

/**
 * Polar-orbiter true-color layers, stacked so one satellite's daily swath GAPS are
 * filled by another's pass (WMS composites LAYERS bottom→top in a single GetMap).
 * Together they give a near-seamless global true-color mosaic in one request.
 */
export const GIBS_TRUECOLOR_LAYERS = [
  "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
  "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
  "MODIS_Aqua_CorrectedReflectance_TrueColor",
  "MODIS_Terra_CorrectedReflectance_TrueColor",
  "VIIRS_SNPP_CorrectedReflectance_TrueColor",
];

export interface GibsFetchResult {
  png: Buffer;
  /** The date (YYYY-MM-DD, UTC) actually served. */
  date: string;
  layers: string[];
  width: number;
  height: number;
  /** Always the full globe [W,S,E,N]. */
  bounds: [number, number, number, number];
}

export interface FetchGibsOptions {
  layers?: string[];
  width?: number;
  height?: number;
  /** Base date (YYYY-MM-DD, UTC). Defaults to today; the fetch walks back if unpublished. */
  date?: string;
  /** How many days back to try if the newest day isn't published yet. */
  lookbackDays?: number;
  /** How many consecutive valid days to composite for gap-fill (newest on top). 1 = off. */
  fillDays?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

/** A GIBS true-colour pixel is "no data" (unfilled/half-ingested granule, off-swath)
 *  when it's essentially pure black. Real daytime imagery — even the darkest ocean —
 *  carries a bluish, clearly non-zero value, so this threshold separates genuine gaps
 *  from sea without ever filling (and thus cloud-ghosting) real ocean. */
const NODATA_MAX = 12;

const hasData = (buf: Buffer, o: number) =>
  buf[o + 3] > 0 && Math.max(buf[o], buf[o + 1], buf[o + 2]) > NODATA_MAX;

/**
 * Composite `days` (newest first, all the same dimensions) into one gap-filled frame:
 * for each pixel keep the newest day that has SOLID data there, else fall through to an
 * older day. The freshest daily mosaic's latest orbit is often only half-processed,
 * leaving two kinds of hole — a solid black no-data wedge, and a HALF-INGESTED granule
 * of alternating bright scan lines and gaps. A plain no-data test fills the wedge but
 * keeps the bright stripes (they carry data), so they survive the cloud-key as fake
 * white "cloud" stripes on the globe. "Solid" therefore requires a pixel AND its two
 * vertical neighbours to carry data: a lone horizontal scan line (data bounded above &
 * below by gap) is rejected and filled from the older, complete day. Contiguous real
 * imagery has data neighbours everywhere, so only granule boundaries and the striped /
 * black gaps are ever touched — fresh pixels stay fresh, ghosting is confined to holes.
 * Returns an RGBA PNG.
 */
export async function holeFill(days: Buffer[]): Promise<Buffer> {
  if (days.length <= 1) return days[0];
  const raws = await Promise.all(
    days.map((d) => sharp(d).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  const { width, height } = raws[0].info;
  const layers = raws.map((r) => r.data as Buffer);
  const stride = width * 4;
  const solid = (b: Buffer, x: number, y: number): boolean => {
    const o = (y * width + x) * 4;
    if (!hasData(b, o)) return false;
    if (y === 0 || y === height - 1) return true; // no vertical erosion on the edge rows
    return hasData(b, o - stride) && hasData(b, o + stride);
  };
  const out = Buffer.from(layers[0]); // start from the newest day
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (solid(layers[0], x, y)) continue; // freshest is clean here
      const o = (y * width + x) * 4;
      for (let d = 1; d < layers.length; d++) {
        if (!solid(layers[d], x, y)) continue;
        const src = layers[d];
        out[o] = src[o];
        out[o + 1] = src[o + 1];
        out[o + 2] = src[o + 2];
        out[o + 3] = src[o + 3];
        break;
      }
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** One day's mosaic, or null if that day isn't published yet (xml/near-empty body). */
async function fetchOneDay(
  f: typeof fetch,
  layers: string[],
  date: string,
  width: number,
  height: number,
): Promise<Buffer | null> {
  const res = await f(buildUrl(layers, date, width, height));
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  // A no-data day returns an XML ServiceException or a near-empty PNG; a real global
  // mosaic is multi-MB. 50 KB comfortably separates them.
  if (ct.includes("xml") || buf.length < 50_000) return null;
  return buf;
}

/** YYYY-MM-DD (UTC) shifted by `days`. */
export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildUrl(layers: string[], date: string, width: number, height: number): string {
  const p = new URLSearchParams({
    version: "1.3.0",
    service: "WMS",
    request: "GetMap",
    format: "image/png",
    STYLE: "default",
    CRS: "EPSG:4326",
    // WMS 1.3.0 EPSG:4326 axis order is lat,lon → bbox = south,west,north,east.
    bbox: "-90,-180,90,180",
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: date,
    layers: layers.join(","),
  });
  return `${WMS}?${p.toString()}`;
}

/**
 * Fetch the newest global true-color mosaic, gap-filled. Walks back day-by-day from
 * `date` (yesterday) skipping not-yet-published days (tiny/XML body), and collects up
 * to `fillDays` consecutive valid days. The freshest is the base; older days back-fill
 * ONLY its no-data holes (see `holeFill`) — the daily mosaic's latest orbit is often
 * half-processed, leaving striped/black swath gaps that the cloud-key would otherwise
 * turn into fake white "cloud" stripes on the globe. Returns the (composited) PNG + the
 * newest date used.
 */
export async function fetchGibs(opts: FetchGibsOptions = {}): Promise<GibsFetchResult> {
  const layers = opts.layers ?? GIBS_TRUECOLOR_LAYERS;
  // Keep the baked PNG under Mongo's 16 MB BSON doc limit. A 4096×2048 cloud-keyed
  // RGBA PNG is ~17 MB (over the limit); 2048×1024 is ~4 MB and plenty for a globe
  // overlay. Raise SATIMG_WIDTH/HEIGHT only if the frame stays under ~15 MB.
  const width = opts.width ?? Number(process.env.SATIMG_WIDTH || 2048);
  const height = opts.height ?? Number(process.env.SATIMG_HEIGHT || 1024);
  const f = opts.fetchImpl ?? fetch;
  // Default to YESTERDAY, not today: the polar-orbiter mosaic fills over the UTC day,
  // so "today" is a half-empty globe (the western hemisphere isn't imaged until later).
  // The most recent COMPLETE day is yesterday; the walk-back covers any lag past that.
  const baseDate = opts.date ?? shiftDate(new Date().toISOString().slice(0, 10), -1);
  const lookback = opts.lookbackDays ?? 3;
  const fillDays = Math.max(1, opts.fillDays ?? Number(process.env.SATIMG_FILL_DAYS || 3));

  const collected: { date: string; png: Buffer }[] = [];
  let lastErr = "no attempts";
  for (let i = 0; i <= lookback + fillDays && collected.length < fillDays; i++) {
    const date = shiftDate(baseDate, -i);
    try {
      const png = await fetchOneDay(f, layers, date, width, height);
      if (png) collected.push({ date, png });
      else lastErr = `empty/xml body for ${date}`;
    } catch (err) {
      lastErr = `${date}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (collected.length === 0) throw new Error(`GIBS fetch failed (${lastErr})`);
  const png = await holeFill(collected.map((c) => c.png));
  return { png, date: collected[0].date, layers, width, height, bounds: [-180, -90, 180, 90] };
}

/**
 * Worker-side fetch config per feed id: GIBS layer(s), live?, target long-edge px, and
 * whether to CLOUD-KEY the result. Keying (brightness→alpha) only reads as "clouds" for
 * the true-colour mosaic (dark oceans go transparent); GeoColor's bright oceans and IR's
 * grey background survive the key, so those discs are shown whole and blended by opacity.
 */
const FEED_FETCH: Record<string, { layers: string[]; live: boolean; maxPx: number; cloudKey: boolean }> = {
  global: { layers: GIBS_TRUECOLOR_LAYERS, live: false, maxPx: 2048, cloudKey: true },
  "goes-east": { layers: ["GOES-East_ABI_GeoColor"], live: true, maxPx: 1536, cloudKey: false },
  "goes-west": { layers: ["GOES-West_ABI_GeoColor"], live: true, maxPx: 1536, cloudKey: false },
  himawari: { layers: ["Himawari_AHI_Band13_Clean_Infrared"], live: true, maxPx: 1536, cloudKey: false },
};

/** Pixel dims for a bbox at a target long-edge resolution (keeps the geographic aspect). */
export function dimsFor(bounds: [number, number, number, number], maxPx: number): { width: number; height: number } {
  const [w, s, e, n] = bounds;
  const wspan = Math.abs(e - w);
  const hspan = Math.abs(n - s);
  if (wspan >= hspan) return { width: maxPx, height: Math.max(1, Math.round((maxPx * hspan) / wspan)) };
  return { width: Math.max(1, Math.round((maxPx * wspan) / hspan)), height: maxPx };
}

export interface GibsFeedResult {
  png: Buffer;
  bounds: [number, number, number, number];
  width: number;
  height: number;
  /** The date used (global) or "latest" (live geostationary). */
  when: string;
  /** Whether this feed should be cloud-keyed (only the true-colour mosaic). */
  cloudKey: boolean;
}

/**
 * Fetch one feed's newest image. `global` is the daily true-colour mosaic (full globe,
 * walk-back over the newest complete day); a `live` feed is ONE GetMap over the feed's
 * bbox with NO TIME — GIBS then serves that geostationary layer's latest 10-min slot.
 */
export async function fetchGibsFeed(
  feedId: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GibsFeedResult> {
  const feed = SATIMG_FEEDS.find((f) => f.id === feedId);
  const cfg = FEED_FETCH[feedId];
  if (!feed || !cfg) throw new Error(`unknown satimg feed '${feedId}'`);

  if (!cfg.live) {
    const r = await fetchGibs({ fetchImpl: opts.fetchImpl });
    return { png: r.png, bounds: r.bounds, width: r.width, height: r.height, when: r.date, cloudKey: cfg.cloudKey };
  }

  const f = opts.fetchImpl ?? fetch;
  const { width, height } = dimsFor(feed.bounds, cfg.maxPx);
  const [w, s, e, n] = feed.bounds;
  const p = new URLSearchParams({
    version: "1.3.0",
    service: "WMS",
    request: "GetMap",
    format: "image/png",
    STYLE: "default",
    CRS: "EPSG:4326",
    bbox: `${s},${w},${n},${e}`, // WMS 1.3.0 EPSG:4326 axis order = S,W,N,E
    WIDTH: String(width),
    HEIGHT: String(height),
    layers: cfg.layers.join(","),
    // No TIME → GIBS returns the geostationary layer's latest available slot.
  });
  const res = await f(`${WMS}?${p.toString()}`);
  if (!res.ok) throw new Error(`GIBS ${feedId} HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (ct.includes("xml") || buf.length < 10_000) throw new Error(`GIBS ${feedId} empty/xml (${buf.length}B)`);
  return { png: buf, bounds: feed.bounds, width, height, when: "latest", cloudKey: cfg.cloudKey };
}
