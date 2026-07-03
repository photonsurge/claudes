import type { NotableKind } from "../db/notable-track-model";

/**
 * Curated starter list for the notable-tracks catalog. Deliberately small — this
 * is a *seed*, not a database; the operator grows it from /admin as new craft are
 * spotted. Each entry needs a `wikiTitle` (that's what free enrichment reads for
 * the photo + blurb) and, to match a LIVE track, a real transmitting id:
 *   • ships   → MMSI (verified against public AIS registries).
 *   • aircraft → ICAO24 hex. Government/military hexes are unreliable (rotated or
 *     filtered on public ADS-B), so they ship `enabled: false` with a VERIFY note
 *     until the operator confirms the currently-transmitting hex — a wrong hex
 *     would mislabel a random airliner, so we never enable an unverified one.
 *
 * `yarn seed:notable` upserts these WITHOUT clobbering worker-enriched fields
 * (photo/blurb/type), so re-running is safe.
 */
export interface NotableSeed {
  kind: NotableKind;
  /** ICAO24 hex (aircraft) or MMSI (ship). Lowercased on upsert. */
  code: string;
  label: string;
  category?: string;
  wikiTitle?: string;
  /** Default true; false = present in the catalog but not yet live-matchable. */
  enabled?: boolean;
  /** Top-tier — gets priority when live (see iNotableTrack.vip). */
  vip?: boolean;
  type?: string;
  operator?: string;
  registration?: string;
  imo?: string;
  notes?: string;
}

export const NOTABLE_SEED: NotableSeed[] = [
  // ── Ships (MMSI verified against public AIS registries; broadcast AIS) ──
  {
    kind: "ship",
    code: "310627000",
    label: "Queen Mary 2",
    category: "cruise",
    wikiTitle: "Queen Mary 2",
    type: "Ocean liner",
    operator: "Cunard Line",
    imo: "9241061",
  },
  {
    kind: "ship",
    code: "376404000",
    label: "E/V Nautilus",
    category: "research",
    wikiTitle: "EV Nautilus",
    type: "Research vessel",
    operator: "Ocean Exploration Trust",
    imo: "6711883",
  },
  {
    kind: "ship",
    code: "740405000",
    label: "RRS Sir David Attenborough",
    category: "research",
    wikiTitle: "RRS Sir David Attenborough",
    type: "Polar research vessel",
    operator: "British Antarctic Survey",
    imo: "9798222",
  },

  // ── Aircraft (ICAO24 hex UNVERIFIED — confirm & enable in /admin) ──
  {
    kind: "aircraft",
    code: "adfeb7",
    label: "Air Force One (VC-25A)",
    category: "government",
    wikiTitle: "Boeing VC-25",
    type: "Boeing VC-25A",
    operator: "United States Air Force",
    vip: true,
    registration: "82-8000",
    enabled: false,
    notes: "ICAO24 hex candidate — confirm the currently-transmitting hex before enabling (VC-25A is often filtered on public ADS-B).",
  },
  {
    kind: "aircraft",
    code: "adfeb8",
    label: "Air Force One (VC-25A)",
    category: "government",
    wikiTitle: "Boeing VC-25",
    type: "Boeing VC-25A",
    operator: "United States Air Force",
    vip: true,
    registration: "92-9000",
    enabled: false,
    notes: "ICAO24 hex candidate — confirm the currently-transmitting hex before enabling (VC-25A is often filtered on public ADS-B).",
  },
];
