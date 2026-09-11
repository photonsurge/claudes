/**
 * Status-row LOCATION readout for the masthead: "LOC <CONTINENT> · <COUNTRY>",
 * right-aligned in whatever room is left between the channel chips and the
 * coordinate block.
 *
 * The banner is a fixed 1400×320 viewBox with no layout engine, so the fit is
 * arithmetic: JetBrains Mono advances exactly 0.6 em, plus the 1-unit letter
 * spacing the other readouts use. When the room is tight (a long scene name in
 * the chip) the line degrades — full → country only → nothing — rather than
 * shrinking into an unreadable smear or running under the chip.
 *
 * Nothing is ever invented: an unresolved point (open ocean, or the country
 * index still loading) renders NO label at all, not "UNKNOWN".
 */
import type { BannerReadout } from "./live-readout";

/** Ink slot for each run — GodsBanner maps these to its theme tokens. */
export type PlaceTone = "label" | "muted" | "text";

export interface PlaceRun {
  text: string;
  tone: PlaceTone;
}

export interface PlaceLine {
  /** Font size in viewBox units, already fitted to the available room. */
  size: number;
  runs: PlaceRun[];
}

/** Right edge of the location line: the hairline divider before LAT sits at 846. */
export const PLACE_RIGHT_X = 840;
/** Baseline shared with the channel chips and the coordinate readout. */
export const PLACE_BASELINE_Y = 163;

const MAX_SIZE = 16;
const MIN_SIZE = 12;
/** JetBrains Mono advance (em) + the readouts' 1-unit letter spacing. */
const MONO_ADVANCE = 0.6;
const LETTER_SPACING = 1;

/** Channel chip metrics (Saira 30 / 4.5 letter spacing, 154 apart from x=408).
 *  The advance is deliberately pessimistic — Saira itself runs ~0.5 em, but a
 *  cold OBS start (or any box without the webfont) falls back to a wider face,
 *  and a location line that overlaps the chip is worse than a smaller one. */
const CHIP_X = 408;
const CHIP_STEP = 154;
const CHIP_SIZE = 30;
const CHIP_ADVANCE = 0.62;
const CHIP_LETTER_SPACING = 4.5;
/** Breathing room between the last chip and the location line. */
const CHIP_GAP = 28;

/** Room left for the location line once the channel chips have their say. */
export function placeMaxWidth(channels: readonly string[] = []): number {
  if (!channels.length) return PLACE_RIGHT_X - CHIP_X;
  const last = channels[channels.length - 1] ?? "";
  const end =
    CHIP_X +
    (channels.length - 1) * CHIP_STEP +
    last.length * (CHIP_SIZE * CHIP_ADVANCE + CHIP_LETTER_SPACING);
  return PLACE_RIGHT_X - end - CHIP_GAP;
}

function width(runs: readonly PlaceRun[], size: number): number {
  const chars = runs.reduce((n, run) => n + run.text.length, 0);
  return chars * (size * MONO_ADVANCE + LETTER_SPACING);
}

/** Largest size (capped at MAX_SIZE) that keeps `runs` inside `maxWidth`. */
function fit(runs: readonly PlaceRun[], maxWidth: number): number {
  const chars = runs.reduce((n, run) => n + run.text.length, 0);
  if (!chars) return 0;
  return Math.min(MAX_SIZE, (maxWidth / chars - LETTER_SPACING) / MONO_ADVANCE);
}

/**
 * The runs to paint, or null when there is nothing to say (no country resolved)
 * or nowhere to say it (the chips have eaten the row).
 */
export function placeLine(
  readout: BannerReadout | null | undefined,
  maxWidth: number,
): PlaceLine | null {
  const country = (readout?.country ?? "").trim().toUpperCase();
  if (!country) return null;
  const continent = (readout?.continent ?? "").trim().toUpperCase();
  // A one-country continent (Antarctica) would otherwise read "X · X".
  const both = continent && continent !== country;

  const candidates: PlaceRun[][] = [];
  if (both) {
    candidates.push([
      { text: "LOC ", tone: "label" },
      { text: `${continent} · `, tone: "muted" },
      { text: country, tone: "text" },
    ]);
  }
  candidates.push([
    { text: "LOC ", tone: "label" },
    { text: country, tone: "text" },
  ]);
  candidates.push([{ text: country, tone: "text" }]);

  for (const runs of candidates) {
    const size = fit(runs, maxWidth);
    if (size >= MIN_SIZE) return { size, runs };
  }
  return null;
}

/** Rendered width of a fitted line — exported for the layout test. */
export function placeLineWidth(line: PlaceLine): number {
  return width(line.runs, line.size);
}
