/**
 * Small PURE selection helpers over the shared registries, used by the pickers
 * and camera-framing code. Centralised so they can be unit-tested.
 */
import { getRegion, type iRegionPreset } from "@photonsurge/shared/regions";
import { getBasemap, BASEMAPS, DEFAULT_BASEMAP_ID } from "@photonsurge/shared/basemaps";

/** A bbox [w,s,e,n] in the shape MapLibre `fitBounds` wants: [[w,s],[e,n]]. */
export type LngLatBounds = [[number, number], [number, number]];

/** Resolve a region id to MapLibre fitBounds corners, or null if unknown. */
export function regionFitBounds(regionId: string): LngLatBounds | null {
  const region: iRegionPreset | undefined = getRegion(regionId);
  if (!region) return null;
  const [w, s, e, n] = region.bbox;
  return [
    [w, s],
    [e, n],
  ];
}

/** Convert an arbitrary [w,s,e,n] bbox to fitBounds corners. */
export function bboxToFitBounds(bbox: [number, number, number, number]): LngLatBounds {
  const [w, s, e, n] = bbox;
  return [
    [w, s],
    [e, n],
  ];
}

/** Resolve a basemap id to its style, falling back to the default basemap. */
export function basemapStyle(basemapId: string): Record<string, unknown> {
  return getBasemap(basemapId).style;
}

/** Is this a known basemap id? */
export function isKnownBasemap(basemapId: string): boolean {
  return BASEMAPS.some((b) => b.id === basemapId);
}

/** The basemap id to use, normalising unknown ids to the default. */
export function resolveBasemapId(basemapId: string | undefined): string {
  return basemapId && isKnownBasemap(basemapId) ? basemapId : DEFAULT_BASEMAP_ID;
}
