/**
 * Pure builders that turn a live event (earthquake / severe-weather alert) into
 * the *content* of an operator info-box segment — title, subtitle, hazard icon
 * and the detail rows. Shared so the worker's director candidates and the
 * public click-to-select card render byte-identical cards for the same event.
 *
 * Only the content lives here; the camera/id/hold/patch wrapper stays with each
 * caller (the worker's `make()`, the client's segment builder) since those come
 * from source-specific shapes (Mongo docs vs. API JSON).
 */
import { quakeDepthLabel, quakeMagnitudeLabel } from "./seismic";
import { continentOf } from "./alerts/geo";
import { hazardMeta, type HazardType } from "./alerts/hazard";
import { broadcastEventLabel } from "./alerts/phrasebook";
import { alertCountryLabel } from "./alerts/country";
import type { Volcano, VolcanoStatus } from "./volcanoes/types";
import type { TrackInfo } from "./director";

export interface SegmentContent {
  title: string;
  subtitle?: string;
  /** Emoji shown before the title (hazard glyph for alerts). */
  icon?: string;
  details: { label: string; value: string }[];
}

export interface QuakeContentInput {
  mag: number;
  place?: string;
  depthKm: number;
  /**
   * Event time, epoch ms. Drives the "Ago" (elapsed) + "Occurred" (absolute UTC)
   * rows. "Ago" is safe because these segments are rebuilt each director tick
   * (same as the alert "Active for" row), so the elapsed time stays current.
   */
  timeMs?: number;
  /** "Now" for the elapsed-time row; defaults to Date.now() (testable). */
  nowMs?: number;
  tsunami?: boolean;
}

/** Earthquake card: magnitude headline, depth class, time (ago + absolute) + region. */
export function quakeSegmentContent(q: QuakeContentInput): SegmentContent {
  const subtitle = `M${q.mag.toFixed(1)}${q.place ? ` · ${q.place}` : ""}`;
  const details: SegmentContent["details"] = [
    { label: "Magnitude", value: `M${q.mag.toFixed(1)} · ${quakeMagnitudeLabel(q.mag)}` },
    { label: "Depth", value: `${Math.round(q.depthKm)} km · ${quakeDepthLabel(q.depthKm)}` },
  ];
  if (q.timeMs != null && Number.isFinite(q.timeMs)) {
    const now = q.nowMs ?? Date.now();
    details.push({ label: "Ago", value: agoLabel(Math.max(0, Math.floor((now - q.timeMs) / 60000))) });
    details.push({ label: "Occurred", value: `${new Date(q.timeMs).toISOString().slice(0, 16).replace("T", " ")} UTC` });
  }
  if (q.place) details.push({ label: "Region", value: q.place });
  if (q.tsunami) details.push({ label: "Alert", value: "Tsunami risk" });
  return { title: q.tsunami ? "Earthquake · Tsunami" : "Earthquake", subtitle, details };
}

export interface AlertContentInput {
  source: string;
  identifier: string;
  event?: string;
  /** English translation of `event`/headline (worker/src/alerts/translate.ts) — preferred for display when present, "" or unset for already-English/untranslated alerts. */
  translatedEvent?: string;
  /** Normalised cross-source severity rank (0–4). */
  severityRank: number;
  /** Source-specific severity label (e.g. "Orange", "Extreme"), if any. */
  level?: string;
  areaDesc?: string;
  /**
   * How many warnings this one shape stands for.
   *
   * The globe draws DISSOLVED shapes: touching warnings of the same hazard,
   * severity and country are fused into one weather system, so a shape spanning
   * Galicia to the Basque Country can be a dozen separate yellow rain warnings.
   * `areaDesc` is only the representative member's — naming that shape "Central y
   * Valles Mineros" tells the viewer it's one county when it's the whole north
   * coast. 1 or unset renders exactly as before.
   */
  warningCount?: number;
  hazard: HazardType;
  /** Framing point [lng, lat] — supplies the continental "Area" label. */
  center: [number, number];
  /**
   * When the hazard became active (CAP onset ?? effective ?? sent), epoch ms.
   * Drives the "Active since" (absolute UTC) + "Active for" (duration) rows.
   */
  sinceMs?: number;
  /** "Now" for the active-duration row; defaults to Date.now() (testable). */
  nowMs?: number;
}

/** "3h 12m" / "45m" / "2d 4h" — compact elapsed-time for the "Active for" row. */
function activeForLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** "just now" / "45m ago" / "3h 12m ago" — elapsed since a point-in-time event. */
function agoLabel(mins: number): string {
  return mins < 1 ? "just now" : `${activeForLabel(mins)} ago`;
}

/** Severe-weather card: place + country subtitle, severity/type/source rows.
 *  Both the TITLE and the "Type" row are ours (phrasebook.ts + the hazard
 *  vocabulary) — the source's own `event` string is bulletin jargon in 40
 *  languages and never reaches air. It stays raw in /admin, where provenance
 *  is the point. */
export function alertSegmentContent(a: AlertContentInput): SegmentContent {
  const title = broadcastEventLabel(a);
  const country = alertCountryLabel(a);
  const area = continentOf(a.center[0], a.center[1]);
  // A fused shape must not pass itself off as its representative member's county.
  const more = (a.warningCount ?? 1) - 1;
  const place = a.areaDesc && more > 0 ? `${a.areaDesc} +${more} more` : a.areaDesc;
  const subtitle = [place, country].filter(Boolean).join(" · ") || undefined;
  const details: SegmentContent["details"] = [{ label: "Severity", value: `${a.severityRank}/4` }];
  details.push({ label: "Type", value: hazardMeta(a.hazard).label });
  if (more > 0) details.push({ label: "Warnings", value: String(a.warningCount) });
  if (a.level) details.push({ label: "Level", value: String(a.level) });
  if (country) details.push({ label: "Country", value: country });
  if (area) details.push({ label: "Area", value: area });
  details.push({ label: "Source", value: a.source.toUpperCase() });
  if (a.sinceMs != null && Number.isFinite(a.sinceMs)) {
    const now = a.nowMs ?? Date.now();
    const mins = Math.round((now - a.sinceMs) / 60000);
    const tsRow = `${new Date(a.sinceMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    if (mins < 0) {
      // Onset is still in the future — don't pretend it's been active for 0m.
      details.push({ label: "Begins", value: tsRow });
      details.push({ label: "Begins in", value: activeForLabel(-mins) });
    } else {
      details.push({ label: "Active since", value: tsRow });
      details.push({ label: "Active for", value: activeForLabel(mins) });
    }
  }
  return { title, subtitle, icon: hazardMeta(a.hazard).icon, details };
}

export interface VolcanoContentInput {
  name: string;
  country?: string;
  status: VolcanoStatus;
  lat: number;
  lng: number;
  /** Epoch ms — the current weekly bulletin's publish date. */
  lastDate: number;
  volcanoType?: string;
  elevationM?: number;
}

const VOLCANO_STATUS_SUBTITLE: Record<VolcanoStatus, string> = {
  erupting: "Active eruption",
  unrest: "Volcanic unrest",
  dormant: "Easing off / dormant",
};
const VOLCANO_STATUS_LABEL: Record<VolcanoStatus, string> = {
  erupting: "Erupting",
  unrest: "Unrest",
  dormant: "Dormant",
};

const utcLabel = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Volcano card: status headline, country, and this week's report date — reuses
 *  the "volcano" hazard glyph (see hazard.ts) since a volcano's status IS a
 *  hazard classification, not a dedicated segment kind. */
export function volcanoSegmentContent(v: VolcanoContentInput): SegmentContent {
  const details: SegmentContent["details"] = [{ label: "Status", value: VOLCANO_STATUS_LABEL[v.status] }];
  if (v.country) details.push({ label: "Country", value: v.country });
  if (v.volcanoType) details.push({ label: "Type", value: v.volcanoType });
  if (v.elevationM) details.push({ label: "Elevation", value: `${v.elevationM.toLocaleString()} m` });
  details.push({ label: "Location", value: `${v.lat.toFixed(3)}, ${v.lng.toFixed(3)}` });
  details.push({ label: "This week's report", value: utcLabel(v.lastDate) });
  // The title is just the volcano's name — the subtitle has to place it on the
  // map, so the country rides along when we know it ("Volcanic unrest · Italy").
  const subtitle = [VOLCANO_STATUS_SUBTITLE[v.status], v.country].filter(Boolean).join(" · ");
  return { title: v.name, subtitle, icon: hazardMeta("volcano").icon, details };
}

/**
 * Volcano on-air TrackInfo (photo/blurb + the richer facts/gallery/alert data
 * from wiki+Wikidata+USGS enrichment) — the single source both the manual
 * click path (public/src/lib/select-segment.ts) and the auto-director
 * (worker/src/director/candidates.ts) call, so a manually-clicked volcano and
 * an auto-directed cut of it render byte-identical on-air cards. Undefined
 * (not a mostly-empty object) until there's something worth showing.
 */
export function volcanoTrackInfo(v: Volcano, nowMs = Date.now()): TrackInfo | undefined {
  if (!v.wikiThumb && !v.wikiPhoto && !v.wikiExtract && !v.latestReport) return undefined;

  const facts =
    [
      v.volcanoType,
      v.elevationM ? `${v.elevationM.toLocaleString()} m` : undefined,
      v.lastEruptionYear ? `last known eruption ${v.lastEruptionYear}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

  const reportFacts =
    [
      v.reportVei !== undefined ? `VEI ${v.reportVei}` : undefined,
      v.reportPlumeHeightM !== undefined ? `plume ${v.reportPlumeHeightM.toLocaleString()} m` : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

  const heldMins = Math.max(0, Math.round((nowMs - v.statusChangedAt) / 60000));
  const statusLine = [
    VOLCANO_STATUS_LABEL[v.status],
    v.reportDateRange ? `report ${v.reportDateRange}` : undefined,
    `status held ${activeForLabel(heldMins)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    label: v.name,
    category: "Volcano",
    // Photo always comes from Wikipedia (the bulletin carries no images); prefer the full-res version.
    photoUrl: v.wikiPhoto || v.wikiThumb,
    // This week's own bulletin text (current, authoritative) wins over the evergreen Wikipedia extract when both are present.
    extract: v.latestReport || v.wikiExtract,
    country: v.country,
    gallery: v.wikiGallery,
    facts,
    alert: v.usgsColorCode
      ? {
          level: v.usgsAlertLevel,
          colorCode: v.usgsColorCode,
          synopsis: v.usgsNoticeSynopsis,
          noticeUrl: v.usgsNoticeUrl,
          updatedAt: v.usgsUpdatedAt,
        }
      : undefined,
    reportFacts,
    statusLine,
    sourceUrl: v.sourceUrl,
  };
}
