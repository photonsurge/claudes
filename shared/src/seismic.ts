// Seismic depth classification — the single source of truth for the
// shallow / intermediate / deep cut-offs. The worker's on-air caption, the
// public legend and the epicentre-ring tint all read these so they can never
// drift apart.
//
// Cut-offs follow the standard USGS/seismology convention: shallow quakes
// (< 70 km) rupture close to the surface and shake hardest at the epicentre;
// intermediate (70–300 km) and deep (> 300 km) events release the same energy
// far below ground, so they're felt over a wider area but more weakly.

export const QUAKE_DEPTH_SHALLOW_MAX_KM = 70;
export const QUAKE_DEPTH_INTERMEDIATE_MAX_KM = 300;

export type QuakeDepthClass = "shallow" | "intermediate" | "deep";

/** Bucket a hypocentre depth (km) into shallow / intermediate / deep. */
export function quakeDepthClass(depthKm: number): QuakeDepthClass {
  if (depthKm < QUAKE_DEPTH_SHALLOW_MAX_KM) return "shallow";
  if (depthKm < QUAKE_DEPTH_INTERMEDIATE_MAX_KM) return "intermediate";
  return "deep";
}

export interface QuakeDepthBand {
  cls: QuakeDepthClass;
  label: string;
  /** Inclusive lower depth bound, km. */
  minKm: number;
  /** Exclusive upper bound, km — null for the open-ended deep band. */
  maxKm: number | null;
  /** One-line "what this means" blurb for captions/legends. */
  blurb: string;
}

/** The depth scale as an ordered reference table (shallow → deep). */
export const QUAKE_DEPTH_BANDS: QuakeDepthBand[] = [
  {
    cls: "shallow",
    label: "Shallow",
    minKm: 0,
    maxKm: QUAKE_DEPTH_SHALLOW_MAX_KM,
    blurb: "Ruptures near the surface — shaking is concentrated and felt hardest at the epicentre.",
  },
  {
    cls: "intermediate",
    label: "Intermediate",
    minKm: QUAKE_DEPTH_SHALLOW_MAX_KM,
    maxKm: QUAKE_DEPTH_INTERMEDIATE_MAX_KM,
    blurb: "Energy is released well below ground — felt over a wider area but more weakly.",
  },
  {
    cls: "deep",
    label: "Deep",
    minKm: QUAKE_DEPTH_INTERMEDIATE_MAX_KM,
    maxKm: null,
    blurb: "Very deep focus — rarely damaging at the surface, yet can be felt across great distances.",
  },
];

/** The reference band (label + blurb) for a hypocentre depth. */
export function quakeDepthBand(depthKm: number): QuakeDepthBand {
  const cls = quakeDepthClass(depthKm);
  return QUAKE_DEPTH_BANDS.find((b) => b.cls === cls) ?? QUAKE_DEPTH_BANDS[0];
}

/** Human label for a depth class (e.g. "Shallow") — used in captions/legends. */
export function quakeDepthLabel(depthKm: number): string {
  return quakeDepthBand(depthKm).label;
}

/** One-line effect description for a depth (e.g. why a shallow quake shakes hardest). */
export function quakeDepthBlurb(depthKm: number): string {
  return quakeDepthBand(depthKm).blurb;
}

// Magnitude classification — the descriptive scale (Micro … Great) with a
// one-line "what it feels like" blurb per band. Same single-source-of-truth
// role as the depth bands above: the on-air quake report, the operator card and
// any legend read these so the vocabulary can never drift. Bands follow the
// common Richter/Mw descriptor convention (USGS) — each spans a whole magnitude
// step, open-ended at the top (Great, 8+) and bottom (Micro).

export type QuakeMagnitudeClass =
  | "micro"
  | "minor"
  | "light"
  | "moderate"
  | "strong"
  | "major"
  | "great";

export interface QuakeMagnitudeBand {
  cls: QuakeMagnitudeClass;
  label: string;
  /** Inclusive lower magnitude bound; the band runs up to the next one's `min`. */
  min: number;
  /** One-line effect description for captions/legends. */
  blurb: string;
}

/** The magnitude scale as an ordered reference table, strongest first. */
export const QUAKE_MAGNITUDE_BANDS: QuakeMagnitudeBand[] = [
  { cls: "great", label: "Great", min: 8, blurb: "Can devastate communities near the epicentre; felt across enormous distances." },
  { cls: "major", label: "Major", min: 7, blurb: "Serious damage over large areas; heavy casualties likely in populated regions." },
  { cls: "strong", label: "Strong", min: 6, blurb: "Can be destructive in populated areas up to ~160 km across." },
  { cls: "moderate", label: "Moderate", min: 5, blurb: "Damage to poorly built structures; felt by nearly everyone nearby." },
  { cls: "light", label: "Light", min: 4, blurb: "Noticeable indoor shaking and rattling; little to no damage." },
  { cls: "minor", label: "Minor", min: 3, blurb: "Often felt, but rarely causes any damage." },
  { cls: "micro", label: "Micro", min: -Infinity, blurb: "Generally not felt — recorded only by seismographs." },
];

/** The reference band (class + label + blurb) for a magnitude. */
export function quakeMagnitudeBand(mag: number): QuakeMagnitudeBand {
  return (
    QUAKE_MAGNITUDE_BANDS.find((b) => mag >= b.min) ??
    QUAKE_MAGNITUDE_BANDS[QUAKE_MAGNITUDE_BANDS.length - 1]
  );
}

/** Bucket a magnitude into its descriptor class (micro … great). */
export function quakeMagnitudeClass(mag: number): QuakeMagnitudeClass {
  return quakeMagnitudeBand(mag).cls;
}

/** Human label for a magnitude (e.g. "Strong") — used in captions/legends. */
export function quakeMagnitudeLabel(mag: number): string {
  return quakeMagnitudeBand(mag).label;
}

/** One-line effect description for a magnitude. */
export function quakeMagnitudeBlurb(mag: number): string {
  return quakeMagnitudeBand(mag).blurb;
}

/**
 * Magnitude class → chip colour, green (micro) through red (great) — the same
 * ramp the on-air QuakeReport chip and epicentre-ring tint use, so a magnitude
 * always reads the same colour everywhere it's shown (reports, legends, the
 * World Watch severity breakdown).
 */
export const QUAKE_CLASS_COLORS: Record<QuakeMagnitudeClass, string> = {
  micro: "#94a3b8", // rarely felt — neutral slate, not part of the felt-impact ramp,
  // kept light enough to still read as a filled bar segment on a dark panel
  minor: "#22c55e",
  light: "#84cc16",
  moderate: "#eab308",
  strong: "#f97316",
  major: "#ef4444",
  great: "#b91c1c",
};

/** Magnitude → chip colour (green minor → dark-red great). */
export function quakeMagnitudeColor(mag: number): string {
  return QUAKE_CLASS_COLORS[quakeMagnitudeClass(mag)];
}
