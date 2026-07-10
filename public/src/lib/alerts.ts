import { SEVERITY_COLORS, SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { classifyHazard, type HazardType } from "./hazard";
export type { HazardType };

/** Trimmed alert shape the admin list / overlay consume (mirrors CanonicalAlert). */
export interface AlertArea {
  areaDesc: string;
  geometry?: { type: string; coordinates: unknown } | null;
  geocodes: { valueName: string; value: string }[];
}
export interface AlertInfo {
  event: string;
  severity?: string;
  severityRank: SeverityRank;
  headline?: string;
  description?: string;
  instruction?: string;
  /** When the hazard begins / took effect (CAP onset / effective, ISO). */
  onset?: string;
  effective?: string;
  expires?: string;
  web?: string;
  /** Source-specific extras (e.g. MeteoAlarm awareness_type, GDACS eventtype). */
  parameters?: Record<string, string>;
  area: AlertArea[];

  // translation enrichment (worker/src/alerts/translate.ts) — "" until translated,
  // and left "" for already-English source text (see alerts-repo.ts#updateTranslation).
  detectedLanguage?: string;
  translatedHeadline?: string;
  translatedDescription?: string;
  translatedInstruction?: string;
  translatedAt?: string;
}

/** "translated" (non-English source, translated fields present), "english" (source
 *  already English, nothing to translate), or "pending" (not yet processed). */
export function translationStatus(a: Alert): "translated" | "english" | "pending" {
  const info = primaryInfo(a);
  if (!info?.translatedAt) return "pending";
  if (info.translatedHeadline || info.translatedDescription || info.translatedInstruction) return "translated";
  return "english";
}

/** Headline text, preferring the English translation when one exists. */
export const displayHeadline = (info?: AlertInfo): string | undefined => info?.translatedHeadline || info?.headline;
/** Description text, preferring the English translation when one exists. */
export const displayDescription = (info?: AlertInfo): string | undefined =>
  info?.translatedDescription || info?.description;
/** Instruction text, preferring the English translation when one exists. */
export const displayInstruction = (info?: AlertInfo): string | undefined =>
  info?.translatedInstruction || info?.instruction;

/** The cross-source hazard category for an alert (heat/flood/wind/…). */
export function alertHazard(a: Alert): HazardType {
  const info = a.info?.[0];
  return classifyHazard({ event: info?.event, parameters: info?.parameters });
}
export interface Alert {
  id: string;
  source: string;
  identifier: string;
  sender: string;
  sent: string;
  msgType: string;
  status: string;
  active: boolean;
  maxSeverityRank: SeverityRank;
  expiresAt?: string;
  info: AlertInfo[];
  /**
   * Cross-source cluster id (server-assigned: same hazard + overlapping
   * footprint). The cluster's representative has `id === groupId`. Absent when
   * the API didn't group.
   */
  groupId?: string;
  /** All sources that reported this clustered event (server-assigned). */
  groupSources?: string[];
}

export interface ListAlertsOpts {
  activeOnly?: boolean;
  source?: string;
  severityMin?: number;
  limit?: number;
}

export async function listAlerts(opts: ListAlertsOpts = {}): Promise<Alert[]> {
  const q = new URLSearchParams();
  if (opts.activeOnly) q.set("active", "1");
  if (opts.source) q.set("source", opts.source);
  if (typeof opts.severityMin === "number") q.set("severityMin", String(opts.severityMin));
  if (typeof opts.limit === "number") q.set("limit", String(opts.limit));
  const res = await fetch(`/api/alerts?${q.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body?.alerts) ? body.alerts : [];
}

/** Full alert doc as the detail page sees it (list shape + provenance extras). */
export type AlertDoc = Alert & {
  scope?: string;
  references: string[];
  ingestedAt: string;
  raw?: unknown;
};

export interface AlertDetail {
  alert: AlertDoc;
  /** CAP lifecycle chain (referenced + referencing messages), oldest-first. */
  chain: AlertDoc[];
  /** Director as-run entries that aired this alert, newest-first. */
  aired: import("./airlog").AirEntry[];
}

/** One alert in full + its update chain + when it aired. `id` may be the doc
 *  uuid or the composite "source:identifier" key (used by run-timeline links). */
export async function getAlertDetail(id: string): Promise<AlertDetail | null> {
  const res = await fetch(`/api/admin/alerts/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export const severityColor = (rank: SeverityRank): string => SEVERITY_COLORS[rank];
export const severityLabel = (rank: SeverityRank): string => SEVERITY_LABELS[rank];

/** A GeoJSON polygon feature for the map overlay, carrying display props. */
export interface AlertFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: {
    id: string;
    source: string;
    /** Source CAP identifier — decodes the country for the select card. */
    identifier: string;
    event: string;
    severityRank: SeverityRank;
    /** Cross-source hazard category — drives the map badge icon/colour. */
    hazard: HazardType;
    /** This area's description ("Brest Region") — the select-card subtitle lead. */
    areaDesc?: string;
    /** Source-specific severity label ("Orange"/"Extreme"), if the feed gives one. */
    level?: string;
    headline?: string;
    instruction?: string;
    /** English translations (worker/src/alerts/translate.ts) — "" when not yet processed or source is already English. */
    translatedHeadline?: string;
    translatedDescription?: string;
    translatedInstruction?: string;
    /** When the alert was ISSUED (CAP `sent`), ISO — drives the "new alerts only"
     *  recency window on the live panel (see freshAlerts). */
    sent?: string;
    /** When the hazard became active (onset ?? effective ?? sent), ISO. */
    since?: string;
    expires?: string;
    web?: string;
  };
}

/**
 * Flatten alerts to GeoJSON polygon features — one per area that actually has a
 * geometry (geocode-only areas are skipped; they have no polygon to draw).
 */
export function alertsToFeatures(alerts: Alert[]): AlertFeature[] {
  const out: AlertFeature[] = [];
  for (const a of alerts) {
    for (const info of a.info ?? []) {
      for (const area of info.area ?? []) {
        const g = area.geometry;
        if (!g || !(g as { coordinates?: unknown }).coordinates) continue;
        out.push({
          type: "Feature",
          geometry: g as { type: string; coordinates: unknown },
          properties: {
            id: a.id,
            source: a.source,
            identifier: a.identifier,
            event: info.event,
            severityRank: a.maxSeverityRank,
            hazard: classifyHazard({ event: info.event, parameters: info.parameters }),
            areaDesc: area.areaDesc,
            level: info.severity,
            headline: info.headline,
            instruction: info.instruction,
            translatedHeadline: info.translatedHeadline,
            translatedDescription: info.translatedDescription,
            translatedInstruction: info.translatedInstruction,
            sent: a.sent,
            since: info.onset ?? info.effective ?? a.sent,
            expires: a.expiresAt,
            web: info.web,
          },
        });
      }
    }
  }
  return out;
}

/** The first info block, or undefined. */
export const primaryInfo = (a: Alert): AlertInfo | undefined => a.info?.[0];

/** A compact "Cook County, IL +2 more" area summary for a row. */
export function areaSummary(a: Alert): string {
  const areas = a.info?.flatMap((i) => i.area?.map((ar) => ar.areaDesc) ?? []) ?? [];
  const uniq = Array.from(new Set(areas.filter(Boolean)));
  if (uniq.length === 0) return "—";
  if (uniq.length === 1) return uniq[0];
  return `${uniq[0]} +${uniq.length - 1} more`;
}

/** Relative-ish expiry label, e.g. "in 42m" / "expired" / "—". */
export function expiresLabel(a: Alert, now: Date = new Date()): string {
  const exp = a.expiresAt ? Date.parse(a.expiresAt) : NaN;
  if (Number.isNaN(exp)) return "—";
  const mins = Math.round((exp - now.getTime()) / 60000);
  if (mins <= 0) return "expired";
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  return `in ${hrs}h`;
}
