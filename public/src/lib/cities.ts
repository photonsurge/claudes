/**
 * City form validation + client CRUD wrappers for `/api/cities`.
 * The validator is PURE and shared by the API route and the CityEditor form.
 */
import type { iCity } from "@photonsurge/shared/db/city-model";

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

// ── Client CRUD ──────────────────────────────────────────────────────────────

export interface ListCitiesOptions {
  /** Max rows (default: server default 300). */
  limit?: number;
  /** Only cities with population ≥ this. */
  minPop?: number;
  /** Only capitals. */
  capital?: boolean;
}

export async function listCities(opts: ListCitiesOptions = {}): Promise<City[]> {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.minPop) q.set("minPop", String(opts.minPop));
  if (opts.capital) q.set("capital", "1");
  const qs = q.toString();
  const res = await fetch(`/api/cities${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.cities ?? []) as City[];
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
