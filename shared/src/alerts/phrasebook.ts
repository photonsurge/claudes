/**
 * Broadcast phrasebook — the on-air NAME of a hazard.
 *
 * Source CAP `event` strings are written by 190-odd national met services for
 * their own bulletins, not for television, and they are unusable as a headline:
 *
 *   "Strong convection" (CMA) · "Thunderstormwarning" · "Forestfire" · "thunder"
 *   "Other dangers" · "Near gale 14-17 m/s" · "Viento Zonda" · "BÖEN"
 *   "awareness_type=3, awareness_level=2" · "сильный ветер (побережье)"
 *
 * There is no phrase map big enough to cover that tail — it is multilingual,
 * inconsistently spaced and full of leaked machine codes. So we don't rewrite
 * the source string, we IGNORE it for display and generate the title ourselves
 * from two things we already trust: the cross-source `hazard` classification
 * (hazard.ts) and the normalised `severityRank`. The raw string stays visible in
 * the card's TYPE row and throughout /admin, where provenance matters.
 *
 * The source string still gets a vote, but only on WORDING: a small set of
 * modifier probes look for meaning the hazard category can't carry on its own
 * (watch vs warning, hail, gale, flash vs river flood, sand vs dust…). Probes
 * are English-only by design — a miss falls back to the base phrase, which is
 * always correct, just less specific.
 */
import type { HazardType } from "./hazard";

/**
 * Severity bands. Ranks 0–2 stay unadorned: the severity chip already sits
 * beside the title, and "MINOR THUNDERSTORMS" reads as an anticlimax on air.
 * Only 3 (Severe) and 4 (Extreme) earn an intensifier.
 */
type Band = "base" | "severe" | "extreme";

const bandOf = (rank?: number): Band =>
  rank === 4 ? "extreme" : rank === 3 ? "severe" : "base";

/** Per-hazard headline by band. Sentence case; callers uppercase for air. */
const PHRASES: Record<HazardType, Record<Band, string>> = {
  heat: { base: "Hot Weather", severe: "Severe Heat", extreme: "Extreme Heat" },
  cold: { base: "Cold Weather", severe: "Severe Cold", extreme: "Extreme Cold" },
  wind: { base: "Strong Winds", severe: "Damaging Winds", extreme: "Destructive Winds" },
  tornado: { base: "Tornado Risk", severe: "Tornado Warning", extreme: "Tornado Emergency" },
  thunderstorm: { base: "Thunderstorms", severe: "Severe Thunderstorms", extreme: "Violent Thunderstorms" },
  rain: { base: "Heavy Rain", severe: "Torrential Rain", extreme: "Extreme Rainfall" },
  flood: { base: "Flood Risk", severe: "Flooding", extreme: "Severe Flooding" },
  "snow-ice": { base: "Snow & Ice", severe: "Heavy Snow", extreme: "Blizzard Conditions" },
  fog: { base: "Dense Fog", severe: "Dense Fog", extreme: "Dense Fog" },
  fire: { base: "Fire Risk", severe: "High Fire Danger", extreme: "Extreme Fire Danger" },
  dust: { base: "Blowing Dust", severe: "Dust Storm", extreme: "Severe Dust Storm" },
  air: { base: "Poor Air Quality", severe: "Unhealthy Air", extreme: "Hazardous Air" },
  coastal: { base: "Rough Surf", severe: "Dangerous Surf", extreme: "Extreme Surf" },
  marine: { base: "Rough Seas", severe: "Hazardous Seas", extreme: "Severe Seas" },
  avalanche: { base: "Avalanche Risk", severe: "Avalanche Danger", extreme: "Extreme Avalanche Danger" },
  cyclone: { base: "Tropical Storm", severe: "Tropical Cyclone", extreme: "Severe Tropical Cyclone" },
  drought: { base: "Dry Conditions", severe: "Drought", extreme: "Severe Drought" },
  volcano: { base: "Volcanic Activity", severe: "Volcanic Eruption", extreme: "Major Eruption" },
  tsunami: { base: "Tsunami Advisory", severe: "Tsunami Warning", extreme: "Tsunami Warning" },
  landslide: { base: "Landslide Risk", severe: "Landslide Danger", extreme: "Major Landslide Danger" },
  other: { base: "Weather Advisory", severe: "Severe Weather", extreme: "Extreme Weather" },
};

/**
 * Wording refinements keyed off the raw source text. `when` is tested against
 * the lowercased source string; the first hit wins, so order within a hazard is
 * most-specific-first. A refinement may set only some bands — unset bands keep
 * the base table's phrase.
 */
interface Refinement {
  when: RegExp;
  phrase: Partial<Record<Band, string>>;
}

const REFINEMENTS: Partial<Record<HazardType, Refinement[]>> = {
  heat: [
    { when: /heat ?wave|canicule|ola de calor|onda de calor/, phrase: { base: "Heat Wave", severe: "Severe Heat Wave", extreme: "Extreme Heat Wave" } },
  ],
  cold: [
    { when: /wind chill/, phrase: { base: "Dangerous Wind Chill", severe: "Dangerous Wind Chill", extreme: "Life-Threatening Wind Chill" } },
    { when: /freeze|frost|hela|gel[ée]e/, phrase: { base: "Frost", severe: "Hard Freeze", extreme: "Severe Freeze" } },
  ],
  wind: [
    { when: /squall/, phrase: { base: "Squalls", severe: "Violent Squalls", extreme: "Violent Squalls" } },
    { when: /gale/, phrase: { base: "Gale-Force Winds", severe: "Storm-Force Winds", extreme: "Hurricane-Force Winds" } },
    { when: /zonda|foehn|föhn|chinook|downslope/, phrase: { base: "Downslope Winds", severe: "Damaging Downslope Winds" } },
  ],
  tornado: [{ when: /watch/, phrase: { base: "Tornado Watch", severe: "Tornado Watch" } }],
  thunderstorm: [
    { when: /hail|grêle|granizo|hagel/, phrase: { base: "Thunderstorms & Hail", severe: "Severe Storms & Hail", extreme: "Damaging Hail" } },
    { when: /watch/, phrase: { base: "Thunderstorm Watch", severe: "Severe Storm Watch" } },
  ],
  flood: [
    { when: /flash|crue soudaine/, phrase: { base: "Flash Flood Risk", severe: "Flash Flooding", extreme: "Life-Threatening Flash Flooding" } },
    { when: /coastal|surge|marée/, phrase: { base: "Coastal Flood Risk", severe: "Coastal Flooding", extreme: "Severe Coastal Flooding" } },
    { when: /river|riverine|fluvial/, phrase: { base: "River Flood Risk", severe: "River Flooding", extreme: "Major River Flooding" } },
    { when: /watch|outlook/, phrase: { base: "Flood Watch", severe: "Flood Watch" } },
  ],
  "snow-ice": [
    { when: /blizzard/, phrase: { base: "Blizzard Conditions", severe: "Blizzard", extreme: "Severe Blizzard" } },
    { when: /freezing rain|ice storm|verglas/, phrase: { base: "Freezing Rain", severe: "Ice Storm", extreme: "Severe Ice Storm" } },
    { when: /avalanche/, phrase: { base: "Avalanche Risk", severe: "Avalanche Danger" } },
  ],
  fog: [{ when: /freezing/, phrase: { base: "Freezing Fog", severe: "Freezing Fog", extreme: "Freezing Fog" } }],
  fire: [
    { when: /smoke|fumée|humo/, phrase: { base: "Wildfire Smoke", severe: "Dense Wildfire Smoke", extreme: "Hazardous Wildfire Smoke" } },
    { when: /red flag/, phrase: { base: "Red Flag Conditions", severe: "Critical Fire Weather", extreme: "Extreme Fire Weather" } },
  ],
  dust: [{ when: /sand|sable|arena/, phrase: { base: "Blowing Sand", severe: "Sandstorm", extreme: "Severe Sandstorm" } }],
  air: [
    { when: /smoke/, phrase: { base: "Wildfire Smoke", severe: "Dense Wildfire Smoke", extreme: "Hazardous Wildfire Smoke" } },
    { when: /ozone|smog/, phrase: { base: "Smog", severe: "Heavy Smog", extreme: "Hazardous Smog" } },
  ],
  coastal: [
    { when: /rip current/, phrase: { base: "Rip Currents", severe: "Dangerous Rip Currents", extreme: "Life-Threatening Rip Currents" } },
    { when: /surge/, phrase: { base: "Storm Surge", severe: "Dangerous Storm Surge", extreme: "Life-Threatening Storm Surge" } },
    { when: /swell|wave height|high wave/, phrase: { base: "High Waves", severe: "Dangerous Waves", extreme: "Extreme Waves" } },
    { when: /beach/, phrase: { base: "Beach Hazards", severe: "Dangerous Beach Conditions" } },
  ],
  marine: [
    { when: /small craft/, phrase: { base: "Small Craft Advisory", severe: "Small Craft Warning" } },
    { when: /gale/, phrase: { base: "Marine Gale", severe: "Storm-Force Seas", extreme: "Hurricane-Force Seas" } },
  ],
  cyclone: [
    { when: /typhoon|typhon/, phrase: { base: "Typhoon Threat", severe: "Typhoon", extreme: "Super Typhoon" } },
    { when: /hurricane/, phrase: { base: "Hurricane Threat", severe: "Hurricane", extreme: "Major Hurricane" } },
    { when: /depression/, phrase: { base: "Tropical Depression", severe: "Tropical Depression" } },
  ],
  volcano: [{ when: /ash/, phrase: { base: "Volcanic Ash", severe: "Volcanic Ash Cloud", extreme: "Major Ash Cloud" } }],
  tsunami: [{ when: /watch/, phrase: { base: "Tsunami Watch", severe: "Tsunami Watch" } }],
  landslide: [
    { when: /mud/, phrase: { base: "Mudslide Risk", severe: "Mudslides", extreme: "Major Mudslides" } },
    { when: /rockfall/, phrase: { base: "Rockfall Risk", severe: "Rockfall Danger" } },
  ],
};

export interface BroadcastLabelInput {
  hazard: HazardType;
  /** Normalised cross-source severity rank (0–4). */
  severityRank?: number;
  /** Raw source event string — read for wording probes only, never displayed. */
  event?: string;
  /** English translation of the event/headline, when the source isn't English. */
  translatedEvent?: string;
}

/**
 * The on-air name for a hazard — "Severe Thunderstorms", not "Strong convection".
 * Sentence case; uppercase at the render site if the design calls for it.
 */
export function broadcastEventLabel(a: BroadcastLabelInput): string {
  const band = bandOf(a.severityRank);
  const table = PHRASES[a.hazard] ?? PHRASES.other;
  const text = `${a.translatedEvent ?? ""} ${a.event ?? ""}`.toLowerCase();
  for (const r of REFINEMENTS[a.hazard] ?? []) {
    if (r.when.test(text)) return r.phrase[band] ?? table[band];
  }
  return table[band];
}
