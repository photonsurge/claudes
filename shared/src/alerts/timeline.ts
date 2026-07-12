import type { AlertMsgType, SeverityRank, iAlertModel } from "../db/alert-model";
import type { AlertChange, AlertChangeType } from "./diff";
import type { iAlertRevision } from "../db/alert-revision-model";
import { SEVERITY_LABELS } from "./severity";

/**
 * The DERIVED alert timeline — the single source both the admin detail page and
 * the on-air slide render, so they can never disagree. It merges two histories
 * that never overlap for a given alert:
 *   • CAP `references` chain (NWS/MeteoAlarm) — each update is a new message.
 *   • in-place revisions (WMO/GDACS) — each meaningful change is an AlertRevision.
 * plus synthesised head (ISSUED) and tail (ENDED) beats. Nothing here is stored.
 */

export type AlertTimelineBeatType = "ISSUED" | "UPDATED" | AlertChangeType | "ENDED";

export interface AlertTimelineBeat {
  /** ISO instant of the beat. */
  at: string;
  type: AlertTimelineBeatType;
  /** Human, presentation-ready label ("Severity raised to Severe", "Warning ended"). */
  label: string;
  severityRank?: SeverityRank;
  areaKm2?: number;
  msgType?: string;
  /** For chain beats: the id of the message this beat represents. */
  refAlertId?: string;
}

type TimelineAlert = Pick<
  iAlertModel,
  "source" | "identifier" | "sent" | "active" | "expiresAt" | "maxSeverityRank" | "msgType"
>;
type ChainMsg = Pick<iAlertModel, "id" | "sent" | "msgType" | "maxSeverityRank">;

const fmtKm2 = (n: number): string => `${Math.round(n).toLocaleString("en-US")} km²`;

/** Human label for one change event. */
function labelFor(change: AlertChange): string {
  switch (change.type) {
    case "SEVERITY_CHANGED": {
      const from = Number(change.from);
      const to = Number(change.to) as SeverityRank;
      const dir = to > from ? "raised" : "lowered";
      return `Severity ${dir} to ${SEVERITY_LABELS[to] ?? change.to}`;
    }
    case "AREA_CHANGED": {
      const from = Number(change.from);
      const to = Number(change.to);
      const dir = to >= from ? "expanded" : "reduced";
      const pct = from > 0 ? Math.round(((to - from) / from) * 100) : null;
      const pctStr = pct != null ? ` (${pct >= 0 ? "+" : ""}${pct}%)` : "";
      return `Area ${dir} to ${fmtKm2(to)}${pctStr}`;
    }
    case "TEXT_CHANGED":
      return "Bulletin text updated";
    case "INSTRUCTION_CHANGED":
      return "Guidance updated";
    case "START_TIME_CHANGED":
      return "Start time changed";
    case "EXPIRY_CHANGED": {
      const from = change.from ? Date.parse(change.from) : NaN;
      const to = change.to ? Date.parse(change.to) : NaN;
      if (!Number.isNaN(from) && !Number.isNaN(to)) {
        return to > from ? "Warning extended" : "Warning shortened";
      }
      return "Expiry updated";
    }
    case "CANCELLED":
      return "Cancelled by issuer";
    default:
      return "Updated";
  }
}

const beatTypeForMsg = (msgType: AlertMsgType): AlertTimelineBeatType =>
  msgType === "Cancel" ? "CANCELLED" : "UPDATED";

/**
 * Build the ordered (oldest→newest) beats for one alert.
 *
 * @param alert    the focal alert (its dedup key, lifecycle + current severity)
 * @param chain    db.alerts.chain(source, identifier) — oldest-first, incl. focal
 * @param revisions db.alertRevisions.listForAlert(...) — oldest-first
 */
export function buildTimeline(
  alert: TimelineAlert,
  chain: ChainMsg[],
  revisions: iAlertRevision[],
  now: Date = new Date(),
): AlertTimelineBeat[] {
  const beats: AlertTimelineBeat[] = [];

  // Severity at issue = the `from` of the first severity change (if any), else the
  // constant current severity.
  let issuedSeverity: SeverityRank = alert.maxSeverityRank;
  for (const rev of revisions) {
    const sc = rev.changes.find((c) => c.type === "SEVERITY_CHANGED");
    if (sc?.from != null) {
      issuedSeverity = Number(sc.from) as SeverityRank;
      break;
    }
  }

  // Head: ISSUED. Prefer the earliest chain message (the original bulletin).
  const hasChain = chain.length > 1;
  const issue = hasChain ? chain[0] : null;
  beats.push({
    at: issue?.sent || alert.sent,
    type: "ISSUED",
    label: "Warning issued",
    severityRank: issue?.maxSeverityRank ?? issuedSeverity,
    msgType: issue?.msgType ?? alert.msgType,
  });

  // CAP-references chain beats (everything after the original bulletin).
  if (hasChain) {
    for (let i = 1; i < chain.length; i++) {
      const c = chain[i];
      const type = beatTypeForMsg(c.msgType);
      beats.push({
        at: c.sent,
        type,
        label: type === "CANCELLED" ? "Cancelled by issuer" : "Warning updated",
        severityRank: c.maxSeverityRank,
        msgType: c.msgType,
        refAlertId: c.id,
      });
    }
  }

  // In-place revision beats — one per change so "severity" and "area" read as
  // distinct timeline rows (matching the spec's example).
  for (const rev of revisions) {
    for (const change of rev.changes) {
      beats.push({
        at: rev.at,
        type: change.type,
        label: labelFor(change),
        severityRank: change.type === "SEVERITY_CHANGED" ? rev.severityRank : undefined,
        areaKm2: change.type === "AREA_CHANGED" ? rev.areaKm2 : undefined,
        msgType: rev.msgType,
      });
    }
  }

  // Tail: ENDED — a NATURAL lapse only. If the issuer explicitly cancelled, the
  // CANCELLED beat already tells the story. Synthesised, never stored.
  const cancelled = beats.some((b) => b.type === "CANCELLED");
  const expInstant = alert.expiresAt ? Date.parse(alert.expiresAt) : NaN;
  const lapsed = !Number.isNaN(expInstant) && expInstant < now.getTime();
  if (!alert.active && !cancelled && lapsed) {
    beats.push({ at: alert.expiresAt as string, type: "ENDED", label: "Warning ended" });
  }

  // Oldest → newest (stable for equal instants).
  return beats.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The most-recent `n` beats (newest last), for the space-limited on-air slide. */
export function latestBeats(beats: AlertTimelineBeat[], n: number): AlertTimelineBeat[] {
  return n > 0 && beats.length > n ? beats.slice(beats.length - n) : beats;
}
