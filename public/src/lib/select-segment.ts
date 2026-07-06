/**
 * Turn a clicked map feature (earthquake / severe-weather alert) into a director
 * `Segment` so the operator's manual selection renders in the exact same info
 * box the auto-director shows on air. Reuses the shared content builders, so the
 * card text is byte-identical to a director cut for the same event.
 */
import type { Segment } from "@photonsurge/shared/director";
import { quakeSegmentContent, alertSegmentContent } from "@photonsurge/shared/segments";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { hazardMeta } from "@photonsurge/shared/alerts/hazard";
import type { Quake } from "./tracks/types";
import type { AlertFeature } from "./alerts";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";

/** Frame zooms mirror the director's quake/storm shots (candidates.ts). */
const QUAKE_ZOOM = 5;
const STORM_ZOOM = 4.5;
const VOLCANO_ZOOM = 6;

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
    severityRank: p.severityRank,
    level: p.level,
    areaDesc: p.areaDesc,
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

const utcLabel = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * Reuses the generic `storm`-kind card (title/subtitle/details/icon) rather
 * than a dedicated `SegmentKind` — a volcano's status IS a hazard classification
 * (see HazardType "volcano"), so this rides the same icon/colour the GDACS
 * volcanic-activity alerts already use, just sourced from the EONET point feed
 * instead of an alert polygon.
 */
export function volcanoToSegment(v: Volcano): Segment {
  const meta = hazardMeta("volcano");
  const details: { label: string; value: string }[] = [
    { label: "Status", value: v.status === "erupting" ? "Erupting" : "Volcanic unrest" },
    { label: "First reported", value: utcLabel(v.firstDate) },
    { label: "Last update", value: utcLabel(v.lastDate) },
  ];
  return {
    id: `volcano:${v.id}`,
    kind: "storm",
    title: v.name,
    subtitle: v.status === "erupting" ? "Active eruption" : "Ongoing unrest",
    icon: meta.icon,
    hazard: "volcano",
    details,
    camera: { center: [v.lng, v.lat], zoom: VOLCANO_ZOOM },
    patch: {},
    holdMs: 0,
  };
}
