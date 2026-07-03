// satimg/gibs.ts
// Fetch a ready-made GLOBAL satellite image from NASA GIBS WMS — keyless, already
// reprojected to EPSG:4326 plate-carrée. ONE HTTP GET of a finished PNG: no Python,
// no HSD download-swarm, no satpy reproject. Pure Node fetch → Docker-trivial (this
// is why we default to GIBS over the raw satpy bake). The public app still never
// calls GIBS — the worker caches the frame in Mongo like every other overlay.

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
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
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
 * Fetch the newest available global true-color mosaic. Walks back day-by-day from
 * `date` (today) until a real image comes back — a not-yet-published day returns a
 * tiny/empty or XML body, which we skip. Returns the PNG bytes + the date used.
 */
export async function fetchGibs(opts: FetchGibsOptions = {}): Promise<GibsFetchResult> {
  const layers = opts.layers ?? GIBS_TRUECOLOR_LAYERS;
  const width = opts.width ?? Number(process.env.SATIMG_WIDTH || 4096);
  const height = opts.height ?? Number(process.env.SATIMG_HEIGHT || 2048);
  const f = opts.fetchImpl ?? fetch;
  const baseDate = opts.date ?? new Date().toISOString().slice(0, 10);
  const lookback = opts.lookbackDays ?? 3;

  let lastErr = "no attempts";
  for (let i = 0; i <= lookback; i++) {
    const date = shiftDate(baseDate, -i);
    try {
      const res = await f(buildUrl(layers, date, width, height));
      if (!res.ok) {
        lastErr = `HTTP ${res.status} for ${date}`;
        continue;
      }
      const ct = res.headers.get("content-type") || "";
      const buf = Buffer.from(await res.arrayBuffer());
      // A no-data day returns an XML ServiceException or a near-empty PNG; a real
      // global mosaic is multi-MB. 50 KB comfortably separates them.
      if (ct.includes("xml") || buf.length < 50_000) {
        lastErr = `empty/xml body (${buf.length}B) for ${date}`;
        continue;
      }
      return { png: buf, date, layers, width, height, bounds: [-180, -90, 180, 90] };
    } catch (err) {
      lastErr = `${date}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(`GIBS fetch failed (${lastErr})`);
}
