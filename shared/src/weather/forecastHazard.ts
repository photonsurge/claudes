// weather/forecastHazard.ts
// Derived forecast-hazard classification: threshold a day's forecast
// variable aggregates (already computed for the hi/lo card strip) against a
// small tunable rule table to surface a "heads up" flag — e.g. high wind or
// extreme heat expected tomorrow. This is NOT a new alerts source: it reuses
// the alerts domain's HazardType vocabulary and severity scale purely so the
// visual language (icon/color) matches the real alerts feed, but the flag
// itself is a model-threshold guess, computed at read time (mirrors
// shared/src/alerts/hazard.ts's "derive on read, no schema change"
// convention) so thresholds can be retuned without a data migration.
//
// Thresholds below are reasonable defaults, not validated against live GFS
// output yet — expect to retune after a real broadcast dry run.

import type { HazardType } from "../alerts/hazard";
import type { SeverityRank } from "../db/alert-model";

export interface DayAggregate {
  /** Variable id (VARIABLE_REGISTRY), e.g. "gust", "temp", "rain", "storm". */
  variable: string;
  min: number;
  max: number;
}

export interface ForecastHazardFlag {
  hazard: HazardType;
  severityRank: SeverityRank;
  label: string;
}

interface HazardRule {
  variable: string;
  hazard: HazardType;
  label: string;
  /** Returns the severity rank this day earns against the rule, 0 = no flag. */
  test: (day: DayAggregate) => SeverityRank;
}

const RULES: HazardRule[] = [
  {
    variable: "gust",
    hazard: "wind",
    label: "HIGH WIND",
    test: (d) => (d.max >= 26 ? 3 : d.max >= 22 ? 2 : 0),
  },
  {
    variable: "temp",
    hazard: "heat",
    label: "EXTREME HEAT",
    test: (d) => (d.max >= 40 ? 3 : d.max >= 38 ? 2 : 0),
  },
  {
    variable: "temp",
    hazard: "cold",
    label: "EXTREME COLD",
    test: (d) => (d.min <= -29 ? 3 : d.min <= -23 ? 2 : 0),
  },
  {
    variable: "rain",
    hazard: "rain",
    label: "HEAVY RAIN",
    test: (d) => (d.max >= 20 ? 3 : d.max >= 10 ? 2 : 0),
  },
  {
    variable: "storm",
    hazard: "thunderstorm",
    label: "SEVERE STORM RISK",
    test: (d) => (d.max >= 4000 ? 3 : d.max >= 2500 ? 2 : 0),
  },
];

/**
 * Evaluate every rule against a day's aggregates, returning the flags that
 * cleared their floor, most severe first. Pure — no IO.
 */
export function classifyForecastDay(aggregates: DayAggregate[]): ForecastHazardFlag[] {
  const byVariable = new Map(aggregates.map((a) => [a.variable, a]));
  const flags: ForecastHazardFlag[] = [];
  for (const rule of RULES) {
    const day = byVariable.get(rule.variable);
    if (!day) continue;
    const severityRank = rule.test(day);
    if (severityRank > 0) flags.push({ hazard: rule.hazard, severityRank, label: rule.label });
  }
  return flags.sort((a, b) => b.severityRank - a.severityRank);
}
