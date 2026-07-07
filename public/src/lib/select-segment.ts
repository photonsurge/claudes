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

const VOLCANO_STATUS_SUBTITLE: Record<Volcano["status"], string> = {
  erupting: "Active eruption",
  unrest: "Volcanic unrest",
  dormant: "Easing off / dormant",
};
const VOLCANO_STATUS_LABEL: Record<Volcano["status"], string> = {
  erupting: "Erupting",
  unrest: "Unrest",
  dormant: "Dormant",
};

/**
 * Reuses the generic `storm`-kind card (title/subtitle/details/icon) rather
 * than a dedicated `SegmentKind` — a volcano's status IS a hazard classification
 * (see HazardType "volcano"), so this rides the same icon/colour the GDACS
 * volcanic-activity alerts already use, just sourced from the Smithsonian/USGS
 * weekly bulletin instead of an alert polygon.
 */
export function volcanoToSegment(v: Volcano): Segment {
  const meta = hazardMeta("volcano");
  const details: { label: string; value: string }[] = [
    { label: "Status", value: VOLCANO_STATUS_LABEL[v.status] },
    { label: "Location", value: `${v.lat.toFixed(3)}, ${v.lng.toFixed(3)}` },
    { label: "This week's report", value: utcLabel(v.lastDate) },
  ];
  if (v.country) details.splice(1, 0, { label: "Country", value: v.country });
  return {
    id: `volcano:${v.id}`,
    kind: "storm",
    title: v.name,
    subtitle: VOLCANO_STATUS_SUBTITLE[v.status],
    icon: meta.icon,
    hazard: "volcano",
    details,
    // Reuses the notable-tracks TrackInfo card for the photo/blurb — its
    // fields (label/category/photoUrl/extract) are generic enough to fit a
    // volcano, not just an aircraft/vessel. Prefers this week's own bulletin
    // text (current, authoritative) over the evergreen Wikipedia extract when
    // both are present; the photo always comes from Wikipedia (the bulletin
    // carries no images). Undefined (not this whole object) until there's
    // something to show.
    trackInfo: v.wikiThumb || v.wikiExtract || v.latestReport
      ? {
          label: v.name,
          category: "Volcano",
          photoUrl: v.wikiThumb,
          extract: v.latestReport || v.wikiExtract,
        }
      : undefined,
    camera: { center: [v.lng, v.lat], zoom: VOLCANO_ZOOM },
    patch: {},
    holdMs: 0,
  };
}
