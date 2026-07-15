/**
 * Admin design tokens — the single source of colour/type for every /admin
 * surface. Nothing under /admin should hardcode a hex value; import from here
 * (or read it off the MUI theme, which is built from these in adminTheme.ts).
 *
 * This is the "engine room" palette of DESIGN_BIBLE §4.6: flat, dark and
 * utilitarian on purpose — no glass, no gradients, no blur. That language
 * belongs to the broadcast surface (/watch) and must never bleed in here.
 *
 * Deliberately NOT a copy of the old §4.6 values. Those had page (#0a0e16) and
 * card (#0c111c) within ~2% luminance of each other behind a near-invisible
 * #1b2030 hairline, so panels never read as objects. The ramp below separates
 * page/panel/raised properly and gives the hairline something to do.
 */

/** Surfaces, darkest (page) → lightest (raised panel, hover). */
export const surface = {
  /** Page background — deeper than the panels so cards genuinely lift off it. */
  page: "#070a10",
  /** Default panel/card/table background. */
  panel: "#0f151f",
  /** Raised: nested panels, table headers, hover rows, inputs-on-panel. */
  raised: "#161e2c",
  /** Sunken: code/log tails, trace boxes, input wells. */
  sunken: "#05070c",
} as const;

/** Hairlines. `line` is the workhorse; `lineStrong` is for emphasis/focus. */
export const stroke = {
  line: "#232c3d",
  lineStrong: "#33415a",
} as const;

/** Ink, descending emphasis. */
export const ink = {
  primary: "#e6edf7",
  secondary: "#94a3b8",
  disabled: "#5b6577",
} as const;

/**
 * Brand accent — the product's own sky blue (the `aurora` theme accent from
 * DESIGN_BIBLE §1), not the ad-hoc #2563eb/#60a5fa the admin pages had drifted
 * onto. The engine room should read as part of the product it drives.
 */
export const accent = {
  main: "#38bdf8",
  /** For text/icons on dark: the main tone is bright enough to sit unaided. */
  dim: "#0d76a8",
  contrastText: "#04121c",
} as const;

/**
 * Status — mapped straight onto the product-wide severity ramp
 * (DESIGN_BIBLE §4.4, `shared/src/alerts/severity.ts`). Reusing it means an
 * admin "healthy/failed" chip and an on-air severity badge agree on what green
 * and red mean, and kills the #34d399/#4ade80/#f87171/#fbbf24 drift.
 */
export const status = {
  /** rank 1 — Minor */
  success: "#22c55e",
  /** rank 2 — Moderate */
  warning: "#eab308",
  /** rank 3 — Severe */
  severe: "#f97316",
  /** rank 4 — Extreme */
  error: "#ef4444",
  /** rank 0 — None/info */
  neutral: "#9ca3af",
} as const;

/** DESIGN_BIBLE §3 — system-native by design; no webfonts anywhere. */
export const font = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
} as const;

/** Flat + small — NOT the 10–14px glass-card radius of the broadcast layer. */
export const radius = 6;
