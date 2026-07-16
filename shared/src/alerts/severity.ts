import type { SeverityRank } from "../db/alert-model";

/**
 * Severity normalisation — the bit that earns its keep (spec §4). Every source
 * uses a different scale; map them all onto one 0–4 `severityRank` while the
 * caller keeps the native value in `sourceSeverity`.
 *
 *   0 None/info · 1 Minor · 2 Moderate · 3 Severe · 4 Extreme
 */

/** CAP-native `severity` → rank. Used by NWS, WMO, JMA, BoM. */
export function rankFromCapSeverity(severity?: string | null): SeverityRank {
  switch ((severity ?? "").trim().toLowerCase()) {
    case "extreme":
      return 4;
    case "severe":
      return 3;
    case "moderate":
      return 2;
    case "minor":
      return 1;
    default:
      return 0; // Unknown / unset
  }
}

/**
 * MeteoAlarm awareness level (1 green … 4 red) → rank, or undefined if it hasn't
 * got one.
 *
 * PREFER THIS over the CAP `severity` field for MeteoAlarm. The two disagree, and
 * the awareness level is the one the source actually means — it's what the
 * MeteoAlarm site itself colours by. Measured against the live feed: of 2,681
 * active alerts, ALL carry an awareness level and 58% contradict the rank we
 * derived from CAP `severity`:
 *
 *   stored 1 -> should be 0:  1,466   green advisories, ranked as Minor warnings
 *   stored 2 -> should be 0:     74   green, ranked YELLOW
 *   stored 1 -> should be 2:     23   yellow, ranked Minor
 *
 * Green is not a warning — it's MeteoAlarm saying "nothing expected" — and every
 * national service publishes one per hazard per region, all the time. Ranking
 * those as Minor put 1,540 non-warnings on the globe, seven translucent shapes
 * deep over the same ground, and sent their polygons through the dissolve.
 *
 * The value arrives as "2; yellow; Moderate", which parseInt reads as 2.
 *
 * Returns undefined rather than 0 when there's no level, so a caller falls back
 * to CAP severity instead of silently marking a real warning as info.
 */
export function rankFromMeteoalarmLevel(level?: number | string | null): SeverityRank | undefined {
  const n = typeof level === "string" ? parseInt(level, 10) : level;
  switch (n) {
    case 4:
      return 4; // red
    case 3:
      return 3; // orange
    case 2:
      return 2; // yellow
    case 1:
      return 0; // green — "no awareness required", i.e. NOT a warning
    default:
      return undefined;
  }
}

/**
 * Is this awareness level MeteoAlarm's green — "no awareness required"?
 *
 * Green is not a mild warning, it's the ABSENCE of one, and every national
 * service publishes one per hazard per region permanently. Measured: 1,546 of
 * 2,708 active MeteoAlarm alerts (57%) were green, each carrying full EMMA
 * boundary geometry, all of it clipped by the dissolve and drawn on the globe.
 *
 * Deliberately NOT `severityRank === 0`. Rank 0 also means "severity unknown" —
 * 114 live WMO alerts sit there, including Air Quality and Riverine Flood
 * warnings that are entirely real and simply ship `severity: Unknown`. Filtering
 * on the rank would silently bin those; filtering on the level bins only what the
 * source itself says is nothing.
 */
export function isMeteoalarmGreen(level?: number | string | null): boolean {
  const n = typeof level === "string" ? parseInt(level, 10) : level;
  return n === 1;
}

/**
 * THE MeteoAlarm rank rule: its own awareness level, falling back to CAP
 * `severity` only when it ships no level.
 *
 * One function because there are two callers and they must never disagree — the
 * adapter, which ranks alerts as they arrive, and `resyncMeteoalarmRanks`, which
 * re-ranks the ones already stored. The stored ones matter: `upsert` skips an
 * unchanged, still-active alert, so fixing this rule did NOTHING to the 2,687
 * alerts already on the globe. 58% of them kept a rank derived from the field
 * we'd just decided not to trust, the oldest sitting on a `sent` from 16 days
 * back that will never be re-issued.
 *
 * If these two ever drift, the globe shows a mix of both rules and the seam is
 * invisible — a shape ranked by one rule sits in a different dissolve bucket
 * from its neighbour ranked by the other, and simply never fuses with it.
 */
export function meteoalarmRank(
  awarenessLevel?: number | string | null,
  capSeverity?: string | null,
): SeverityRank {
  return rankFromMeteoalarmLevel(awarenessLevel) ?? rankFromCapSeverity(capSeverity);
}

/** Met Office colour (yellow/amber/red) → rank. */
export function rankFromMetOfficeColour(colour?: string | null): SeverityRank {
  switch ((colour ?? "").trim().toLowerCase()) {
    case "red":
      return 4;
    case "amber":
      return 3;
    case "yellow":
      return 2;
    default:
      return 0;
  }
}

/** The green→yellow→amber/orange→red ramp implied by the sources (spec §7). */
export const SEVERITY_COLORS: Record<SeverityRank, string> = {
  0: "#9ca3af", // none / info — grey
  1: "#22c55e", // minor — green
  2: "#eab308", // moderate — yellow
  3: "#f97316", // severe — orange/amber
  4: "#ef4444", // extreme — red
};

export const SEVERITY_LABELS: Record<SeverityRank, string> = {
  0: "None",
  1: "Minor",
  2: "Moderate",
  3: "Severe",
  4: "Extreme",
};
