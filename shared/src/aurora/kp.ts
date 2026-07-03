/**
 * NOAA SWPC planetary K-index (Kp) — the global geomagnetic activity level, 0–9,
 * updated every 3 hours. This is the scalar that drives the aurora oval: as Kp
 * rises the oval swells toward the equator. The worker reads it alongside the
 * OVATION grid and stores the latest value on the aurora frame, so the broadcast
 * HUD can show a "Kp 5.3 · G1 storm" readout next to the glowing oval.
 *
 * SWPC has published this feed as both an array-of-arrays (with a text header row)
 * and an array-of-objects over the years, so `parseKp` accepts either shape.
 */

export const KP_INDEX_URL =
  process.env.KP_INDEX_URL ||
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

/** One Kp sample. */
export interface KpPoint {
  time: string;
  kp: number;
}

/** The latest Kp plus a short recent history (oldest→newest) for a sparkline. */
export interface KpReading {
  kp: number;
  time: string;
  series: KpPoint[];
}

/** NOAA G-scale classification of a Kp value (colour for the HUD chip). */
export interface KpLevel {
  /** Geomagnetic-storm G number (0 = below storm threshold). */
  g: number;
  /** Short code: "Kp3" below storm level, else "G1"…"G5". */
  code: string;
  /** Human label ("Quiet", "Active", "Minor storm"…). */
  name: string;
  /** Chip colour (hex). */
  color: string;
}

const toNum = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse the planetary-K feed into the latest reading + recent series. Tolerates
 * both the array-of-arrays (leading text header) and array-of-objects encodings;
 * returns null when nothing usable is present so the caller can leave Kp blank.
 */
export function parseKp(json: unknown, maxPoints = 24): KpReading | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const points: KpPoint[] = [];

  if (Array.isArray(json[0])) {
    // Array-of-arrays. Detect + drop a text header, and locate the columns.
    let rows = json as unknown[][];
    let timeCol = 0;
    let kpCol = 1;
    const head = rows[0];
    const headerIsText = head.every((c) => typeof c === "string") && toNum(head[1]) === null;
    if (headerIsText) {
      const lower = head.map((c) => String(c).toLowerCase());
      const ti = lower.findIndex((h) => h.includes("time"));
      const ki = lower.findIndex((h) => h.includes("kp") || h === "k_index");
      if (ti >= 0) timeCol = ti;
      if (ki >= 0) kpCol = ki;
      rows = rows.slice(1);
    }
    for (const r of rows) {
      const kp = toNum(r[kpCol]);
      if (kp === null) continue;
      points.push({ time: String(r[timeCol] ?? ""), kp });
    }
  } else if (json[0] && typeof json[0] === "object") {
    for (const o of json as Record<string, unknown>[]) {
      const kp = toNum(o.Kp ?? o.kp ?? o.kp_index ?? o.estimated_kp);
      if (kp === null) continue;
      points.push({ time: String(o.time_tag ?? o.time ?? ""), kp });
    }
  }

  if (!points.length) return null;
  const series = points.slice(-maxPoints);
  const last = series[series.length - 1];
  return { kp: last.kp, time: last.time, series };
}

/** Fetch + parse the Kp feed. Returns null on HTTP/parse failure (Kp is optional). */
export async function fetchKp(fetchImpl: typeof fetch = fetch): Promise<KpReading | null> {
  const res = await fetchImpl(KP_INDEX_URL);
  if (!res.ok) throw new Error(`planetary-k ${res.status}`);
  return parseKp(await res.json());
}

/** Classify a Kp value on the NOAA G-scale, with a HUD chip colour. */
export function kpLevel(kp: number): KpLevel {
  if (kp >= 9) return { g: 5, code: "G5", name: "Extreme storm", color: "#a21caf" };
  if (kp >= 8) return { g: 4, code: "G4", name: "Severe storm", color: "#dc2626" };
  if (kp >= 7) return { g: 3, code: "G3", name: "Strong storm", color: "#f97316" };
  if (kp >= 6) return { g: 2, code: "G2", name: "Moderate storm", color: "#f59e0b" };
  if (kp >= 5) return { g: 1, code: "G1", name: "Minor storm", color: "#eab308" };
  if (kp >= 4) return { g: 0, code: "Kp4", name: "Active", color: "#84cc16" };
  if (kp >= 3) return { g: 0, code: "Kp3", name: "Unsettled", color: "#22c55e" };
  return { g: 0, code: `Kp${Math.max(0, Math.round(kp))}`, name: "Quiet", color: "#22c55e" };
}
