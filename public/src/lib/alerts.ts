import { SEVERITY_COLORS, SEVERITY_LABELS } from "@photonsurge/shared/alerts/severity";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";

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
  expires?: string;
  web?: string;
  area: AlertArea[];
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

export const severityColor = (rank: SeverityRank): string => SEVERITY_COLORS[rank];
export const severityLabel = (rank: SeverityRank): string => SEVERITY_LABELS[rank];

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
