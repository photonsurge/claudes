import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import { hasRealLocation } from "../components/broadcast/kinds";
import { hasMonitorSamples, type HistorySeries } from "./history-client";

/** Segment kinds that already carry their own globe marker (quake epicentre,
 *  storm pulse, volcano icon, aircraft/ship highlight ring) — stacking a
 *  second weather-point pin on top of one of those would be redundant. */
const KINDS_WITH_OWN_MARKER = new Set<SegmentKind>(["quake", "storm", "volcano", "flight", "ship"]);

/**
 * The on-air point the WIND/PRESSURE/WAVE "LOCAL MONITOR" cards are reading,
 * as a globe marker + label — or null to hide it. Requires a real, named
 * segment location with no marker of its own, and at least one monitor
 * variable with enough archived samples to draw (mirrors WeatherMonitors'
 * own self-hide rule, so the globe marker and the HUD cards always agree).
 */
export function selectWeatherPoint(
  segment: Segment | null,
  series: HistorySeries[],
): { center: [number, number]; label: string } | null {
  if (!segment) return null;
  if (!hasRealLocation(segment.kind)) return null;
  if (KINDS_WITH_OWN_MARKER.has(segment.kind)) return null;
  if (!hasMonitorSamples(series)) return null;
  return { center: segment.camera.center, label: segment.title };
}
