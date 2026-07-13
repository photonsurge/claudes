import { createHash } from "crypto";
import type { Volcano } from "./types";

/**
 * Pure status change-detection between two versions of the same volcano — the
 * heart of the volcano-timeline feature and the exact analogue of
 * `shared/src/alerts/diff.ts` for alerts. The weekly GVP bulletin (and the USGS
 * VONA poll) re-report the same `volcanoId` and OVERWRITE the doc in place, so
 * without diffing against the prior version every status change is invisible.
 * `diffVolcanoStatus` compares the persisted `prev` against the freshly-fetched
 * `next` and emits the meaningful changes (and nothing on an unchanged re-poll,
 * so steady-state polling writes zero timeline beats).
 *
 * `ISSUED`/`ENDED` are deliberately NOT emitted here — the ingest hook synthesises
 * ISSUED on first promotion (`created`), and ENDED is synthesised on read by
 * `buildEventTimeline` from the volcano lapsing out of the bulletin's TTL.
 *
 * Raw values are preserved verbatim (never coerced to a single scheme) and each
 * change carries the `scheme` that moved — national alert systems are NOT
 * equivalent, so the UI shows the official raw level; the normalised value
 * (`normalizeVolcanoStatus`) is only for scoring/filtering.
 */

export type VolcanoChangeType =
  | "ALERT_LEVEL_CHANGED"
  | "AVIATION_COLOR_CHANGED"
  | "ACTIVITY_CHANGED"
  | "VEI_CHANGED"
  | "PLUME_CHANGED";

export interface VolcanoChange {
  type: VolcanoChangeType;
  /** Prior value, as a display string (raw level/colour, VEI, or metres). */
  from?: string;
  /** New value, same encoding as `from`. */
  to?: string;
  /** Which official scheme moved (preserved raw — never normalised away). */
  scheme?: string;
}

/** The subset diffVolcanoStatus reads — satisfied by the domain Volcano shape and lean docs. */
export type DiffableVolcano = Pick<
  Volcano,
  | "status"
  | "usgsAlertLevel"
  | "usgsColorCode"
  | "officialAlertScheme"
  | "officialAlertLevelRaw"
  | "reportVei"
  | "reportPlumeHeightM"
  | "latestReport"
>;

/** Normalised level — for scoring/filtering ONLY; the raw value is what the UI shows. */
export type NormalizedVolcanoLevel =
  | "normal"
  | "advisory"
  | "watch"
  | "warning"
  | "unrest"
  | "eruption"
  | "unknown";

const textHash = (s: string): string => createHash("sha1").update(s).digest("hex");

/**
 * Emit the meaningful status changes between two versions of one volcano.
 * `prev` undefined = first-seen (nothing to compare) → `[]`; the ISSUED beat is
 * synthesised by the ingest hook on first promotion, not here.
 */
export function diffVolcanoStatus(prev: DiffableVolcano | undefined, next: DiffableVolcano): VolcanoChange[] {
  if (!prev) return [];
  const events: VolcanoChange[] = [];

  // GVP-derived activity level (always present) — the coarse erupting/unrest/dormant scheme.
  if (prev.status !== next.status) {
    events.push({ type: "ALERT_LEVEL_CHANGED", scheme: "GVP", from: prev.status, to: next.status });
  }

  // USGS VONA numeric-word alert level (US-monitored subset) — a distinct official
  // scheme that can move independently of the weekly GVP status, so it's its own beat.
  if ((prev.usgsAlertLevel ?? "") !== (next.usgsAlertLevel ?? "") && next.usgsAlertLevel) {
    events.push({
      type: "ALERT_LEVEL_CHANGED",
      scheme: "USGS_VOLCANO_ALERT_LEVEL",
      from: prev.usgsAlertLevel,
      to: next.usgsAlertLevel,
    });
  }

  // Aviation colour code (ICAO green/yellow/orange/red).
  if ((prev.usgsColorCode ?? "") !== (next.usgsColorCode ?? "") && next.usgsColorCode) {
    events.push({
      type: "AVIATION_COLOR_CHANGED",
      scheme: "USGS_AVIATION",
      from: prev.usgsColorCode,
      to: next.usgsColorCode,
    });
  }

  // Official (non-USGS) observatory alert level, e.g. GeoNet VAL — its own scheme,
  // preserved raw. Official > GVP-weekly, so this is a first-class status beat.
  if ((prev.officialAlertLevelRaw ?? "") !== (next.officialAlertLevelRaw ?? "") && next.officialAlertLevelRaw) {
    events.push({
      type: "ALERT_LEVEL_CHANGED",
      scheme: next.officialAlertScheme ?? "OFFICIAL",
      from: prev.officialAlertLevelRaw,
      to: next.officialAlertLevelRaw,
    });
  }

  // Bulletin text — compare a content hash so a re-published identical report
  // doesn't register; only emit once there's actually text on the new version.
  const reportNext = next.latestReport ?? "";
  if (reportNext && textHash(prev.latestReport ?? "") !== textHash(reportNext)) {
    events.push({ type: "ACTIVITY_CHANGED" });
  }

  // VEI / plume height — only emit when the NEW version carries the fact and it
  // differs (a missing parse this week is a transient gap, not a real decrease).
  if (next.reportVei != null && next.reportVei !== prev.reportVei) {
    events.push({ type: "VEI_CHANGED", from: prev.reportVei?.toString(), to: String(next.reportVei) });
  }
  if (next.reportPlumeHeightM != null && next.reportPlumeHeightM !== prev.reportPlumeHeightM) {
    events.push({
      type: "PLUME_CHANGED",
      from: prev.reportPlumeHeightM?.toString(),
      to: String(next.reportPlumeHeightM),
    });
  }

  return events;
}

/**
 * Map an official raw level to the normalised scale used for scoring/filtering.
 * Unknown schemes/levels fall through to `unknown` — never guessed. Keep the raw
 * value; this is a lossy projection only meant to rank interest across schemes.
 */
export function normalizeVolcanoStatus(input: { scheme: string; raw: string }): NormalizedVolcanoLevel {
  const raw = input.raw.trim().toUpperCase();
  switch (input.scheme) {
    case "USGS_VOLCANO_ALERT_LEVEL":
      if (raw === "NORMAL") return "normal";
      if (raw === "ADVISORY") return "advisory";
      if (raw === "WATCH") return "watch";
      if (raw === "WARNING") return "warning";
      return "unknown";
    case "GVP": // our own erupting/unrest/dormant derivation
      if (raw === "ERUPTING") return "eruption";
      if (raw === "UNREST") return "unrest";
      if (raw === "DORMANT") return "normal";
      return "unknown";
    case "GEONET_VAL": // 0 no unrest … 5 major eruption
      if (raw === "0") return "normal";
      if (raw === "1") return "advisory";
      if (raw === "2") return "unrest";
      if (raw === "3" || raw === "4" || raw === "5") return "eruption";
      return "unknown";
    default:
      return "unknown";
  }
}
