/**
 * USGS Volcano Hazards Program status GeoJSON — the full current alert state for
 * every US-monitored volcano (Alaska/AVO, Hawaii/HVO, Cascades/CVO, Yellowstone,
 * Northern Marianas…), not just the elevated ones the VONA `elevated` feed
 * returns. Each feature carries the Smithsonian VOTW `vnum`, so it joins directly
 * onto our `gvp:<vnum>` docs with NO crosswalk.
 *
 * Why prefer this over the `elevated` feed ([usgs-vona.ts]): it reports NORMAL /
 * GREEN too, so a volcano DE-escalating (WARNING → NORMAL) is visible here — on
 * the elevated feed it just drops off the list, and the timeline would never see
 * the downgrade. Same undocumented VSC application-support API caveat applies:
 * tolerant parsing, degrade gracefully, never couple UI to this shape.
 */
export const USGS_GEOJSON_URL =
  process.env.USGS_GEOJSON_URL || "https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson";

/** Above-normal on either scheme — a genuine monitoring signal worth tracking. */
const ELEVATED_LEVELS = new Set(["ADVISORY", "WATCH", "WARNING"]);
const ELEVATED_COLORS = new Set(["YELLOW", "ORANGE", "RED"]);

export interface UsgsVolcanoStatus {
  /** Our stable `gvp:<vnum>` volcanoId. */
  volcanoId: string;
  name: string;
  lat: number;
  lng: number;
  /** NORMAL | ADVISORY | WATCH | WARNING | UNASSIGNED (raw, uppercased). */
  alertLevel: string;
  /** GREEN | YELLOW | ORANGE | RED | UNASSIGNED (raw, uppercased). */
  colorCode: string;
  noticeSynopsis?: string;
  noticeUrl?: string;
  updatedAtMs: number;
  /** Above-normal on either scheme — safe to upsert a tracking stub for. */
  elevated: boolean;
  /** No monitoring assessment (UNASSIGNED/blank) — record nothing. */
  unassigned: boolean;
}

/** Pure parse of the FeatureCollection → per-volcano status (no HTTP). */
export function parseUsgsGeojson(json: unknown, nowMs: number): UsgsVolcanoStatus[] {
  const features: any[] = Array.isArray((json as any)?.features) ? (json as any).features : [];
  const out: UsgsVolcanoStatus[] = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const vnum = String(p?.vnum ?? "").trim();
    const coords = f?.geometry?.coordinates;
    const lng = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    if (!vnum || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const alertLevel = String(p?.alertLevel ?? "").trim().toUpperCase();
    const colorCode = String(p?.colorCode ?? "").trim().toUpperCase();
    const unassigned =
      (alertLevel === "UNASSIGNED" || alertLevel === "") && (colorCode === "UNASSIGNED" || colorCode === "");
    const elevated = ELEVATED_LEVELS.has(alertLevel) || ELEVATED_COLORS.has(colorCode);

    // Prefer the aviation colour's own timestamp, else the alert-level date.
    const dateStr = p?.colorDate || p?.alertDate;
    const t = dateStr ? Date.parse(String(dateStr).replace(" ", "T")) : NaN;

    out.push({
      volcanoId: `gvp:${vnum}`,
      name: String(p?.volcanoName ?? "").trim() || vnum,
      lat,
      lng,
      alertLevel,
      colorCode,
      noticeSynopsis:
        typeof p?.noticeSynopsis === "string" && p.noticeSynopsis.trim() ? p.noticeSynopsis.trim() : undefined,
      noticeUrl: typeof p?.noticeUrl === "string" && p.noticeUrl ? p.noticeUrl : undefined,
      updatedAtMs: Number.isFinite(t) ? t : nowMs,
      elevated,
      unassigned,
    });
  }
  return out;
}

export async function fetchUsgsVolcanoStatus(fetchImpl: typeof fetch = fetch): Promise<UsgsVolcanoStatus[]> {
  const res = await fetchImpl(USGS_GEOJSON_URL);
  if (!res.ok) throw new Error(`usgs geojson ${res.status}`);
  const json = await res.json();
  return parseUsgsGeojson(json, Date.now());
}
