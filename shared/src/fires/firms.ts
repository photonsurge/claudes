import type { Fire } from "./types";

/**
 * NASA FIRMS active-fire feed (Fire Information for Resource Management System).
 * VIIRS (375 m) / MODIS (1 km) thermal-anomaly detections, near-real-time. The
 * "area" CSV API needs a free per-user MAP_KEY (like the OpenSky/AIS feeds):
 *   https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/world/{DAYS}
 * Get a key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ and set
 * FIRMS_MAP_KEY. The worker polls this into Mongo; the public app reads only the
 * cache. VIIRS and MODIS have slightly different columns, so we map by header name.
 */

export const FIRMS_API_BASE =
  process.env.FIRMS_API_BASE || "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

/** Comma-list of FIRMS sources to merge (default Suomi-NPP VIIRS NRT). */
export const FIRMS_SOURCES = (process.env.FIRMS_SOURCE || "VIIRS_SNPP_NRT")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Lookback window in days (1–10). */
export const FIRMS_DAYS = Math.max(1, Math.min(10, Number(process.env.FIRMS_DAYS || 1)));

export const FIRMS_ATTRIBUTION = "Active fires: NASA FIRMS (VIIRS/MODIS)";

/** VIIRS confidence is l/n/h; MODIS is 0–100. Fold to a 0–100 number. */
function normConfidence(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s === "l" || s === "low") return 30;
  if (s === "n" || s === "nominal") return 60;
  if (s === "h" || s === "high") return 90;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/** Combine FIRMS acq_date ("YYYY-MM-DD") + acq_time ("HHMM"/"HMM") → epoch ms UTC. */
function acqEpochMs(date: string, time: string): number {
  const hm = time.trim().padStart(4, "0");
  const iso = `${date.trim()}T${hm.slice(0, 2)}:${hm.slice(2, 4)}:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Parse a FIRMS "area" CSV into `Fire[]`, mapping columns by header name so it
 * works across VIIRS (bright_ti4) and MODIS (brightness). Rows missing a valid
 * lat/lng are skipped. Ids are minted from satellite + rounded position + acq time
 * so a re-poll of the same detection upserts instead of duplicating.
 */
export function parseFirmsCsv(csv: string): Fire[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const iLat = col("latitude");
  const iLng = col("longitude");
  const iFrp = col("frp");
  const iConf = col("confidence");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iSat = col("satellite");
  const iDay = col("daynight");
  const iBright = col("bright_ti4") >= 0 ? col("bright_ti4") : col("brightness");
  if (iLat < 0 || iLng < 0) return [];

  const out: Fire[] = [];
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split(",");
    const lat = Number(c[iLat]);
    const lng = Number(c[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const satellite = (iSat >= 0 ? c[iSat] : "").trim();
    const acqDate = iDate >= 0 ? c[iDate] : "";
    const acqTimeStr = iTime >= 0 ? c[iTime] : "";
    const dn = (iDay >= 0 ? c[iDay] : "").trim().toUpperCase();
    out.push({
      id: `${satellite || "?"}:${lat.toFixed(4)}:${lng.toFixed(4)}:${acqDate}:${acqTimeStr.trim()}`,
      lat,
      lng,
      frp: iFrp >= 0 && Number.isFinite(Number(c[iFrp])) ? Number(c[iFrp]) : 0,
      brightness: iBright >= 0 && Number.isFinite(Number(c[iBright])) ? Number(c[iBright]) : 0,
      confidence: iConf >= 0 ? normConfidence(c[iConf] ?? "") : 0,
      acqTime: acqEpochMs(acqDate, acqTimeStr),
      daynight: dn === "D" ? "D" : dn === "N" ? "N" : "",
      satellite,
    });
  }
  return out;
}

/** Is a FIRMS map key configured? The worker skips the job when not. */
export const hasFirmsKey = (): boolean => !!(process.env.FIRMS_MAP_KEY || "").trim();

/**
 * Fetch + parse active fires for the whole globe across all configured sources.
 * Throws if no FIRMS_MAP_KEY is set (the caller should gate on `hasFirmsKey`).
 */
export async function fetchFires(fetchImpl: typeof fetch = fetch): Promise<{ fires: Fire[] }> {
  const key = (process.env.FIRMS_MAP_KEY || "").trim();
  if (!key) throw new Error("FIRMS_MAP_KEY not set");
  const byId = new Map<string, Fire>();
  for (const source of FIRMS_SOURCES) {
    const url = `${FIRMS_API_BASE}/${key}/${source}/world/${FIRMS_DAYS}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`firms ${source} ${res.status}`);
    for (const f of parseFirmsCsv(await res.text())) byId.set(f.id, f);
  }
  return { fires: [...byId.values()] };
}
