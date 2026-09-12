/**
 * Catalog of the optional on-air chrome widgets — the single source of truth for
 * both the `/watch` renderer (BroadcastFrame) and the per-channel admin form.
 *
 * Visibility is stored per channel as `ControlState.widgetsOff` — an OFF-list
 * (empty = show everything), mirroring `alertHazardsOff`. New widgets added here
 * default to visible on every existing channel with no migration. Grouped by
 * screen zone so the admin form and the frame agree on where each thing lives.
 */

/** Where a widget is anchored on the broadcast frame. */
export type WidgetZone =
  | "top-right"
  | "gauges"
  | "top-center"
  | "top-left"
  | "bottom-left"
  | "bottom-right"
  | "bottom-edge";

/** Stable id for one toggleable chrome widget (never renamed — it persists). */
export type WidgetId =
  | "worldReport"
  | "liveAlerts"
  | "alertSlot"
  | "seismic"
  | "weatherMonitors"
  | "tsunami"
  | "leftDeck"
  | "billboard"
  | "intensityMeter"
  | "spaceWeather"
  | "brand"
  | "kpIndex"
  | "syslog"
  | "buildInfo"
  | "ticker";

export interface BroadcastWidget {
  id: WidgetId;
  /** Screen zone this widget lives in. */
  zone: WidgetZone;
  /** Short human label for the admin form. */
  label: string;
  /** One-line hint describing what it shows. */
  hint: string;
}

/**
 * Every toggleable widget, in a sensible admin-form order (the two operator
 * priorities — the top-right situation stack and the gauge row — lead).
 */
export const BROADCAST_WIDGETS: readonly BroadcastWidget[] = [
  // Top-right — whole-planet situation summary.
  { id: "worldReport", zone: "top-right", label: "World Report", hint: "Hourly whole-planet situation deck" },
  { id: "liveAlerts", zone: "top-right", label: "New alerts", hint: "Just-issued warnings panel" },
  // Shares its name with the ad placement + exposure surface (the worker's
  // sweep keys the per-channel gate on it). Rides INSIDE the New alerts panel.
  { id: "alertSlot", zone: "top-right", label: "Alert-slot sponsors", hint: "Sponsor cards mixed into the New alerts rotation" },
  // Gauges — the bottom-centre instrument row.
  { id: "seismic", zone: "gauges", label: "Seismic monitor", hint: "Recent quakes + live station traces" },
  { id: "weatherMonitors", zone: "gauges", label: "Weather monitors", hint: "Wind / pressure / wave cards" },
  { id: "tsunami", zone: "gauges", label: "Tsunami & tide gauges", hint: "Sea-level gauges near the shot" },
  // Bottom-left — the rotating on-air context card + the sponsor corner.
  { id: "leftDeck", zone: "bottom-left", label: "Left card deck", hint: "Rotating now-viewing / weather / event card" },
  { id: "billboard", zone: "bottom-left", label: "Sponsor billboard", hint: "Rotating sponsor creative in the corner" },
  // Top-centre — on-air colour legends.
  { id: "intensityMeter", zone: "top-center", label: "Variable legend", hint: "Active scalar-variable colour scale" },
  { id: "spaceWeather", zone: "top-center", label: "Space-weather key", hint: "Aurora / magnetic-field legend" },
  // Top-left — identity + geomagnetic readout.
  { id: "brand", zone: "top-left", label: "Brand / LIVE", hint: "Channel identity + on-air light" },
  { id: "kpIndex", zone: "top-left", label: "Kp index", hint: "Geomagnetic activity readout (with aurora)" },
  // Bottom-right — operator / telemetry feeds. (The locator planet now lives
  // inside the brand banner's globe, riding the "brand" toggle.)
  { id: "syslog", zone: "bottom-right", label: "Syslog", hint: "Live system-event ticker" },
  { id: "buildInfo", zone: "bottom-right", label: "Build stamp", hint: "Version / build tag" },
  // Bottom edge — the GLOBAL FEED crawl (its CONTENT is curated separately,
  // see broadcast-ticker.ts / the Bottom crawl admin card).
  { id: "ticker", zone: "bottom-edge", label: "Bottom crawl", hint: "GLOBAL FEED live crawl band" },
];

/** Display labels for each zone, in admin-form order. */
export const WIDGET_ZONE_LABELS: Record<WidgetZone, string> = {
  "top-right": "Top-right stack",
  gauges: "Gauges (bottom)",
  "top-center": "Top-centre legends",
  "top-left": "Top-left",
  "bottom-left": "Bottom-left card",
  "bottom-right": "Bottom-right feeds",
  "bottom-edge": "Bottom crawl",
};

/** Zone render order for the admin form. */
export const WIDGET_ZONE_ORDER: readonly WidgetZone[] = [
  "top-right",
  "gauges",
  "top-center",
  "top-left",
  "bottom-left",
  "bottom-right",
  "bottom-edge",
];

/** All widget ids, in catalog order. */
export const WIDGET_IDS: readonly WidgetId[] = BROADCAST_WIDGETS.map((w) => w.id);

const WIDGET_ID_SET: ReadonlySet<string> = new Set(WIDGET_IDS);

/** Narrow an untrusted value (socket/HTTP) to a known widget id. */
export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && WIDGET_ID_SET.has(value);
}
