import type { SeverityRank, iAlert, iAlertInfo } from "../db/alert-model";
import type { CapMessage } from "./types";
import { collapseToEnglish } from "./language";

/**
 * The lifecycle/derived layer shared by every adapter (spec §5). Given parsed
 * CAP messages, produce canonical alerts with `active`, `maxSeverityRank` and a
 * UTC-normalised `expiresAt` — so the cross-source behaviour (active-now, expiry
 * sweep, severity sort) is computed in exactly one place.
 */

/** Parse an ISO timestamp (possibly with a TZ offset) to epoch ms, or null. */
function epoch(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Is this message a currently-active alert? Cancelled/expired/non-Actual
 * messages are kept for history but flagged inactive.
 */
export function isActive(
  msgType: string,
  status: string,
  expiresIso: string | undefined,
  now: Date,
): boolean {
  if (status !== "Actual") return false;
  if (msgType === "Cancel" || msgType === "Error" || msgType === "Ack") return false;
  const exp = epoch(expiresIso);
  if (exp !== null && exp <= now.getTime()) return false;
  return true;
}

/** Earliest `info.expires` across the message, normalised to UTC ISO (or undefined). */
export function earliestExpiry(info: iAlertInfo[] | CapMessage["info"]): string | undefined {
  let min: number | null = null;
  for (const i of info) {
    const t = epoch(i.expires);
    if (t !== null && (min === null || t < min)) min = t;
  }
  return min === null ? undefined : new Date(min).toISOString();
}

/** One parsed CAP message → one canonical alert. */
export function canonicaliseCapMessage(msg: CapMessage, now: Date): iAlert {
  // Drop national-language duplicates when an English edition is present — the
  // display is positional (info[0]) and English-only, so the dupes are never
  // shown and would only cost an LLM translation. No-op for single-block alerts.
  const info = collapseToEnglish(msg.info);
  const maxSeverityRank = info.reduce<SeverityRank>(
    (m, i) => (i.severityRank > m ? i.severityRank : m),
    0,
  );
  const expiresAt = earliestExpiry(info);

  return {
    source: msg.source,
    identifier: msg.identifier,
    sender: msg.sender,
    sent: msg.sent,
    msgType: msg.msgType,
    status: msg.status,
    scope: msg.scope,
    references: msg.references ?? [],
    info: info.map((i) => ({
      ...i,
      category: i.category ?? [],
      area: i.area ?? [],
    })),
    ingestedAt: now.toISOString(),
    active: isActive(msg.msgType, msg.status, expiresAt, now),
    maxSeverityRank,
    expiresAt,
    raw: msg.raw,
  };
}

export function canonicaliseCapMessages(msgs: CapMessage[], now: Date = new Date()): iAlert[] {
  return msgs.map((m) => canonicaliseCapMessage(m, now));
}

/** The identifier of each referenced ("sender,identifier,sent") message. */
export function referencedIdentifiers(references: string[]): string[] {
  return references
    .map((r) => r.split(",")[1]?.trim())
    .filter((id): id is string => !!id);
}
