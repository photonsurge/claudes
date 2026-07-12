import { createHash } from "crypto";
import type { iAlert, SeverityRank } from "../db/alert-model";
import { alertContentHash } from "./content-hash";
import { polygonAreaKm2 } from "../geo/polygon";

/**
 * Pure change-detection between two versions of the same alert — the heart of
 * the alert-timeline feature. WMO/GDACS re-poll the same `(source, identifier)`
 * and OVERWRITE the doc in place, so without diffing against the prior version
 * every update is invisible. `diffAlert` compares the persisted `prev` against
 * the freshly-normalised `next` and emits the meaningful changes (and nothing on
 * a no-op re-poll, so steady-state polling writes zero revisions).
 *
 * `ENDED` and `ISSUED` are deliberately NOT emitted here — they're synthesised
 * on read in timeline.ts from `active`/`expiresAt`/`sent`, so the per-tick expiry
 * sweep over hundreds of alerts writes nothing.
 */

export type AlertChangeType =
  | "SEVERITY_CHANGED"
  | "AREA_CHANGED"
  | "TEXT_CHANGED"
  | "INSTRUCTION_CHANGED"
  | "START_TIME_CHANGED"
  | "EXPIRY_CHANGED"
  | "CANCELLED";

export interface AlertChange {
  type: AlertChangeType;
  /** Prior value, as a display string (rank number, km², or ISO time). */
  from?: string;
  /** New value, same encoding as `from`. */
  to?: string;
}

export interface AlertDiff {
  events: AlertChange[];
  /** Total area of `next` in km² (0 for geocode-only alerts). */
  areaKm2: number;
  /** `next`'s denormalised severity, carried through for the revision snapshot. */
  severity: SeverityRank;
}

/** The subset diffAlert reads — satisfied by both a normalised iAlert and a lean doc. */
export type DiffableAlert = Pick<iAlert, "msgType" | "status" | "maxSeverityRank" | "expiresAt" | "info">;

/** AREA_CHANGED needs a real area move, not sub-1% vertex jitter feeds re-emit each poll. */
const AREA_JITTER_FRAC = 0.01;

/** The bulletin text lives on the primary info entry (index 0), like the admin view. */
const primaryInfo = (a: DiffableAlert) => a.info?.[0];

/** Start instant = onset, falling back to effective; epoch ms or null. */
function startInstant(a: DiffableAlert): number | null {
  const inf = primaryInfo(a);
  const s = inf?.onset ?? inf?.effective;
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function instant(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Total polygon area (km²) summed across every area geometry of the alert. */
function totalAreaKm2(a: DiffableAlert): number {
  let total = 0;
  for (const inf of a.info ?? []) {
    for (const ar of inf.area ?? []) total += polygonAreaKm2(ar.geometry);
  }
  return total;
}

/**
 * Order-independent hash of an alert's geometry, positions rounded to ~4dp
 * (~11 m) so sub-vertex feed jitter doesn't register. Combined with the area
 * floor below, this is the AREA_CHANGED signal.
 */
function geometryHash(a: DiffableAlert): string {
  const positions: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number" && typeof node[1] === "number") {
      positions.push(`${(node[0] as number).toFixed(4)},${(node[1] as number).toFixed(4)}`);
      return;
    }
    if (Array.isArray(node)) for (const c of node) walk(c);
  };
  for (const inf of a.info ?? []) {
    for (const ar of inf.area ?? []) if (ar.geometry?.coordinates != null) walk(ar.geometry.coordinates);
  }
  positions.sort();
  return createHash("sha1").update(positions.join("|")).digest("hex");
}

export function diffAlert(prev: DiffableAlert, next: DiffableAlert): AlertDiff {
  const events: AlertChange[] = [];
  const nextArea = totalAreaKm2(next);

  // Severity (denormalised, message-level).
  if (prev.maxSeverityRank !== next.maxSeverityRank) {
    events.push({ type: "SEVERITY_CHANGED", from: String(prev.maxSeverityRank), to: String(next.maxSeverityRank) });
  }

  // Bulletin text — compare SOURCE text only (never translated*), so a translate
  // job writing back cached translations never registers as a change.
  const pi = primaryInfo(prev);
  const ni = primaryInfo(next);
  const textPrev = alertContentHash(pi?.headline ?? "", pi?.description ?? "", "");
  const textNext = alertContentHash(ni?.headline ?? "", ni?.description ?? "", "");
  if (textPrev !== textNext) {
    events.push({ type: "TEXT_CHANGED", from: pi?.headline ?? "", to: ni?.headline ?? "" });
  }
  const instrPrev = alertContentHash("", "", pi?.instruction ?? "");
  const instrNext = alertContentHash("", "", ni?.instruction ?? "");
  if (instrPrev !== instrNext) {
    events.push({ type: "INSTRUCTION_CHANGED" });
  }

  // Start time (onset ?? effective).
  const sPrev = startInstant(prev);
  const sNext = startInstant(next);
  if (sPrev !== sNext) {
    events.push({
      type: "START_TIME_CHANGED",
      from: pi?.onset ?? pi?.effective,
      to: ni?.onset ?? ni?.effective,
    });
  }

  // Expiry (message-level, UTC-normalised).
  const ePrev = instant(prev.expiresAt);
  const eNext = instant(next.expiresAt);
  if (ePrev !== eNext) {
    events.push({ type: "EXPIRY_CHANGED", from: prev.expiresAt, to: next.expiresAt });
  }

  // Area — geometry actually changed AND the area moved beyond jitter.
  if (geometryHash(prev) !== geometryHash(next)) {
    const prevArea = totalAreaKm2(prev);
    const bigger = Math.max(prevArea, nextArea);
    const jitter = bigger > 0 && Math.abs(nextArea - prevArea) / bigger < AREA_JITTER_FRAC;
    if (!jitter) {
      events.push({ type: "AREA_CHANGED", from: String(Math.round(prevArea)), to: String(Math.round(nextArea)) });
    }
  }

  // Explicit issuer withdrawal — distinct from a natural expiry (which is ENDED,
  // synthesised on read).
  if (next.msgType === "Cancel" && prev.msgType !== "Cancel") {
    events.push({ type: "CANCELLED" });
  }

  return { events, areaKm2: nextArea, severity: next.maxSeverityRank };
}
