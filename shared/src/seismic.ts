// Seismic depth classification — the single source of truth for the
// shallow / intermediate / deep cut-offs. The worker's on-air caption, the
// public legend and the epicentre-ring tint all read these so they can never
// drift apart.
//
// Cut-offs follow the standard USGS/seismology convention: shallow quakes
// (< 70 km) rupture close to the surface and shake hardest at the epicentre;
// intermediate (70–300 km) and deep (> 300 km) events release the same energy
// far below ground, so they're felt over a wider area but more weakly.

export const QUAKE_DEPTH_SHALLOW_MAX_KM = 70;
export const QUAKE_DEPTH_INTERMEDIATE_MAX_KM = 300;

export type QuakeDepthClass = "shallow" | "intermediate" | "deep";

/** Bucket a hypocentre depth (km) into shallow / intermediate / deep. */
export function quakeDepthClass(depthKm: number): QuakeDepthClass {
  if (depthKm < QUAKE_DEPTH_SHALLOW_MAX_KM) return "shallow";
  if (depthKm < QUAKE_DEPTH_INTERMEDIATE_MAX_KM) return "intermediate";
  return "deep";
}

/** Human label for a depth class (e.g. "Shallow") — used in captions/legends. */
export function quakeDepthLabel(depthKm: number): string {
  switch (quakeDepthClass(depthKm)) {
    case "shallow":
      return "Shallow";
    case "intermediate":
      return "Intermediate";
    case "deep":
      return "Deep";
  }
}
