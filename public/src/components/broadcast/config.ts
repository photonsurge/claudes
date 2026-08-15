/**
 * Broadcast branding + theme presets for the on-air chrome. Each theme is a full
 * identity (name, tagline, ticker/meter headers, accent, panel glass) so picking
 * one re-skins the whole frame. Selected via ControlState.broadcastTheme and
 * resolved with getBroadcastTheme(), so /control and /watch stay in sync.
 */
import { THEME_OVERRIDE_KEYS, type ThemeOverrides } from "@photonsurge/shared/control";

export interface BroadcastTheme {
  /** Big brand name in the top-left panel. */
  name: string;
  /** Small line under the name. */
  tagline: string;
  /** Optional third, dimmer line under the tagline. */
  strapline?: string;
  /** Monogram style for the top-left mark. "orbit" draws a globe+satellite-ring
   *  glyph; omitted falls back to the classic circle+swoosh monogram. */
  iconVariant?: "orbit";
  /** Header chip on the top ticker. */
  tickerTitle: string;
  /** Title over the left colour scale. */
  meterTitle: string;
  /** Primary accent (ticker chip, meter tag, monogram). */
  accent: string;
  /** Panel glass background. */
  panelBg: string;
  /** Panel hairline border. */
  panelBorder: string;
}

export const BROADCAST_THEMES: Record<string, BroadcastTheme> = {
  aurora: {
    name: "G.O.D.S.",
    tagline: "Global Orbital Detection System",
    tickerTitle: "GLOBAL FEED",
    meterTitle: "INTENSITY METER",
    accent: "#38bdf8",
    panelBg: "linear-gradient(180deg, rgba(12,17,28,0.62), rgba(8,12,20,0.7))",
    panelBorder: "1px solid rgba(120,140,170,0.25)",
  },
  command: {
    name: "G.O.D.S.",
    tagline: "Global Orbital Detection System",
    strapline: "DETECT. TRACK. PROTECT.",
    iconVariant: "orbit",
    tickerTitle: "VIGIL TAPE",
    meterTitle: "THREAT MATRIX",
    accent: "#4dc8ff",
    panelBg: "linear-gradient(180deg, rgba(10,20,38,0.66), rgba(6,13,26,0.74))",
    panelBorder: "1px solid rgba(90,150,210,0.32)",
  },
  storm: {
    name: "STORM WATCH LIVE",
    tagline: "SEVERE WEATHER OPERATIONS",
    tickerTitle: "STORM FEED",
    meterTitle: "INTENSITY METER",
    accent: "#f43f5e",
    panelBg: "linear-gradient(180deg, rgba(24,12,20,0.64), rgba(14,8,14,0.72))",
    panelBorder: "1px solid rgba(200,120,140,0.26)",
  },
};

/** Picker options for the operator console. */
export const THEME_OPTIONS: { id: string; label: string }[] = [
  { id: "aurora", label: "Aurora" },
  { id: "command", label: "G.O.D.S." },
  { id: "storm", label: "Storm" },
];

export const DEFAULT_THEME: BroadcastTheme = BROADCAST_THEMES.command;

/**
 * Resolve a theme id to its preset (falling back to the default), then layer the
 * channel's per-brand overrides on top: any non-empty override field replaces
 * the preset's, an empty/absent one keeps the preset. Keeps /control and /watch
 * in sync — both resolve from ControlState.broadcastTheme + themeOverrides.
 */
export function getBroadcastTheme(id?: string, overrides?: ThemeOverrides): BroadcastTheme {
  const base = (id && BROADCAST_THEMES[id]) || DEFAULT_THEME;
  if (!overrides) return base;
  const merged: BroadcastTheme = { ...base };
  for (const key of THEME_OVERRIDE_KEYS) {
    const v = overrides[key];
    if (typeof v === "string" && v.trim() !== "") merged[key] = v;
  }
  return merged;
}

/** The LIVE badge stays broadcast-red regardless of theme accent. */
export const LIVE_RED = "#ff3b3b";

/**
 * Panel border with an accent stripe on the left. Spelled out per side because
 * React forbids mixing the `border` shorthand with `borderLeft` in one style
 * object (updates to one can clobber the other on rerender).
 */
export function accentBorder(base: string, left: string): {
  borderTop: string;
  borderRight: string;
  borderBottom: string;
  borderLeft: string;
} {
  return { borderTop: base, borderRight: base, borderBottom: base, borderLeft: left };
}

/** Mirror of accentBorder with the accent stripe on the RIGHT edge — for panels
 *  pinned to the screen's right (top-right deck), where the stripe reads better
 *  on the outer edge. */
export function accentBorderRight(base: string, right: string): {
  borderTop: string;
  borderRight: string;
  borderBottom: string;
  borderLeft: string;
} {
  return { borderTop: base, borderRight: right, borderBottom: base, borderLeft: base };
}

/** Shared see-through glass fill for panels that let the map read behind them
 *  (a step lighter than the theme `panelBg`). */
export const GLASS_BG = "rgba(8,14,24,0.5)";

/** Shared fill for inset tiles (sparklines, monitor cells, chart canvases) that
 *  stack on top of a panel fill — one knob so every inset reads the same. */
export const TILE_BG = "rgba(4,10,20,0.55)";
