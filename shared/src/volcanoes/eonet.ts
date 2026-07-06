import type { Volcano, VolcanoStatus } from "./types";

/**
 * NASA EONET (Earth Observatory Natural Event Tracker) "volcanoes" category —
 * near-real-time eruption/activity reports, worldwide, no key required:
 *   https://eonet.gsfc.nasa.gov/api/v3/categories/volcanoes?status=open
 * We ask for `status=open` only — EONET's own notion of "still active" — so the
 * worker's cache is naturally just the currently-active set; an event that
 * closes (or simply stops being reported) ages out of Mongo via the TTL on
 * `fetchedAt` instead of needing a full-replace sync.
 */
export const EONET_API_BASE = process.env.EONET_API_BASE || "https://eonet.gsfc.nasa.gov/api/v3";

/** A report within this window of "now" reads as actively "erupting". */
export const VOLCANO_RECENT_MS = 14 * 24 * 60 * 60 * 1000;

function statusFor(lastDateMs: number, nowMs: number): VolcanoStatus {
  return nowMs - lastDateMs <= VOLCANO_RECENT_MS ? "erupting" : "unrest";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EonetEvent = any;

/**
 * Parse an EONET `categories/volcanoes` response into `Volcano[]`, classifying
 * each event's status from the gap between `nowMs` and its most recent report.
 * Events with no usable point geometry are skipped.
 */
export function parseEonetVolcanoes(json: unknown, nowMs: number): Volcano[] {
  const events: EonetEvent[] = Array.isArray((json as { events?: unknown })?.events)
    ? (json as { events: EonetEvent[] }).events
    : [];

  const out: Volcano[] = [];
  for (const e of events) {
    const geoms = Array.isArray(e?.geometry) ? e.geometry : [];
    if (!geoms.length) continue;
    const last = geoms[geoms.length - 1];
    const [lng, lat] = Array.isArray(last?.coordinates) ? last.coordinates : [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const firstDate = Date.parse(geoms[0]?.date ?? "");
    const lastDate = Date.parse(last?.date ?? "");
    const lastMs = Number.isFinite(lastDate) ? lastDate : nowMs;

    out.push({
      id: String(e.id ?? ""),
      name: String(e.title ?? "").replace(/\s+/g, " ").trim(),
      lat: Number(lat),
      lng: Number(lng),
      status: statusFor(lastMs, nowMs),
      firstDate: Number.isFinite(firstDate) ? firstDate : lastMs,
      lastDate: lastMs,
      sourceUrl: e.sources?.[0]?.url,
    });
  }
  return out.filter((v) => v.id && v.name);
}

/**
 * Fetch + parse the currently-active volcano feed for the whole globe.
 */
export async function fetchVolcanoes(fetchImpl: typeof fetch = fetch): Promise<{ volcanoes: Volcano[] }> {
  const url = `${EONET_API_BASE}/categories/volcanoes?status=open`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`eonet volcanoes ${res.status}`);
  const json = await res.json();
  return { volcanoes: parseEonetVolcanoes(json, Date.now()) };
}
