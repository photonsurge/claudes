/**
 * Catalog of the bottom-crawl ("GLOBAL FEED") content kinds — the single source
 * of truth for the /watch feed assembly (BroadcastFrame) and the per-channel
 * admin form. Curating the crawl is part of how one globe becomes several
 * themed channels: a seismic channel's crawl carries quakes + volcanoes, a
 * weather channel's carries alerts, and so on.
 *
 * Visibility is stored per channel as `ControlState.tickerKindsOff` — an
 * OFF-list (empty = show everything), mirroring `reportKindsOff`. New kinds
 * added here default to visible on every existing channel with no migration.
 * Kind ids reuse the ReportKind vocabulary where the categories overlap.
 */

/** Stable id for one crawl content kind (never renamed — it persists). */
export type TickerKind = "quake" | "alert" | "volcano" | "track" | "ad";

export const TICKER_KINDS: { id: TickerKind; label: string; hint: string }[] = [
  { id: "quake", label: "Earthquakes", hint: "Live seismic events (~24h window)" },
  { id: "alert", label: "Weather alerts", hint: "Active warnings, de-duped by area, flagged by nearest city" },
  { id: "volcano", label: "Volcanoes", hint: "Erupting / unrest volcanoes (dormant never shown)" },
  { id: "track", label: "Aircraft & ships", hint: "Tracked craft in the live feed" },
  { id: "ad", label: "Sponsor mentions", hint: "“Sponsored by …” AD lines woven through the loop" },
];

/** All ticker kind ids, in catalog order. */
export const TICKER_KIND_IDS: readonly TickerKind[] = TICKER_KINDS.map((k) => k.id);

const TICKER_KIND_SET: ReadonlySet<string> = new Set(TICKER_KIND_IDS);

/** Narrow an untrusted value (socket/HTTP) to a known ticker kind. */
export function isTickerKind(value: unknown): value is TickerKind {
  return typeof value === "string" && TICKER_KIND_SET.has(value);
}
