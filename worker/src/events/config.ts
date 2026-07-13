import type { iAlert } from "@photonsurge/shared/db/alert-model";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";

/**
 * Unified-event-layer config + gates (worker side). The whole bridge + watcher is
 * OPT-IN via `EVENTS_UNIFIED_ENABLED=true` so it lands dark: nothing promotes,
 * schedules, or polls external sources until it's switched on.
 */
export const eventsUnifiedEnabled = (): boolean => process.env.EVENTS_UNIFIED_ENABLED === "true";

const PROMOTE_MIN_SEV = Number(process.env.EVENT_PROMOTE_MIN_SEV || 3);

/**
 * Only SIGNIFICANT alerts (severe+) become WatchedEvents — promoting every minor
 * advisory would spawn thousands of watch schedules and hammer external APIs for
 * events no one cross-references. Keeps the cross-source dossier meaningful.
 */
export function shouldPromoteAlert(a: Pick<iAlert, "maxSeverityRank">): boolean {
  return (a.maxSeverityRank ?? 0) >= PROMOTE_MIN_SEV;
}

/**
 * Acquisition cadence (seconds) by severity rank — RED tighter than ORANGE, per
 * the spec's aggressive active-event polling. The watcher can decay this by age.
 */
export function cadenceForRank(rank: number): number {
  if (rank >= 4) return Number(process.env.EVENT_CADENCE_RED_SEC || 120);
  if (rank >= 3) return Number(process.env.EVENT_CADENCE_ORANGE_SEC || 300);
  return Number(process.env.EVENT_CADENCE_GREEN_SEC || 900);
}

const VOLCANO_ALERT_LEVELS = new Set(["WATCH", "WARNING"]);
const VOLCANO_AVIATION = new Set(["ORANGE", "RED"]);

/**
 * Only SIGNIFICANT volcanoes become WatchedEvents. The weekly GVP bulletin only
 * lists volcanoes with recent activity, so this mostly means "not winding down":
 * anything erupting or in unrest, or with a USGS WATCH/WARNING or aviation
 * ORANGE/RED. Dormant/cessation entries don't spawn a dossier.
 */
export function shouldPromoteVolcano(
  v: Pick<Volcano, "status" | "usgsAlertLevel" | "usgsColorCode" | "officialAlertLevelNormalized">,
): boolean {
  if (v.status === "erupting" || v.status === "unrest") return true;
  if (v.usgsAlertLevel && VOLCANO_ALERT_LEVELS.has(v.usgsAlertLevel.toUpperCase())) return true;
  if (v.usgsColorCode && VOLCANO_AVIATION.has(v.usgsColorCode.toUpperCase())) return true;
  // Any official observatory level above background (e.g. GeoNet VAL ≥ 1).
  const off = v.officialAlertLevelNormalized;
  if (off && off !== "normal" && off !== "unknown") return true;
  return false;
}
