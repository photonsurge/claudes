/**
 * Broadcast branding + theme knobs for the on-air chrome. Swap these to re-skin
 * the frame (channel name, tagline, ticker header, accent colours) without
 * touching the components.
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
  /** Primary accent (LIVE dot, active bits). */
  accent: string;
  /** Panel glass background. */
  panelBg: string;
  /** Panel hairline border. */
  panelBorder: string;
}

export const DEFAULT_THEME: BroadcastTheme = {
  name: "LIVE WEATHER GLOBE",
  tagline: "GLOBAL WEATHER & FLIGHT OPS",
  tickerTitle: "GLOBAL FEED",
  meterTitle: "INTENSITY METER",
  accent: "#ff4242",
  panelBg: "linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.9))",
  panelBorder: "1px solid rgba(120,140,170,0.25)",
};
