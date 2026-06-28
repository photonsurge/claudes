/**
 * PURE timeline helpers, split out so they are unit-testable without React.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { textureUrlFor } from "./layers/props";

/** Ordered list of forecast hours in the run. */
export function stepFhrs(manifest: WeatherManifest): number[] {
  return manifest.steps.map((s) => s.fhr);
}

/** Index of `fhr` in the run's steps (0 if absent). */
export function fhrIndex(manifest: WeatherManifest, fhr: number): number {
  const i = stepFhrs(manifest).indexOf(fhr);
  return i < 0 ? 0 : i;
}

/** The fhr `delta` steps from `fhr` (wrapping). */
export function neighbourFhr(manifest: WeatherManifest, fhr: number, delta: number): number {
  const fhrs = stepFhrs(manifest);
  if (fhrs.length === 0) return fhr;
  const i = fhrIndex(manifest, fhr);
  return fhrs[(i + delta + fhrs.length) % fhrs.length];
}

/**
 * Texture URLs for the previous + next steps of the given variables — used to
 * warm the cache so scrubbing/playback doesn't flash.
 */
export function neighbourUrls(
  manifest: WeatherManifest,
  fhr: number,
  variableIds: string[],
): string[] {
  const prev = neighbourFhr(manifest, fhr, -1);
  const next = neighbourFhr(manifest, fhr, 1);
  const urls: string[] = [];
  for (const v of variableIds) {
    for (const f of [prev, next]) {
      const u = textureUrlFor(manifest, v, f);
      if (u) urls.push(u);
    }
  }
  return urls;
}
