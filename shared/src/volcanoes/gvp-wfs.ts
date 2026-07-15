/**
 * The Smithsonian GVP "Volcanoes of the World" GeoServer WFS — the AUTHORITATIVE
 * catalog, far richer than the thin USGS VSC proxy in gvp-catalog.ts (which keeps
 * only name/coords/elevation). Three layers we read:
 *
 *   Smithsonian_VOTW_Holocene_Volcanoes     ~1,196 — the active/recent catalog
 *   Smithsonian_VOTW_Pleistocene_Volcanoes  ~1,451 — older, a SUBSET of the fields
 *   Smithsonian_VOTW_Holocene_Eruptions    ~11,089 — per-eruption history rows
 *
 * Same reverse-engineered GeoServer-WFS pattern as the WMO SWIC alerts feed.
 * Tolerant parsing throughout: treat as best-effort, never couple UI to its shape.
 *
 * DATE MODEL — the important part. GVP eruption dates are intrinsically FUZZY and
 * are NOT safe to force into a JS Date (verified against the live feed):
 *   - `StartDateYear` reaches -55500 (BCE). `new Date(y, m, d)` maps years 0-99 to
 *     1900+, so constructing dates from these silently corrupts them.
 *   - `StartDateMonth`/`StartDateDay` use **0 as an "unknown" sentinel** (not null)
 *     in roughly a THIRD of rows — `new Date(y, 0 - 1, ...)` rolls back a year.
 *   - `EndDateYear` is null in ~56% of rows (ongoing/unknown).
 *   - `*Modifier` carries "?" / "<" / ">" uncertainty qualifiers.
 * So we keep the decomposed year/month/day plus an explicit `precision`, and let
 * callers render the fuzziness instead of inventing false accuracy.
 */

export const GVP_WFS_URL =
  process.env.GVP_WFS_URL || "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs";

export const GVP_LAYER_HOLOCENE = "GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes";
export const GVP_LAYER_PLEISTOCENE = "GVP-VOTW:Smithsonian_VOTW_Pleistocene_Volcanoes";
export const GVP_LAYER_ERUPTIONS = "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions";

/** One catalog volcano. Pleistocene rows carry only a subset (no type/photo/rock). */
export interface GvpVolcanoRecord {
  /** Our canonical `gvp:<vnum>` id. */
  volcanoId: string;
  name: string;
  lat: number;
  lng: number;
  country?: string;
  elevationM?: number;
  volcanoType?: string;
  volcanicLandform?: string;
  region?: string;
  subregion?: string;
  tectonicSetting?: string;
  /** "Holocene" | "Pleistocene". */
  geologicEpoch?: string;
  evidenceCategory?: string;
  majorRockTypes?: string[];
  lastEruptionYear?: number;
  /** GVP's authoritative geology prose — richer than Wikipedia for this. */
  geologicalSummary?: string;
  primaryPhotoUrl?: string;
  primaryPhotoCaption?: string;
  primaryPhotoCredit?: string;
  sourceUrl: string;
}

export type GvpDatePrecision = "year" | "month" | "day";

/** A fuzzy GVP date: always a year (may be negative = BCE), month/day only when known. */
export interface GvpFuzzyDate {
  year: number;
  month?: number;
  day?: number;
  precision: GvpDatePrecision;
  /** "?" | "<" | ">" — GVP's own uncertainty qualifier on the year. */
  modifier?: string;
  /** Years of uncertainty, when GVP states one. */
  uncertaintyYears?: number;
}

export interface GvpEruption {
  volcanoId: string;
  /** GVP's stable eruption id — the upsert key. */
  eruptionNumber: number;
  volcanoName?: string;
  /** "Confirmed Eruption" | "Uncertain Eruption". */
  activityType?: string;
  confirmed: boolean;
  /** Volcanic Explosivity Index 0-7, absent when GVP never assigned one. */
  vei?: number;
  veiModifier?: string;
  start: GvpFuzzyDate;
  end?: GvpFuzzyDate;
  /** How the start was dated, e.g. "Observations: Reported", "Isotopic: 14C". */
  startEvidence?: string;
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? n : undefined;
};

/**
 * Month/day where GVP writes **0 for "unknown"** rather than null. Returns
 * undefined for 0/null/absent so a caller can never build an off-by-one date.
 */
const datePart = (v: unknown): number | undefined => {
  const n = num(v);
  return n && n > 0 ? n : undefined;
};

/** "Trachybasalt / Tephrite Basanite" → ["Trachybasalt", "Tephrite Basanite"]. */
export function parseRockTypes(raw: unknown): string[] | undefined {
  const s = str(raw);
  if (!s) return undefined;
  const parts = s
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * Assemble GVP's decomposed date columns into a fuzzy date. `precision` degrades
 * to "month"/"year" when the finer parts are the unknown sentinel. Returns
 * undefined when there's no year at all (end dates are frequently absent).
 */
export function gvpFuzzyDate(
  year: unknown,
  month: unknown,
  day: unknown,
  modifier?: unknown,
  uncertainty?: unknown,
): GvpFuzzyDate | undefined {
  const y = num(year);
  if (y === undefined) return undefined;
  const m = datePart(month);
  const d = m === undefined ? undefined : datePart(day); // a day without a month is meaningless
  return {
    year: y,
    month: m,
    day: d,
    precision: d !== undefined ? "day" : m !== undefined ? "month" : "year",
    modifier: str(modifier),
    uncertaintyYears: num(uncertainty),
  };
}

/**
 * Render a fuzzy date for humans: "2015", "Jun 1936", "18 Jun 1936", "1500 BCE",
 * with GVP's "?" qualifier preserved. Pure — used by admin + on-air.
 */
export function formatGvpDate(d: GvpFuzzyDate): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const era = d.year < 0 ? `${Math.abs(d.year)} BCE` : String(d.year);
  const mon = d.month ? MONTHS[d.month - 1] : undefined;
  let out = era;
  if (mon && d.precision === "month") out = `${mon} ${era}`;
  else if (mon && d.day) out = `${d.day} ${mon} ${era}`;
  return d.modifier === "?" ? `${out}?` : out;
}

/** Pure parse of a WFS GeoJSON FeatureCollection of volcanoes (Holocene or Pleistocene). */
export function parseGvpVolcanoes(json: unknown): GvpVolcanoRecord[] {
  const features: any[] = (json as any)?.features ?? [];
  const out: GvpVolcanoRecord[] = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const vnum = str(p.Volcano_Number) ?? (num(p.Volcano_Number) !== undefined ? String(num(p.Volcano_Number)) : undefined);
    // Prefer the geometry (authoritative) and fall back to the Lat/Long columns.
    const coords = f?.geometry?.coordinates;
    const lng = num(coords?.[0]) ?? num(p.Longitude);
    const lat = num(coords?.[1]) ?? num(p.Latitude);
    const name = str(p.Volcano_Name);
    if (!vnum || !name || lat === undefined || lng === undefined) continue;
    out.push({
      volcanoId: `gvp:${vnum}`,
      name,
      lat,
      lng,
      country: str(p.Country),
      elevationM: num(p.Elevation),
      volcanoType: str(p.Primary_Volcano_Type),
      volcanicLandform: str(p.Volcanic_Landform),
      region: str(p.Region),
      subregion: str(p.Subregion),
      tectonicSetting: str(p.Tectonic_Setting),
      geologicEpoch: str(p.Geologic_Epoch),
      evidenceCategory: str(p.Evidence_Category),
      majorRockTypes: parseRockTypes(p.Major_Rock_Type),
      lastEruptionYear: num(p.Last_Eruption_Year),
      geologicalSummary: str(p.Geological_Summary),
      primaryPhotoUrl: str(p.Primary_Photo_Link),
      primaryPhotoCaption: str(p.Primary_Photo_Caption),
      primaryPhotoCredit: str(p.Primary_Photo_Credit),
      sourceUrl: `https://volcano.si.edu/volcano.cfm?vn=${vnum}`,
    });
  }
  return out;
}

/** Pure parse of the eruptions FeatureCollection. */
export function parseGvpEruptions(json: unknown): GvpEruption[] {
  const features: any[] = (json as any)?.features ?? [];
  const out: GvpEruption[] = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const vnum = num(p.Volcano_Number);
    const eruptionNumber = num(p.Eruption_Number);
    const start = gvpFuzzyDate(
      p.StartDateYear,
      p.StartDateMonth,
      p.StartDateDay,
      p.StartDateYearModifier,
      p.StartDateYearUncertainty,
    );
    if (vnum === undefined || eruptionNumber === undefined || !start) continue;
    const activityType = str(p.Activity_Type);
    out.push({
      volcanoId: `gvp:${vnum}`,
      eruptionNumber,
      volcanoName: str(p.Volcano_Name),
      activityType,
      confirmed: /confirmed/i.test(activityType ?? ""),
      vei: num(p.ExplosivityIndexMax),
      veiModifier: str(p.ExplosivityIndexModifier),
      start,
      end: gvpFuzzyDate(
        p.EndDateYear,
        p.EndDateMonth,
        p.EndDateDay,
        p.EndDateYearModifier,
        p.EndDateYearUncertainty,
      ),
      startEvidence: str(p.StartEvidenceMethod),
    });
  }
  return out;
}

/** Build a WFS GetFeature URL for a layer (GeoJSON out, no server-side paging by default). */
export function gvpWfsUrl(typeName: string, count?: number): string {
  const q = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  if (count && count > 0) q.set("count", String(count));
  return `${GVP_WFS_URL}?${q.toString()}`;
}

async function fetchLayer(typeName: string, fetchImpl: typeof fetch, count?: number): Promise<unknown> {
  const res = await fetchImpl(gvpWfsUrl(typeName, count));
  if (!res.ok) throw new Error(`gvp wfs ${typeName} ${res.status}`);
  return res.json();
}

/** The ~1,196 Holocene volcanoes — the full-fat catalog rows. */
export async function fetchGvpHoloceneVolcanoes(fetchImpl: typeof fetch = fetch): Promise<GvpVolcanoRecord[]> {
  return parseGvpVolcanoes(await fetchLayer(GVP_LAYER_HOLOCENE, fetchImpl));
}

/** The ~1,451 Pleistocene volcanoes — a SUBSET of the fields (no type/photo/rock/eruption year). */
export async function fetchGvpPleistoceneVolcanoes(fetchImpl: typeof fetch = fetch): Promise<GvpVolcanoRecord[]> {
  return parseGvpVolcanoes(await fetchLayer(GVP_LAYER_PLEISTOCENE, fetchImpl));
}

/** The ~11,089 eruption history rows across every Holocene volcano. */
export async function fetchGvpEruptions(fetchImpl: typeof fetch = fetch): Promise<GvpEruption[]> {
  return parseGvpEruptions(await fetchLayer(GVP_LAYER_ERUPTIONS, fetchImpl));
}
