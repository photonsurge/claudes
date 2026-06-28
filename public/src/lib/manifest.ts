/**
 * Manifest client helpers + the PURE run→manifest mapping shared with the
 * `/api/weather/manifest` route handler.
 *
 * The mapping rewrites each variable's `files` map from stored texture *ids*
 * into fetchable URLs (`/api/weather/tex/<id>`) using the shared `textureUrl`.
 * Keeping it pure means the route can reuse it and tests can assert on it
 * without a database.
 */
import { textureUrl, type WeatherManifest } from "@photonsurge/shared/manifest";
import type { iWeatherRun } from "@photonsurge/shared/db/weather-run-model";

/** The subset of a run we read when building the client manifest. */
export type RunLike = Pick<
  iWeatherRun,
  "model" | "run" | "generatedAt" | "bounds" | "grid" | "steps" | "variables"
>;

/** ISO-normalise a Date | string | undefined. */
function toIso(value: Date | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  // Already a string (e.g. mongoose .lean() may hand back a string/Date).
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/**
 * PURE: build a client `WeatherManifest` from a published run, rewriting texture
 * ids into URLs. Throws nothing; missing optional fields are simply omitted.
 */
export function buildManifestFromRun(run: RunLike): WeatherManifest {
  const variables: WeatherManifest["variables"] = {};
  for (const [id, entry] of Object.entries(run.variables ?? {})) {
    const files: Record<string, string> = {};
    for (const [fhr, textureId] of Object.entries(entry.files ?? {})) {
      files[fhr] = textureUrl(textureId);
    }
    variables[id] = {
      encoding: entry.encoding,
      units: entry.units,
      ...(entry.domain ? { domain: entry.domain } : {}),
      ...(entry.palette ? { palette: entry.palette } : {}),
      ...(entry.imageUnscale ? { imageUnscale: entry.imageUnscale } : {}),
      files,
    };
  }

  const generatedAt = toIso(run.generatedAt);

  return {
    model: run.model,
    run: toIso(run.run) ?? String(run.run),
    ...(generatedAt ? { generatedAt } : {}),
    bounds: run.bounds,
    grid: run.grid,
    steps: run.steps,
    variables,
  };
}

/** Client: fetch the current manifest (or null if no run is published). */
export async function fetchManifest(): Promise<WeatherManifest | null> {
  const res = await fetch("/api/weather/manifest", { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || json.run === null) return null;
  return json as WeatherManifest;
}
