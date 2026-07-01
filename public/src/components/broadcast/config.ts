/**
 * Broadcast branding + theme presets for the on-air chrome. Each theme is a full
 * identity (name, tagline, ticker/meter headers, accent, panel glass) so picking
 * one re-skins the whole frame. Selected via ControlState.broadcastTheme and
 * resolved with getBroadcastTheme(), so /control and /watch stay in sync.
 */
export interface BroadcastTheme {
  /** Big brand name in the top-left panel. */
  name: string;
  /** Small line under the name. */
  tagline: string;
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
    name: "LIVE WEATHER GLOBE",
    tagline: "GLOBAL WEATHER & FLIGHT OPS",
    tickerTitle: "GLOBAL FEED",
    meterTitle: "INTENSITY METER",
    accent: "#38bdf8",
    panelBg: "linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.9))",
    panelBorder: "1px solid rgba(120,140,170,0.25)",
  },
  command: {
    name: "G.O.D.S. COMMAND",
    tagline: "GLOBAL OBSERVATION & DEFENSE SYSTEM",
    tickerTitle: "VIGIL TAPE",
    meterTitle: "THREAT MATRIX",
    accent: "#f5b301",
    panelBg: "linear-gradient(180deg, rgba(10,20,38,0.86), rgba(6,13,26,0.93))",
    panelBorder: "1px solid rgba(90,150,210,0.32)",
  },
  storm: {
    name: "STORM WATCH LIVE",
    tagline: "SEVERE WEATHER OPERATIONS",
    tickerTitle: "STORM FEED",
    meterTitle: "INTENSITY METER",
    accent: "#f43f5e",
    panelBg: "linear-gradient(180deg, rgba(24,12,20,0.84), rgba(14,8,14,0.92))",
    panelBorder: "1px solid rgba(200,120,140,0.26)",
  },
};

/** Picker options for the operator console. */
export const THEME_OPTIONS: { id: string; label: string }[] = [
  { id: "aurora", label: "Aurora" },
  { id: "command", label: "Command" },
  { id: "storm", label: "Storm" },
];

export const DEFAULT_THEME: BroadcastTheme = BROADCAST_THEMES.aurora;

/** Resolve a theme id to its preset, falling back to the default. */
export function getBroadcastTheme(id?: string): BroadcastTheme {
  return (id && BROADCAST_THEMES[id]) || DEFAULT_THEME;
}

/** The LIVE badge stays broadcast-red regardless of theme accent. */
export const LIVE_RED = "#ff3b3b";
