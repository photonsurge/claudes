/**
 * The house rules adminTheme encodes, and the wiring that carries the tokens
 * into MUI.
 *
 * Worth testing because both rules are things MUI does BY DEFAULT and the theme
 * exists to switch off — a dark-mode Paper paints an elevation gradient, and the
 * default shadow ramp is 25 real shadows. Neither is visible in a diff once it
 * creeps back; both are §4.6 violations on the engine-room surface.
 */
import { accent, font, ink, radius, status, stroke, surface } from "./tokens";
import { adminTheme, makeAdminTheme } from "./adminTheme";

describe("adminTheme", () => {
  describe("flat by rule — no shadows, no gradients", () => {
    it("has no drop shadow at ANY elevation", () => {
      // Depth comes from the surface ramp + hairlines. All 25 rungs, because
      // MUI reaches for whichever one a component asks for.
      expect(adminTheme.shadows).toHaveLength(25);
      expect([...adminTheme.shadows]).toEqual(Array(25).fill("none"));
    });

    it("kills MUI's dark-mode elevation gradient on Paper", () => {
      // The default paints a `backgroundImage` onto every Paper in dark mode.
      const root = adminTheme.components?.MuiPaper?.styleOverrides?.root as { backgroundImage?: string };
      expect(root.backgroundImage).toBe("none");
    });

    it("defaults Paper to a real hairline instead of elevation", () => {
      expect(adminTheme.components?.MuiPaper?.defaultProps).toMatchObject({ elevation: 0, variant: "outlined" });
      const outlined = adminTheme.components?.MuiPaper?.styleOverrides?.outlined as Record<string, string>;
      expect(outlined).toMatchObject({ borderColor: stroke.line, backgroundColor: surface.panel });
    });

    it("keeps buttons flat too", () => {
      expect(adminTheme.components?.MuiButton?.defaultProps).toMatchObject({ disableElevation: true });
    });
  });

  describe("built from the tokens, not from hexes", () => {
    it("wires the surface ramp into the palette", () => {
      expect(adminTheme.palette.background).toMatchObject({ default: surface.page, paper: surface.panel });
    });

    it("wires ink and the hairline in", () => {
      expect(adminTheme.palette.divider).toBe(stroke.line);
      expect(adminTheme.palette.text).toMatchObject({
        primary: ink.primary,
        secondary: ink.secondary,
        disabled: ink.disabled,
      });
    });

    it("carries the severity ramp through to success/warning/error", () => {
      // tokens.test.ts pins status === SEVERITY_COLORS; this pins that the theme
      // actually SERVES those, so an admin chip and an on-air badge match.
      expect(adminTheme.palette.success.main).toBe(status.success);
      expect(adminTheme.palette.warning.main).toBe(status.warning);
      expect(adminTheme.palette.error.main).toBe(status.error);
    });

    it("uses the brand accent as primary, not an ad-hoc blue", () => {
      expect(adminTheme.palette.primary).toMatchObject({
        main: accent.main,
        dark: accent.dim,
        contrastText: accent.contrastText,
      });
    });

    it("takes its radius and font stacks from the tokens", () => {
      expect(adminTheme.shape.borderRadius).toBe(radius);
      expect(adminTheme.typography.fontFamily).toBe(font.sans);
    });

    it("is dark mode, because the whole ramp assumes it", () => {
      // Flipping this without retuning the tokens would put dark ink on dark panels.
      expect(adminTheme.palette.mode).toBe("dark");
    });
  });

  describe("dense by rule — an ops console, not a marketing page", () => {
    it.each([
      ["MuiButton", "small"],
      ["MuiChip", "small"],
      ["MuiTextField", "small"],
      ["MuiSelect", "small"],
      ["MuiTable", "small"],
    ])("defaults %s to the compact variant", (name, size) => {
      const defaults = adminTheme.components?.[name as "MuiButton"]?.defaultProps as { size?: string };
      expect(defaults?.size).toBe(size);
    });

    it("keeps buttons tappable despite being dense", () => {
      // Dense must not mean fiddly — 32px is the floor a mouse can still hit.
      const root = adminTheme.components?.MuiButton?.styleOverrides?.root as { minHeight?: number };
      expect(root.minHeight).toBeGreaterThanOrEqual(32);
    });
  });

  describe("the HUD voice", () => {
    it("sets readings in mono with tabular numbers", () => {
      // Clocks, magnitudes and byte counts must not jitter as digits change.
      const base = adminTheme.components?.MuiCssBaseline?.styleOverrides as Record<string, Record<string, string>>;
      expect(base["code, kbd, samp, pre"]).toMatchObject({
        fontFamily: font.mono,
        fontVariantNumeric: "tabular-nums",
      });
    });

    it("makes the smallest type the heaviest and widest-tracked", () => {
      // DESIGN_BIBLE §3 — what keeps an 11px label reading as intentional.
      const { overline, body1, h1 } = adminTheme.typography;
      expect(overline.fontSize).toBeLessThan(body1.fontSize as number);
      expect(overline.fontWeight).toBeGreaterThan(body1.fontWeight as number);
      expect(overline.letterSpacing).toBeGreaterThan(h1.letterSpacing as number);
      expect(overline.textTransform).toBe("uppercase");
    });

    it("descends h1 → h2 → h3 in size", () => {
      const { h1, h2, h3 } = adminTheme.typography;
      expect(h1.fontSize as number).toBeGreaterThan(h2.fontSize as number);
      expect(h2.fontSize as number).toBeGreaterThan(h3.fontSize as number);
    });

    it("does not SHOUT in buttons", () => {
      // MUI uppercases button labels by default; the bible doesn't.
      expect(adminTheme.typography.button.textTransform).toBe("none");
    });

    it("speaks the same HUD voice in table headers as in overline", () => {
      const head = adminTheme.components?.MuiTableCell?.styleOverrides?.head as Record<string, unknown>;
      expect(head).toMatchObject({ textTransform: "uppercase", backgroundColor: surface.raised, color: ink.secondary });
      expect(head.letterSpacing).toBe(adminTheme.typography.overline.letterSpacing);
    });
  });

  it("namespaces its CSS vars so they can't collide with /watch", () => {
    // /watch is a separate glass/gradient language. Asserting the GENERATED var
    // rather than the `cssVariables` input, because that's what actually reaches
    // the page — an unprefixed `--palette-*` would be the collision.
    const theme = adminTheme as unknown as { cssVarPrefix: string; vars: { palette: { background: { paper: string } } } };
    expect(theme.cssVarPrefix).toBe("adm");
    expect(theme.vars.palette.background.paper).toContain("--adm-");
  });

  describe("per-deployment page ground", () => {
    // Three boxes run one image; each washes the ground with its own colour so
    // the live console can't be mistaken for the test one (lib/instance.ts).
    it("takes a tinted ground without disturbing anything else", () => {
      const tinted = makeAdminTheme({ pageBg: "#231116" });

      expect(tinted.palette.background.default).toBe("#231116");
      // Cards are NOT tinted — the colour belongs to what's behind the console.
      expect(tinted.palette.background.paper).toBe(surface.panel);
      expect([...tinted.shadows]).toEqual(Array(25).fill("none"));
    });

    it("defaults to the house ground, so the untinted theme is unchanged", () => {
      expect(makeAdminTheme().palette.background.default).toBe(surface.page);
      expect(adminTheme.palette.background.default).toBe(surface.page);
    });
  });
});
