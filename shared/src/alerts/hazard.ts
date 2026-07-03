/**
 * Controlled hazard vocabulary (spec §4). Classifies an alert into one cross-
 * source category — "heat", "flood", "wind" … — so the list can group/filter by
 * what the warning is ABOUT, regardless of the source's native wording. Derived
 * on read (no schema change): MeteoAlarm carries an `awareness_type` code, GDACS
 * a `gdacsEventType`, everything else falls back to keyword-matching the event.
 */
export type HazardType =
  | "heat"
  | "cold"
  | "wind"
  | "tornado"
  | "thunderstorm"
  | "rain"
  | "flood"
  | "snow-ice"
  | "fog"
  | "fire"
  | "dust"
  | "air"
  | "coastal"
  | "marine"
  | "avalanche"
  | "cyclone"
  | "drought"
  | "volcano"
  | "tsunami"
  | "landslide"
  | "other";

export interface HazardMeta {
  id: HazardType;
  label: string;
  icon: string;
  /** Chip tint (hex) for fast visual scanning in the list. */
  color: string;
}

export const HAZARDS: HazardMeta[] = [
  { id: "heat", label: "Heat", icon: "🔥", color: "#f97316" },
  { id: "cold", label: "Cold", icon: "❄️", color: "#93c5fd" },
  { id: "wind", label: "Wind", icon: "🌬️", color: "#67e8f9" },
  { id: "tornado", label: "Tornado", icon: "🌪️", color: "#c084fc" },
  { id: "thunderstorm", label: "Thunderstorm", icon: "⛈️", color: "#818cf8" },
  { id: "rain", label: "Rain", icon: "🌧️", color: "#60a5fa" },
  { id: "flood", label: "Flood", icon: "🌊", color: "#38bdf8" },
  { id: "snow-ice", label: "Snow / Ice", icon: "🌨️", color: "#bae6fd" },
  { id: "fog", label: "Fog", icon: "🌫️", color: "#cbd5e1" },
  { id: "fire", label: "Fire", icon: "🔥", color: "#fb7185" },
  { id: "dust", label: "Dust / Sand", icon: "💨", color: "#d6b370" },
  { id: "air", label: "Air Quality", icon: "😷", color: "#bef264" },
  { id: "coastal", label: "Coastal", icon: "🏖️", color: "#fcd34d" },
  { id: "marine", label: "Marine", icon: "⚓", color: "#2dd4bf" },
  { id: "avalanche", label: "Avalanche", icon: "🏔️", color: "#e2e8f0" },
  { id: "cyclone", label: "Cyclone", icon: "🌀", color: "#e879f9" },
  { id: "drought", label: "Drought", icon: "🏜️", color: "#d4a373" },
  { id: "volcano", label: "Volcano", icon: "🌋", color: "#ef4444" },
  { id: "tsunami", label: "Tsunami", icon: "🌊", color: "#3b82f6" },
  { id: "landslide", label: "Landslide", icon: "⛰️", color: "#a8a29e" },
  { id: "other", label: "Other", icon: "⚠️", color: "#9ca3af" },
];

const META = Object.fromEntries(HAZARDS.map((h) => [h.id, h])) as Record<HazardType, HazardMeta>;
export const hazardMeta = (h: HazardType): HazardMeta => META[h] ?? META.other;

/** Runtime guard for untrusted (socket/HTTP) hazard-type values. */
export const isHazardType = (v: unknown): v is HazardType =>
  typeof v === "string" && v in META;

/** MeteoAlarm `awareness_type` leading code → hazard. */
const MA_CODE: Record<string, HazardType> = {
  "1": "wind",
  "2": "snow-ice",
  "3": "thunderstorm",
  "4": "fog",
  "5": "heat",
  "6": "cold",
  "7": "coastal",
  "8": "fire",
  "9": "avalanche",
  "10": "rain",
  "11": "flood",
  "12": "flood",
};

/** GDACS event code → hazard. */
const GDACS_CODE: Record<string, HazardType> = {
  TC: "cyclone",
  FL: "flood",
  FF: "flood",
  WF: "fire",
  DR: "drought",
  VO: "volcano",
  TS: "tsunami",
};

export interface ClassifyInput {
  event?: string;
  parameters?: Record<string, string> | undefined;
}

/** Best-effort hazard category for an alert. Ordered so specific beats generic. */
export function classifyHazard(input: ClassifyInput): HazardType {
  const params = input.parameters ?? {};

  // MeteoAlarm: "5; high-temperature" → code 5.
  const aw = params.awareness_type;
  if (aw) {
    const code = aw.split(";")[0].trim();
    if (MA_CODE[code]) return MA_CODE[code];
  }

  // GDACS: explicit event code.
  const g = params.gdacsEventType;
  if (g && GDACS_CODE[g]) return GDACS_CODE[g];

  // Keyword match on the event text (NWS and anything else). Ordered so the
  // specific hazard wins before the generic one (tornado before thunderstorm,
  // dust before wind, marine before coastal/wind, etc.).
  // Matches NWS/WMO English wording plus the common ES/FR terms the WMO global
  // feed carries natively (viento, pluie, orage, nevada, inundación, canicule…).
  const e = (input.event ?? "").toLowerCase();
  if (/tsunami/.test(e)) return "tsunami";
  if (/avalanche/.test(e)) return "avalanche";
  if (/volcan|ash ?fall/.test(e)) return "volcano";
  if (/drought/.test(e)) return "drought";
  if (/hurricane|tropical|cyclone|typhoon|typhon|storm surge/.test(e)) return "cyclone";
  if (/tornado/.test(e)) return "tornado";
  if (/landslide|mudslide|rockfall|geologic/.test(e)) return "landslide";
  if (/thunderstorm|t-?storm|thunder|lightning|convection|\bhail\b|orage|tormenta|severe weather/.test(e)) return "thunderstorm";
  if (/excessive heat|heat ?wave|heat|hot weather|high[\s-]?temp|canicule|altas? temperatur/.test(e)) return "heat";
  if (/wind chill|extreme cold|cold ?wave|hard freeze|freeze|frost|low[\s-]?temp|sheep grazier/.test(e)) return "cold";
  if (/dust|sand ?storm|haboob|sable|poussiere/.test(e)) return "dust";
  if (/air quality|air stagnation|smog|ozone|dense smoke/.test(e)) return "air";
  if (/red flag|wildfire|forest ?fire|bush ?fire|fire weather|\bfires?\b|danger of fire/.test(e)) return "fire";
  if (/flash flood|flood|inundaci|hydrolog|high water/.test(e)) return "flood";
  if (/blizzard|snow|nevada|neige|ice storm|freezing rain|sleet|winter (storm|weather)|\bice\b/.test(e)) return "snow-ice";
  if (/dense fog|freezing fog|\bfog\b|brouillard|low visibility/.test(e)) return "fog";
  if (/small craft|gale|hazardous seas|high seas|special marine|\bmarine\b|storm warning|ashore/.test(e)) return "marine";
  if (/beach|high surf|rip current|\bsurf\b|swell|high wave|coastal/.test(e)) return "coastal";
  if (/high wind|wind advisory|\bwinds?\b|\bvent\b|viento|gust|squall/.test(e)) return "wind";
  if (/rain|precip|shower|downpour|pluie|lluvia/.test(e)) return "rain";
  return "other";
}
