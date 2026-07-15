/**
 * The admin palette's invariants — NOT its hex values.
 *
 * Asserting the colours back would just be a change-detector that fails every
 * time someone legitimately retunes the ramp. What's pinned here is what the
 * tokens PROMISE and what nothing else enforces: that the surface ramp actually
 * separates (the bug this palette was written to fix), that text on it is
 * legible, and that admin's status colours still agree with the on-air severity
 * ramp they claim to be reusing.
 */
import { SEVERITY_COLORS } from "@photonsurge/shared/alerts/severity";
import { accent, font, ink, radius, status, stroke, surface } from "./tokens";

/** WCAG relative luminance of a #rrggbb. */
function luminance(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
}

/** WCAG contrast ratio, 1 (identical) → 21 (black on white). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const HEX = /^#[0-9a-f]{6}$/;
const everyToken = Object.entries({ ...surface, ...stroke, ...ink, ...accent, ...status });

/**
 * The palette this one replaced, kept as the fixture it is: the thresholds below
 * are meaningless unless something pins what "too close together" actually was.
 */
const OLD_BUG = { page: "#0a0e16", card: "#0c111c", hairline: "#1b2030" } as const;

describe("admin tokens", () => {
  it("are all plain opaque hex", () => {
    // The ramp maths below (and every contrast promise built on it) assumes it.
    for (const [name, value] of everyToken) expect([name, HEX.test(value)]).toEqual([name, true]);
  });

  describe("surface ramp", () => {
    it("gets lighter from page to panel to raised", () => {
      expect(luminance(surface.page)).toBeLessThan(luminance(surface.panel));
      expect(luminance(surface.panel)).toBeLessThan(luminance(surface.raised));
    });

    it("separates page from panel enough that a card reads as an object", () => {
      // THE bug this palette replaced: the old #0a0e16 page and #0c111c card sat
      // within ~2% luminance, so panels never lifted off the page. The floor is
      // set BETWEEN the two — the old pair scores 1.023 and fails it, this one
      // scores 1.083 and passes — so a retune drifting back there breaks here
      // rather than shipping.
      expect(contrast(OLD_BUG.page, OLD_BUG.card)).toBeLessThan(1.05); // the palette we left
      expect(contrast(surface.page, surface.panel)).toBeGreaterThan(1.05);
    });

    it("separates panel from raised too, so a nested panel isn't invisible", () => {
      expect(contrast(surface.panel, surface.raised)).toBeGreaterThan(1.05);
    });

    it("sinks the wells below the page", () => {
      // Log tails and input wells read as cut INTO the page, not floated on it.
      expect(luminance(surface.sunken)).toBeLessThan(luminance(surface.page));
    });
  });

  describe("hairlines", () => {
    it("gives the workhorse line something to do against a panel", () => {
      // The other half of the old bug: a #1b2030 hairline on #0c111c was
      // near-invisible (1.165), so the ramp AND the stroke both failed to
      // divide. Same trick as the ramp — the floor sits between old and new.
      expect(contrast(OLD_BUG.hairline, OLD_BUG.card)).toBeLessThan(1.25);
      expect(contrast(stroke.line, surface.panel)).toBeGreaterThan(1.25);
    });

    it("makes lineStrong the more visible of the two", () => {
      expect(contrast(stroke.lineStrong, surface.panel)).toBeGreaterThan(contrast(stroke.line, surface.panel));
    });
  });

  describe("ink", () => {
    it("clears WCAG AA for body text on both page and panel", () => {
      // An ops console read for hours — this is the one that actually matters.
      expect(contrast(ink.primary, surface.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink.primary, surface.panel)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps secondary ink readable, not just dim", () => {
      // Secondary carries real content (timestamps, counts), so AA large-text
      // (3:1) is the floor — it's allowed to be quieter than primary, not unreadable.
      expect(contrast(ink.secondary, surface.panel)).toBeGreaterThanOrEqual(3);
      expect(contrast(ink.secondary, surface.panel)).toBeLessThan(contrast(ink.primary, surface.panel));
    });

    it("descends in emphasis primary → secondary → disabled", () => {
      expect(contrast(ink.secondary, surface.panel)).toBeGreaterThan(contrast(ink.disabled, surface.panel));
    });
  });

  describe("accent", () => {
    it("is legible as text on a panel without help", () => {
      // The comment claims "bright enough to sit unaided" — that's a testable claim.
      expect(contrast(accent.main, surface.panel)).toBeGreaterThanOrEqual(4.5);
    });

    it("carries text on a filled accent button", () => {
      // contrastText lands on `main` (filled chips/buttons), so this pair is the
      // one that has to clear AA — not contrastText against the page.
      expect(contrast(accent.contrastText, accent.main)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("status", () => {
    it("IS the on-air severity ramp, rank for rank", () => {
      // The whole point of the mapping: an admin "failed" chip and a broadcast
      // severity badge must agree on what red means. Nothing but this test stops
      // the two drifting back apart (the old #34d399/#f87171/#fbbf24 problem) —
      // tokens.ts restates the values rather than importing them.
      expect(status.neutral).toBe(SEVERITY_COLORS[0]);
      expect(status.success).toBe(SEVERITY_COLORS[1]);
      expect(status.warning).toBe(SEVERITY_COLORS[2]);
      expect(status.severe).toBe(SEVERITY_COLORS[3]);
      expect(status.error).toBe(SEVERITY_COLORS[4]);
    });

    it("keeps every status legible on a panel", () => {
      // A red that fails here is a failure an operator can't read at a glance.
      for (const [name, value] of Object.entries(status)) {
        expect([name, contrast(value, surface.panel) >= 3]).toEqual([name, true]);
      }
    });

    it("keeps success and error apart for more than just hue", () => {
      // Red/green is the one pair a colour-blind operator can't split by hue, so
      // they must not also be the same brightness.
      expect(Math.abs(luminance(status.success) - luminance(status.error))).toBeGreaterThan(0.05);
    });
  });

  describe("house rules", () => {
    it("ships no webfonts — system stacks only", () => {
      expect(font.sans).not.toMatch(/url\(|@import/);
      expect(font.mono).not.toMatch(/url\(|@import/);
    });

    it("ends both stacks in a generic family", () => {
      // If every named font misses, the browser must still land somewhere sane.
      expect(font.sans.trim()).toMatch(/sans-serif$/);
      expect(font.mono.trim()).toMatch(/monospace$/);
    });

    it("stays flat and small — not the broadcast layer's glass radius", () => {
      expect(radius).toBeLessThan(10);
    });
  });
});
