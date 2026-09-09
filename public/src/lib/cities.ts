/**
 * City form validation + client CRUD wrappers for `/api/cities`.
 * The validator is PURE and shared by the API route and the CityEditor form.
 */
import type { iCity } from "@photonsurge/shared/db/city-model";
import { coalesce } from "./coalesce";

export interface CityInput {
  name?: unknown;
  country?: unknown;
  lat?: unknown;
  lng?: unknown;
  population?: unknown;
  isCapital?: unknown;
}

export interface ValidatedCity {
  name: string;
  country?: string;
  lat: number;
  lng: number;
  population?: number;
  isCapital: boolean;
}

export interface ValidationResult {
  ok: boolean;
  value?: ValidatedCity;
  errors: Record<string, string>;
}

/** PURE: validate + coerce raw city input. */
export function validateCity(input: CityInput): ValidationResult {
  const errors: Record<string, string> = {};

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.name = "Name is required";

  const lat = Number(input.lat);
  if (input.lat === "" || input.lat === undefined || input.lat === null || Number.isNaN(lat)) {
    errors.lat = "Latitude is required";
  } else if (lat < -90 || lat > 90) {
    errors.lat = "Latitude must be between -90 and 90";
  }

  const lng = Number(input.lng);
  if (input.lng === "" || input.lng === undefined || input.lng === null || Number.isNaN(lng)) {
    errors.lng = "Longitude is required";
  } else if (lng < -180 || lng > 180) {
    errors.lng = "Longitude must be between -180 and 180";
  }

  let population: number | undefined;
  if (input.population !== "" && input.population !== undefined && input.population !== null) {
    const p = Number(input.population);
    if (Number.isNaN(p) || p < 0) errors.population = "Population must be a positive number";
    else population = p;
  }

  const country =
    typeof input.country === "string" && input.country.trim() ? input.country.trim() : undefined;
  const isCapital = Boolean(input.isCapital);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: {},
    value: { name, country, lat, lng, population, isCapital },
  };
}

export type City = iCity & { id: string };

// ── Label helpers (progressive reveal + info line) ───────────────────────────

/**
 * The globe zoom at which a city's NAME label should start showing. Capitals and
 * mega-cities appear when zoomed right out; smaller ones fade in as you zoom in,
 * so the globe view stays uncluttered but detail arrives on approach. Purely
 * population-driven (capitals always 0); unknown-population cities get a mid
 * threshold so they still appear but not on the whole-globe view.
 */
export function cityLabelMinZoom(city: Pick<City, "population" | "isCapital">): number {
  if (city.isCapital) return 0;
  const pop = city.population;
  if (pop == null) return 4.5;
  if (pop >= 5_000_000) return 0;
  if (pop >= 2_000_000) return 3.2;
  if (pop >= 1_000_000) return 3.8;
  if (pop >= 500_000) return 4.4;
  if (pop >= 200_000) return 5.0;
  if (pop >= 100_000) return 5.6;
  if (pop >= 50_000) return 6.2;
  if (pop >= 20_000) return 6.8;
  return 7.4;
}

/** Compact population, e.g. 9_000_000 → "9.0M", 540_000 → "540k". */
export function formatPopulation(pop?: number): string | undefined {
  if (pop == null || pop <= 0) return undefined;
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(pop >= 10_000_000 ? 0 : 1)}M`;
  if (pop >= 1_000) return `${Math.round(pop / 1_000)}k`;
  return String(pop);
}

/** The dim secondary line for a city label (country · population), or undefined. */
export function cityDetail(city: Pick<City, "country" | "population" | "isCapital">): string | undefined {
  const parts: string[] = [];
  if (city.country) parts.push(city.country);
  const pop = formatPopulation(city.population);
  if (pop) parts.push(pop);
  if (city.isCapital) parts.push("capital");
  return parts.length ? parts.join(" · ") : undefined;
}

// ── Region (zoom-in) fetch sizing ────────────────────────────────────────────
//
// The globe's base city set is a fixed, bounded list (the world's biggest +
// capital cities — see the /api/cities default). Zooming into a region layers
// in extra local cities via a `bbox`-scoped fetch; these two helpers size that
// query so it never pulls in more than the current view could actually show.

/** Population floor for a region fetch at a given zoom — the inverse of
 * `cityLabelMinZoom`'s bands, so a region query never pulls in a city too
 * small to be revealed (as a label) at the zoom that triggered the fetch. */
export function regionMinPop(zoom: number): number {
  if (zoom >= 6.8) return 0;
  if (zoom >= 6.2) return 20_000;
  if (zoom >= 5.6) return 50_000;
  if (zoom >= 5.0) return 100_000;
  if (zoom >= 4.4) return 200_000;
  if (zoom >= 3.8) return 500_000;
  if (zoom >= 3.2) return 1_000_000;
  return 2_000_000;
}

/** Half-width/height (degrees) of the bbox fetched around the camera at a
 * given zoom — shrinks as you zoom in so the query roughly tracks what's on
 * screen instead of always pulling a fixed-size chunk of the world. */
export function regionHalfExtentDeg(zoom: number): number {
  return Math.min(60, Math.max(2, 90 / Math.pow(1.5, zoom)));
}

// ── Client CRUD ──────────────────────────────────────────────────────────────

export interface ListCitiesOptions {
  /** Restrict results to this ISO country code before applying the limit. */
  cc?: string;
  /** Max rows (default: server default — see /api/cities). */
  limit?: number;
  /** Only cities with population ≥ this. */
  minPop?: number;
  /** Only capitals. */
  capital?: boolean;
  /** [west, south, east, north] — only cities inside this box (wraps the antimeridian if west > east). */
  bbox?: [number, number, number, number];
}

export type CitySortField = "name" | "country" | "lat" | "lng" | "population" | "isCapital" | "rank" | "wikiFetchedAt" | "updated";

export interface ListCitiesPageOptions {
  pageIndex: number;
  pageSize: number;
  sortBy: CitySortField;
  sortDirection: "asc" | "desc";
  q?: string;
}

export interface CitiesPageResult {
  cities: City[];
  count: number;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  error?: string;
}

export async function listCities(opts: ListCitiesOptions = {}): Promise<City[]> {
  const q = new URLSearchParams();
  if (opts.cc) q.set("cc", opts.cc.toLowerCase());
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.minPop) q.set("minPop", String(opts.minPop));
  if (opts.capital) q.set("capital", "1");
  if (opts.bbox) q.set("bbox", opts.bbox.map((n) => n.toFixed(4)).join(","));
  const qs = q.toString();
  try {
    const res = await fetch(`/api/cities${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.cities ?? []) as City[];
  } catch {
    // Transient network / HMR-rebuild "Failed to fetch" — fail soft to empty
    // (same contract as the !res.ok path). Callers like useRegionCities chain a
    // bare .then() with no .catch(), so a throw here surfaces as an unhandled
    // runtime error.
    return [];
  }
}

/** Worker-cached current conditions for one city (native units: temp °C, wind/
 *  rain m/s & mm) — surfaced on the on-air "CITY CONDITIONS" slide. */
export interface CityConditionNow {
  temp?: number;
  wind?: number;
  rain?: number;
}

/** One day of a city's cached 3-day forecast (native units). */
export interface CityConditionDay {
  date: string;
  hi?: number;
  lo?: number;
  rain?: number;
  gust?: number;
}

/** A city with its current conditions + 3-day forecast, from /api/cities/weather. */
export interface CityCondition {
  cityId: string;
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
  current?: CityConditionNow;
  daily?: CityConditionDay[];
}

/** The biggest cities in `bbox`, population-ranked, each with cached now + 3-day
 *  forecast. Empty on any error — the slide self-hides. */
export async function listCityConditions(
  bbox: [number, number, number, number],
  limit = 10,
): Promise<CityCondition[]> {
  const q = new URLSearchParams({
    bbox: bbox.map((n) => n.toFixed(4)).join(","),
    limit: String(limit),
  });
  // Coalesce simultaneous identical pulls — CityForecastStrip + CityConditionsPanel
  // frame the same bbox and both read on the same cut; share one round-trip.
  const url = `/api/cities/weather?${q.toString()}`;
  return coalesce(url, async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [] as CityCondition[];
      const json = await res.json();
      return (json?.cities ?? []) as CityCondition[];
    } catch {
      return [] as CityCondition[];
    }
  });
}

/** Worker-cached now + 3-day forecast for a specific set of cities (by their
 *  `id`), used to hang weather off the distance-ranked "nearest cities" of a
 *  quake / volcano slide. Empty on any error — callers degrade to no weather. */
export async function listCityConditionsByIds(ids: string[]): Promise<CityCondition[]> {
  const clean = ids.filter(Boolean);
  if (!clean.length) return [];
  const q = new URLSearchParams({ ids: clean.join(",") });
  const url = `/api/cities/weather?${q.toString()}`;
  return coalesce(url, async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [] as CityCondition[];
      const json = await res.json();
      return (json?.cities ?? []) as CityCondition[];
    } catch {
      return [] as CityCondition[];
    }
  });
}

/** The biggest cities in a COUNTRY (ISO-3166 alpha-2 `cc`) with their now +
 *  3-day forecast — the country-spotlight variant of listCityConditions that
 *  scopes by country code instead of a bbox, so neighbours that fall in the
 *  frame don't leak in. Empty on any error — the slide degrades to hidden. */
export async function listCityConditionsByCc(cc: string, limit = 10): Promise<CityCondition[]> {
  const code = cc.trim();
  if (!code) return [];
  const q = new URLSearchParams({ cc: code, limit: String(limit) });
  const url = `/api/cities/weather?${q.toString()}`;
  return coalesce(url, async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [] as CityCondition[];
      const json = await res.json();
      return (json?.cities ?? []) as CityCondition[];
    } catch {
      return [] as CityCondition[];
    }
  });
}

/** Server-paged city registry for the operator table; globe callers keep using listCities. */
export async function listCitiesPage(opts: ListCitiesPageOptions): Promise<CitiesPageResult> {
  const q = new URLSearchParams({
    page: String(opts.pageIndex + 1),
    pageSize: String(opts.pageSize),
    sort: opts.sortBy,
    direction: opts.sortDirection,
  });
  if (opts.q) q.set("q", opts.q);
  try {
    const res = await fetch(`/api/cities?${q.toString()}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { cities: [], count: 0, total: 0, page: 1, pageSize: opts.pageSize, pageCount: 0, error: body?.error ?? `HTTP ${res.status}` };
    }
    return body as CitiesPageResult;
  } catch (error) {
    return { cities: [], count: 0, total: 0, page: 1, pageSize: opts.pageSize, pageCount: 0, error: String(error) };
  }
}

/** Fetch one full city record for its dedicated details page. */
export async function getCity(id: string): Promise<{ city?: City; error?: string }> {
  try {
    const res = await fetch(`/api/cities/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.city) return { error: body?.error ?? `HTTP ${res.status}` };
    return { city: body.city as City };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function createCity(value: ValidatedCity): Promise<City | null> {
  const res = await fetch("/api/cities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) return null;
  return (await res.json())?.city ?? null;
}

export async function updateCity(id: string, value: Partial<ValidatedCity>): Promise<City | null> {
  const res = await fetch(`/api/cities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) return null;
  return (await res.json())?.city ?? null;
}

export async function deleteCity(id: string): Promise<boolean> {
  const res = await fetch(`/api/cities/${id}`, { method: "DELETE" });
  return res.ok;
}

export interface QueueCitiesEnrichmentResult {
  ok: boolean;
  jobId?: string;
  alreadyQueued?: boolean;
  error?: string;
}

export type CityEnrichmentScope = "prominent" | "all";

/** Queue either the quick prominent-city run or the low-priority all-city chain. */
export async function queueCitiesEnrichment(scope: CityEnrichmentScope = "all"): Promise<QueueCitiesEnrichmentResult> {
  try {
    const res = await fetch("/api/admin/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scope === "all" ? "cities-enrich-all" : "cities-enrich" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return { ok: true, jobId: body.jobId, alreadyQueued: body.alreadyQueued === true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
