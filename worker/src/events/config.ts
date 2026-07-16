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
 * Acquisition cadence (seconds) by severity rank — RED tighter than ORANGE.
 *
 * These have to be affordable, and the originals (2/5/15 min) were not. The
 * sweeper's ceiling is tick x batch — 60 ticks/hour x 20 events = 1,200 acquires
 * an hour, full stop — and 1,151 live events at a 5-minute cadence demand 13,812.
 * Being 11x underwater doesn't poll aggressively, it polls the 20 oldest of a
 * 3,758-deep queue and never reaches the rest, so an event's REAL cadence was
 * however long the backlog took: hours, unbounded, and worst for the newest
 * events. Slower numbers that fit are strictly faster than fast numbers that
 * don't.
 *
 * At 30 minutes, ~1,151 mostly-orange events demand ~2,302/hour against a
 * capacity of 3,000 (batch 50) — it drains, with headroom, and RED stays tight
 * because there are only a handful of them.
 *
 * The knob to reach for when this is short is the BATCH, not the tick: a longer
 * tick lowers the ceiling, and nothing else here does.
 */
export function cadenceForRank(rank: number): number {
  if (rank >= 4) return Number(process.env.EVENT_CADENCE_RED_SEC || 300);
  if (rank >= 3) return Number(process.env.EVENT_CADENCE_ORANGE_SEC || 1800);
  // Sub-orange never promotes (see shouldPromoteAlert), so this only applies to an
  // event that has since been downgraded — check it rarely, it's on its way out.
  return Number(process.env.EVENT_CADENCE_GREEN_SEC || 3600);
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
