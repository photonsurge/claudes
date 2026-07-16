/**
 * Turn a clicked map feature (earthquake / severe-weather alert) into a director
 * `Segment` so the operator's manual selection renders in the exact same info
 * box the auto-director shows on air. Reuses the shared content builders, so the
 * card text is byte-identical to a director cut for the same event.
 */
import type { Segment } from "@photonsurge/shared/director";
import { quakeSegmentContent, alertSegmentContent, volcanoSegmentContent, volcanoTrackInfo } from "@photonsurge/shared/segments";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import type { Quake } from "./tracks/types";
import type { AlertFeature } from "./alerts";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";

/** Frame zooms mirror the director's quake/storm shots (candidates.ts). */
const QUAKE_ZOOM = 5;
const STORM_ZOOM = 4.5;
const VOLCANO_ZOOM = 5;
/** Frame zoom for a plain clicked map point — a touch wider than a quake shot. */
const POINT_ZOOM = 5;

/**
 * Turn a plain clicked map coordinate (no event feature under the cursor) into a
 * `point`-kind `Segment`, so the operator's click renders in the same "Now
 * viewing" card /watch shows on air — just anchored at the picked point. `point`
 * is a sandbox-only kind (never director-scheduled): a non-targeted, real-location
 * shot, so it gets the tucked-away card + a forecast footer rather than a reticle.
 * `label` (nearest-city or coordinate name) and `subtitle` (distance/context)
 * are resolved by the caller, which owns the cities list.
 */
export function pointToSegment(
  lng: number,
  lat: number,
  label: string,
  subtitle?: string,
): Segment {
  return {
    id: `point:${lng.toFixed(3)},${lat.toFixed(3)}`,
    kind: "point",
    title: label,
    subtitle,
    camera: { center: [lng, lat], zoom: POINT_ZOOM },
    patch: {},
    holdMs: 0,
  };
}

export function quakeToSegment(q: Quake): Segment {
  const c = quakeSegmentContent({
    mag: q.mag,
    place: q.place,
    depthKm: q.depthKm,
    timeMs: q.time,
    tsunami: q.tsunami,
  });
  return {
    id: `quake:${q.id}`,
    kind: "quake",
    title: c.title,
    subtitle: c.subtitle,
    details: c.details,
    quake: { mag: q.mag, depthKm: q.depthKm },
    tsunami: q.tsunami,
    camera: { center: [q.lng, q.lat], zoom: QUAKE_ZOOM },
    patch: {},
    holdMs: 0,
  };
}

/** null when the polygon has no usable centroid (can't frame or place it). */
export function alertFeatureToSegment(f: AlertFeature): Segment | null {
  const center = alertRepPoint(f.geometry as Parameters<typeof alertRepPoint>[0]);
  if (!center) return null;
  const p = f.properties;
  const sinceMs = p.since ? Date.parse(p.since) : NaN;
  const c = alertSegmentContent({
    source: p.source,
    identifier: p.identifier,
    event: p.event,
    translatedEvent: p.translatedHeadline,
    severityRank: p.severityRank,
    level: p.level,
    areaDesc: p.areaDesc,
    // The shape is a dissolved weather system, not one county — see
    // alertSegmentContent.warningCount.
    warningCount: p.memberCount,
    hazard: p.hazard,
    center,
    sinceMs: Number.isNaN(sinceMs) ? undefined : sinceMs,
  });
  return {
    id: `storm:${p.source}:${p.identifier}`,
    kind: "storm",
    title: c.title,
    subtitle: c.subtitle,
    icon: c.icon,
    details: c.details,
    camera: { center, zoom: STORM_ZOOM },
    patch: {},
    holdMs: 0,
  };
}

/**
 * Content (title/subtitle/details/icon) comes from the shared builder so this
 * card is byte-identical to the one the auto-director renders for the same
 * volcano (see worker/director/candidates.ts) — same `volcano:{id}` segment id
 * too, so a manually-clicked volcano and an auto-directed cut of it are
 * recognised as the same segment (cooldown/dedup, "last shown" readout).
 */
export function volcanoToSegment(v: Volcano): Segment {
  const c = volcanoSegmentContent(v);
  return {
    id: `volcano:${v.id}`,
    kind: "volcano",
    title: c.title,
    subtitle: c.subtitle,
    icon: c.icon,
    details: c.details,
    // Reuses the notable-tracks TrackInfo card for the photo/blurb, plus the
    // richer facts/gallery/USGS-alert fields — see volcanoTrackInfo for the
    // single shared builder (also used by the auto-director).
    trackInfo: volcanoTrackInfo(v),
    camera: { center: [v.lng, v.lat], zoom: VOLCANO_ZOOM },
    patch: {},
    holdMs: 0,
  };
}
