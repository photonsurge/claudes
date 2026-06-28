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

// ── Client CRUD ──────────────────────────────────────────────────────────────

export async function listCities(): Promise<City[]> {
  const res = await fetch("/api/cities", { cache: "no-store" });
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
