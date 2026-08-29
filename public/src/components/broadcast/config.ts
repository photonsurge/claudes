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
  /** Header chip on the bottom crawl (and the top crawl on brand-less
   *  channels — with the masthead banner on, the top crawl runs chip-less
   *  behind the banner artwork). */
  tickerTitle: string;
  /** Title over the left colour scale. */
  meterTitle: string;
  /** Primary accent (ticker chip, meter tag, monogram). */
  accent: string;
  /** Panel glass background. */
  panelBg: string;
  /** Panel hairline border. */
  panelBorder: string;
  /** ALL-CAPS panel/widget title ink. */
  titleColor: string;
  /** Card body ink. */
  textColor: string;
  /** Muted eyebrow/caption ink. */
  mutedColor: string;
  /** Dimmest caption ink. */
  dimColor: string;
  /** LIVE badge / ON AIR pip colour. */
  liveColor: string;
  /** Ticker crawl band background (raw CSS). */
  tickerBg: string;
  /** Ticker crawl text ink. */
  tickerText: string;
  /** G.O.D.S. masthead SVG panel gradient colours. */
  godsPanelTopColor: string;
  godsPanelMidColor: string;
  godsPanelBottomColor: string;
  /** G.O.D.S. masthead bezel / panel hairline colour. */
  godsBorderColor: string;
  /** Inset tiles used by feeds, forecasts, charts, and monitor boxes. */
  tileColor: string;
  tileBorderColor: string;
  /** Main-map selected-subject highlight and place-label colours. */
  mapHighlightColor: string;
  mapLabelColor: string;
  mapCapitalColor: string;
  /** Locator minimap palette. */
  minimapOceanInnerColor: string;
  minimapOceanOuterColor: string;
  minimapLandColor: string;
  minimapLandEdgeColor: string;
  minimapGridColor: string;
  minimapLimbColor: string;
  minimapAccentColor: string;
}

/** Ink + furniture tokens shared by every preset — identical across presets
 *  today, overridable per-preset here or per-channel via themeOverrides. */
export const BASE_LOOK = {
  titleColor: "#dfe7f5",
  textColor: "#e6edf7",
  mutedColor: "#9fb3cc",
  dimColor: "#8ea3bf",
  liveColor: "#ff3b3b",
  tickerBg: "linear-gradient(180deg, rgba(6,10,18,0.74), rgba(4,7,13,0.7))",
  tickerText: "#dfe7f5",
  godsPanelTopColor: "#0e1e29",
  godsPanelMidColor: "#081420",
  godsPanelBottomColor: "#0a1a24",
  godsBorderColor: "#1d4354",
  tileColor: "#0b1a24",
  tileBorderColor: "#163241",
  mapHighlightColor: "#4dc8ff",
  mapLabelColor: "#ffffff",
  mapCapitalColor: "#ffd700",
  minimapOceanInnerColor: "#101c30",
  minimapOceanOuterColor: "#070d18",
  minimapLandColor: "#547498",
  minimapLandEdgeColor: "#a5c0dc",
  minimapGridColor: "#8298b2",
  minimapLimbColor: "#96b0ce",
  minimapAccentColor: "#4dc8ff",
};

export const BROADCAST_THEMES: Record<string, BroadcastTheme> = {
  aurora: {
    ...BASE_LOOK,
    name: "G.O.D.S.",
    tagline: "Global Orbital Detection System",
    tickerTitle: "GLOBAL FEED",
    meterTitle: "INTENSITY METER",
    accent: "#38bdf8",
    minimapAccentColor: "#38bdf8",
    panelBg: "linear-gradient(180deg, rgba(12,17,28,0.74), rgba(8,12,20,0.82))",
    panelBorder: "1px solid rgba(120,140,170,0.25)",
  },
  command: {
    ...BASE_LOOK,
    name: "G.O.D.S.",
    tagline: "Global Orbital Detection System",
    strapline: "DETECT. TRACK. PROTECT.",
    iconVariant: "orbit",
    tickerTitle: "VIGIL TAPE",
    meterTitle: "THREAT MATRIX",
    accent: "#4dc8ff",
    panelBg: "linear-gradient(180deg, rgba(10,20,38,0.78), rgba(6,13,26,0.86))",
    panelBorder: "1px solid rgba(90,150,210,0.32)",
  },
  storm: {
    ...BASE_LOOK,
    name: "STORM WATCH LIVE",
    tagline: "SEVERE WEATHER OPERATIONS",
    tickerTitle: "STORM FEED",
    meterTitle: "INTENSITY METER",
    accent: "#f43f5e",
    minimapAccentColor: "#f43f5e",
    panelBg: "linear-gradient(180deg, rgba(24,12,20,0.76), rgba(14,8,14,0.84))",
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

/** CSS custom properties consumed by the shared G.O.D.S. panel constants.
 * Applying these once at the scene root lets deeply nested tiles and dividers
 * inherit the resolved palette without threading another prop through every
 * presentation component. */
export function broadcastThemeCssVars(theme: BroadcastTheme): Record<string, string> {
  return {
    "--gods-accent": theme.accent,
    "--gods-title": theme.titleColor,
    "--gods-text": theme.textColor,
    "--gods-muted": theme.mutedColor,
    "--gods-dim": theme.dimColor,
    "--gods-panel-top": theme.godsPanelTopColor,
    "--gods-panel-mid": theme.godsPanelMidColor,
    "--gods-panel-bottom": theme.godsPanelBottomColor,
    "--gods-border": theme.godsBorderColor,
    "--gods-tile": theme.tileColor,
    "--gods-tile-border": theme.tileBorderColor,
  };
}

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
 *  (a step lighter than the theme `panelBg`). Kept fairly opaque: the chrome is
 *  consumed through OBS + YouTube's H.264, and thin glass over a busy moving
 *  basemap washes out to unreadable after compression. */
export const GLASS_BG = "rgba(8,14,24,0.66)";

/** Shared fill for inset tiles (sparklines, monitor cells, chart canvases) that
 *  stack on top of a panel fill — one knob so every inset reads the same. */
export const TILE_BG = "rgba(4,10,20,0.72)";
