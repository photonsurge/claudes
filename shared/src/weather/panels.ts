// weather/panels.ts
// Redis-backed precompute cache for the on-air weather PANELS (point + area
// history) of a catalog entity — a country or region the director spotlights.
//
// WHY: the panels are sampled by decoding weather-grid PNGs back to raw pixels
// (sharp/libvips). Doing that per-request on `public` fanned a single Node
// process across every core and inflated RSS. The worker instead samples every
// entity ONCE per ingest (decode-once-sample-all), writes the finished series
// here, and `public` reads numbers — no request-time decode.
//
// Redis-only + fail-open by design: Mongo stays the source of truth for the
// FRAMES; this is a disposable, TTL-evicted copy of the SAMPLED result. A cold
// or down Redis simply means `public` falls back to composing live (now
// concurrency-capped) until the worker's next tick re-warms it. Reuses the
// BullMQ ioredis connection (same client as focus-cache) — no new dependency.
import { getQueue } from "../bull/bull";
import type { HistorySeries, AreaHistorySeries } from "./history-types";

export type PanelScope = "country" | "region";

/** Rolling history window the panels chart (mirrors the public composer). */
export const HISTORY_WINDOW_HOURS = 72;

/** The variables the on-air history panels actually chart (mirrors the public
 *  composer's breadth-gate). The precompute + the live fallback MUST agree on
 *  this set, so it lives here as the single source. Keep in sync with the
 *  archive's charted layers. */
export const BROADCAST_HISTORY_VARS: readonly string[] = [
  "temp",
  "humidity",
  "wind",
  "gust",
  "rain",
  "storm",
  "pressure",
  "cloud",
  "snow",
  "sst",
  "current",
  "salinity",
  "wave",
];

/** One entity's precomputed panels. `pointHistory`/`areaHistory` are the SAME
 *  shapes the public builders return, so a consumer can use them verbatim. */
export interface WeatherPanel {
  scope: PanelScope;
  entityId: string;
  /** [lng, lat] — the representative sample point. */
  center: [number, number];
  bbox: [number, number, number, number];
  windowHours: number;
  pointHistory: HistorySeries[];
  areaHistory: AreaHistorySeries[];
  /** epoch ms the precompute finished — lets a reader reason about staleness. */
  generatedAt: number;
}

/** Namespaced `panel:v1:` so the whole cache busts by bumping the version when
 *  the WeatherPanel shape changes. */
export function weatherPanelKey(scope: string, id: string): string {
  return `panel:v1:${scope}:${id}`;
}

async function client() {
  return getQueue().client;
}

/** Read one entity's precomputed panels; null on miss OR any Redis error. */
export async function getWeatherPanel(scope: string, id: string): Promise<WeatherPanel | null> {
  try {
    const raw = await (await client()).get(weatherPanelKey(scope, id));
    return raw ? (JSON.parse(raw) as WeatherPanel) : null;
  } catch {
    return null; // fail-open — caller composes live
  }
}

/** Write one entity's panels with a TTL. No-op on any Redis error (fail-open). */
export async function setWeatherPanel(panel: WeatherPanel, ttlSec: number): Promise<void> {
  try {
    await (await client()).set(
      weatherPanelKey(panel.scope, panel.entityId),
      JSON.stringify(panel),
      "EX",
      ttlSec,
    );
  } catch {
    /* fail-open — the live path still serves this entity */
  }
}
