/**
 * Area context for the global round-up: the freshest per-place area-weather
 * reports (hourly numeric stats + hazard flags) and the latest per-place AI
 * round-up headlines. Both are reduced to a tight, hazard-ranked fact-set so the
 * global narrative can name regional conditions ("heatwave across Spain, gales
 * over the North Sea") without re-deriving them. Pure selectors (`selectAreaWeather`,
 * `selectPlaceHeadlines`) are unit-tested; `buildAreaContext` orchestrates the reads.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { iAreaWeatherReportModel } from "@photonsurge/shared/db/area-weather-report-model";
import type { iPlaceRoundupModel } from "@photonsurge/shared/db/place-roundup-model";

/** Freshness windows (hours): area-weather is hourly, round-ups are 12-hourly. */
const AREA_FRESH_H = 6;
const ROUNDUP_FRESH_H = 26;

/** Caps so a global event with thousands of active places can't blow the prompt budget. */
const MAX_AREA = 25;
const MAX_HEADLINES = 15;

/** One notable place's current area weather, compacted for the prompt. */
export interface AreaWeatherLine {
  name: string;
  kind: "country" | "region";
  /** Hazard flag labels present this hour, e.g. ["Heat", "High wind"]. */
  hazards: string[];
  /** Highest hazard severity (0–4) — the ranking key. */
  maxSeverity: SeverityRank;
  /** A handful of the driving variable ranges (min/max + units), hazard places only. */
  stats: { variable: string; min: number; max: number; units: string }[];
}

/** One place's latest AI round-up headline. */
export interface PlaceHeadline {
  name: string;
  kind: "country" | "region";
  headline: string;
  generatedAt: string;
}

export interface AreaContext {
  areaWeather: AreaWeatherLine[];
  placeHeadlines: PlaceHeadline[];
}

const hoursAgo = (d: Date | string, now: Date): number =>
  (now.getTime() - new Date(d).getTime()) / 3_600_000;

/** PURE: keep only fresh reports that carry a hazard flag, rank by severity, cap. */
export function selectAreaWeather(
  reports: iAreaWeatherReportModel[],
  now: Date,
  maxAge = AREA_FRESH_H,
  cap = MAX_AREA,
): AreaWeatherLine[] {
  const lines: AreaWeatherLine[] = [];
  for (const r of reports) {
    if (hoursAgo(r.generatedAt, now) > maxAge) continue;
    if (!r.hazards?.length) continue; // only notable places — calm areas add noise, not signal
    const maxSeverity = r.hazards.reduce<SeverityRank>(
      (m, h) => (h.severityRank > m ? (h.severityRank as SeverityRank) : m),
      0 as SeverityRank,
    );
    // Surface only the variables a hazard actually references, so the digest stays tight.
    lines.push({
      name: r.name,
      kind: r.placeKind,
      hazards: r.hazards.map((h) => h.label),
      maxSeverity,
      stats: (r.stats ?? []).map((s) => ({
        variable: s.variable,
        min: Math.round(s.min * 10) / 10,
        max: Math.round(s.max * 10) / 10,
        units: s.units,
      })),
    });
  }
  lines.sort((a, b) => b.maxSeverity - a.maxSeverity || a.name.localeCompare(b.name));
  return lines.slice(0, cap);
}

/** PURE: keep only fresh round-ups with a real one-line summary, newest first, cap. */
export function selectPlaceHeadlines(
  roundups: iPlaceRoundupModel[],
  now: Date,
  maxAge = ROUNDUP_FRESH_H,
  cap = MAX_HEADLINES,
): PlaceHeadline[] {
  return roundups
    .filter((r) => (r.summary ?? "").trim() && hoursAgo(r.generatedAt, now) <= maxAge)
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, cap)
    .map((r) => ({
      name: r.name,
      kind: r.placeKind,
      headline: (r.summary ?? "").trim(),
      generatedAt: new Date(r.generatedAt).toISOString(),
    }));
}

/** Read the freshest area-weather + place round-ups and reduce them for the prompt. */
export async function buildAreaContext(db: AppDb, now: Date = new Date()): Promise<AreaContext> {
  const [countryArea, regionArea, countryRoundups, regionRoundups] = await Promise.all([
    db.areaWeatherReports.latestByKind("country").catch(() => []),
    db.areaWeatherReports.latestByKind("region").catch(() => []),
    db.countryRoundups.latestPerPlace().catch(() => []),
    db.regionRoundups.latestPerPlace().catch(() => []),
  ]);
  return {
    areaWeather: selectAreaWeather([...countryArea, ...regionArea], now),
    placeHeadlines: selectPlaceHeadlines([...countryRoundups, ...regionRoundups], now),
  };
}

/** Whether the context carries any usable signal (skip weaving it into the prompt if not). */
export function hasAreaSignal(area: AreaContext | undefined | null): boolean {
  return !!area && (area.areaWeather.length > 0 || area.placeHeadlines.length > 0);
}
