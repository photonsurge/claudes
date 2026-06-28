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

/** MeteoAlarm awareness level (1 green … 4 red) → rank. */
export function rankFromMeteoalarmLevel(level?: number | string | null): SeverityRank {
  const n = typeof level === "string" ? parseInt(level, 10) : level;
  switch (n) {
    case 4:
      return 4; // red
    case 3:
      return 3; // orange
    case 2:
      return 2; // yellow
    case 1:
      return 0; // green = info
    default:
      return 0;
  }
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
