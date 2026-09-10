import { createTheme } from "@mui/material/styles";
import { accent, font, ink, radius, status, stroke, surface } from "./tokens";

/**
 * The MUI theme for /admin. Built entirely from ./tokens so there's one place
 * to change the engine-room look.
 *
 * Scoped to /admin only (see app/admin/layout.tsx). /watch must never mount
 * this — the broadcast surface is a deliberately separate glass/gradient
 * language (DESIGN_BIBLE §2) and shouldn't pay emotion's runtime cost while
 * it's driving a WebGL globe.
 *
 * Two house rules encoded below, both from the bible:
 *  - No gradients. MUI's dark mode paints an elevation `backgroundImage`
 *    gradient onto every Paper; §4.6 forbids that here, so it's turned off and
 *    panels are separated by a real hairline instead.
 *  - Dense. This is an ops console read for hours, not a marketing page, so
 *    the defaults are the compact variants throughout.
 *
 * A FACTORY, not a constant, because of one knob: `pageBg`. The console runs on
 * three boxes off one image (this laptop, the test box, the live box) and
 * looked identical on all of them; each deployment now washes its page ground
 * with its own colour (lib/instance.ts), and that colour is a RUNTIME value, so
 * the theme is built per request rather than frozen at module load. Only the
 * ground is tinted — cards keep `surface.panel` exactly as designed, so the
 * tint reads as what's BEHIND the console rather than recolouring every panel
 * on it. `adminTheme` at the bottom is this with the house ground.
 */
export const makeAdminTheme = ({ pageBg = surface.page }: { pageBg?: string } = {}) =>
  createTheme({
    cssVariables: { cssVarPrefix: "adm" },

    palette: {
      mode: "dark",
      primary: { main: accent.main, dark: accent.dim, contrastText: accent.contrastText },
      background: { default: pageBg, paper: surface.panel },
      divider: stroke.line,
      text: { primary: ink.primary, secondary: ink.secondary, disabled: ink.disabled },
      success: { main: status.success },
      warning: { main: status.warning },
      error: { main: status.error },
      info: { main: accent.main },
    },

    shape: { borderRadius: radius },

    // Flat engine room: no drop shadows at all. Depth comes from the
    // page/panel/raised surface ramp + hairlines, never from a shadow.
    shadows: Array(25).fill("none") as unknown as never,

    typography: {
      fontFamily: font.sans,
      // DESIGN_BIBLE §3: the smaller the text, the heavier the weight and the
      // wider the tracking — that's what keeps an 11px label reading as
      // intentional rather than as a bug.
      h1: { fontSize: 24, fontWeight: 700, letterSpacing: 0, lineHeight: 1.15 },
      h2: { fontSize: 18, fontWeight: 700, letterSpacing: 0.2, lineHeight: 1.2 },
      h3: { fontSize: 15, fontWeight: 700, letterSpacing: 0.2, lineHeight: 1.3 },
      body1: { fontSize: 14, lineHeight: 1.5 },
      body2: { fontSize: 13, lineHeight: 1.45 },
      caption: { fontSize: 12, lineHeight: 1.4 },
      /** The HUD "chrome" voice — section labels, column groups, eyebrows. */
      overline: { fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", lineHeight: 1.4 },
      button: { fontSize: 13, fontWeight: 600, letterSpacing: 0.2, textTransform: "none" },
    },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Readings (clocks, magnitudes, IDs, byte counts) are set in mono with
          // tabular numbers — see DESIGN_BIBLE §3. `<code>` gets it for free.
          "code, kbd, samp, pre": { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" },
          "::selection": { background: accent.dim, color: ink.primary },
        },
      },

      MuiPaper: {
        defaultProps: { elevation: 0, variant: "outlined" },
        styleOverrides: {
          // Kill MUI's dark-mode elevation gradient — §4.6 is flat.
          root: { backgroundImage: "none" },
          outlined: { borderColor: stroke.line, backgroundColor: surface.panel },
        },
      },

      MuiButton: {
        defaultProps: { disableElevation: true, size: "small" },
        styleOverrides: {
          // §5.6: flat, quiet, no shadow, no gradient.
          root: { minHeight: 32 },
          outlined: { borderColor: stroke.lineStrong, color: ink.primary, "&:hover": { borderColor: accent.main, backgroundColor: surface.raised } },
        },
      },

      MuiChip: {
        defaultProps: { size: "small", variant: "outlined" },
        styleOverrides: {
          root: { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, height: 20, borderRadius: 4 },
          outlined: { borderColor: stroke.lineStrong },
          label: { paddingInline: 6 },
        },
      },

      MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { backgroundColor: surface.sunken, "& fieldset": { borderColor: stroke.lineStrong } },
          input: { fontSize: 13 },
        },
      },
      MuiSelect: { defaultProps: { size: "small" } },

      MuiTable: { defaultProps: { size: "small" } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: stroke.line, paddingBlock: 7 },
          head: {
            // Column headers speak the same HUD voice as section labels.
            backgroundColor: surface.raised,
            color: ink.secondary,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          },
        },
      },
      MuiTableRow: { styleOverrides: { root: { "&:hover": { backgroundColor: surface.raised } } } },

      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: surface.raised, border: `1px solid ${stroke.lineStrong}`, fontSize: 12, borderRadius: radius },
        },
      },
      MuiLink: { defaultProps: { underline: "hover" }, styleOverrides: { root: { color: accent.main } } },
      MuiDivider: { styleOverrides: { root: { borderColor: stroke.line } } },
      MuiAlert: { defaultProps: { variant: "outlined" }, styleOverrides: { root: { fontSize: 13, borderRadius: radius } } },
    },
  });

/** The default theme — the untinted house ground. */
export const adminTheme = makeAdminTheme();
