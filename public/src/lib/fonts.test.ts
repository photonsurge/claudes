/**
 * Flags on air must not depend on the encoder box's system fonts.
 *
 * The bug these guard: country flags are regional-indicator emoji, and the
 * Chromium inside OBS ships no font covering U+1F1E6-1F1FF — so every flag
 * rendered as two .notdef boxes on the stream while the operator's Chrome
 * showed them correctly. The fix is a self-hosted subset; these tests pin the
 * three things that have to stay true for it to keep working.
 */
import fs from "fs";
import path from "path";
import { FLAG_FAMILY, UI_SANS, UI_MONO, BRAND_SANS, BRAND_MONO } from "./fonts";

const PKG = path.join(__dirname, "..", "..");
const CSS = fs.readFileSync(path.join(PKG, "src/app/globals.css"), "utf8");
const FONT_FILE = path.join(PKG, "public/fonts/noto-color-emoji-flags.woff2");

/** The flag face has to WIN, so it leads every stack. */
describe("UI font stacks", () => {
  it("lead with the flag family", () => {
    expect(UI_SANS.startsWith(FLAG_FAMILY)).toBe(true);
    expect(UI_MONO.startsWith(FLAG_FAMILY)).toBe(true);
  });

  it("keep the original fallbacks behind it, so ordinary text is unchanged", () => {
    expect(UI_SANS).toContain("system-ui, sans-serif");
    expect(UI_MONO).toContain("monospace");
  });
});

describe("the self-hosted flag face", () => {
  it("ships as a real woff2 in the served static dir", () => {
    expect(fs.existsSync(FONT_FILE)).toBe(true);
    // wOF2 magic — a truncated or LFS-pointer file would still "exist".
    expect(fs.readFileSync(FONT_FILE).subarray(0, 4).toString("latin1")).toBe("wOF2");
  });

  it("is declared over the regional-indicator range only", () => {
    expect(CSS).toContain(`font-family: ${FLAG_FAMILY}`);
    expect(CSS).toContain('src: url("/fonts/noto-color-emoji-flags.woff2")');
    // Scoping to the flag block is what stops a colour emoji face from
    // hijacking the HUD's ▸ ● ★ text glyphs, so EVERY face declared here has to
    // carry the range — an unscoped one would swallow those.
    const faces = CSS.match(/@font-face\s*\{/g)?.length ?? 0;
    expect(faces).toBeGreaterThanOrEqual(1);
    expect(CSS.match(/unicode-range: U\+1F1E6-1F1FF;/g)?.length).toBe(faces);
  });

  /**
   * The inverse of what this file used to assert. Re-declaring `Saira` /
   * `JetBrains Mono` over the flag range looked like the elegant fix — extend
   * the two families the chrome names directly and no call site changes. It is
   * dead code at best and actively misleading at worst: the Google Fonts
   * stylesheet declares both families at exact weights, so Blink matches weight
   * first, lands on Google's latin face, finds no flag glyph and moves to the
   * next FAMILY rather than to our face. The face never even loads.
   */
  it("does NOT try to extend Saira or JetBrains Mono (that silently fails here)", () => {
    expect(CSS).not.toContain('font-family: "Saira"');
    expect(CSS).not.toContain('font-family: "JetBrains Mono"');
  });

  it("is what the broadcast type ramp leads with", () => {
    // GodsPanel's SANS/MONO replace the inherited stack, so the body font-family
    // alone would never reach a country card or the ACTIVE FEED.
    expect(BRAND_SANS.startsWith(FLAG_FAMILY)).toBe(true);
    expect(BRAND_MONO.startsWith(FLAG_FAMILY)).toBe(true);
    // …and the real faces still follow it, so ordinary text is unchanged.
    expect(BRAND_SANS).toContain("Saira");
    expect(BRAND_MONO).toContain("JetBrains Mono");
  });
});

/**
 * A bare `system-ui` stack anywhere on the broadcast surface silently
 * reintroduces the bug for any flag that lands in it, so the whole on-air tree
 * has to go through lib/fonts.
 */
describe("no on-air component hard-codes a flagless stack", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });

  /**
   * Every literal stack assigned to fontFamily, however it is line-wrapped.
   * The original form of this test matched `fontFamily: "system-ui` on one
   * line, so WorldClockStrip's
   *
   *     fontFamily:
   *       "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
   *
   * sat on the broadcast surface unnoticed — Prettier had wrapped it past the
   * regex. Allowing whitespace (newlines included) after the colon is what
   * closes that, and naming the covered families rather than the two known-bad
   * ones makes any NEW flagless stack an offender too.
   */
  const LITERAL_STACK = /fontFamily:\s*"([^"]+)"/g;
  /** A stack is fine only if the flag family LEADS it. Naming Saira is not
   *  enough — that is exactly the stack that drew boxes on air. */
  const COVERED = /^"?Noto Color Emoji Flags"?,/;

  it("across src/components/broadcast", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(PKG, "src/components/broadcast"))) {
      const src = fs.readFileSync(file, "utf8");
      for (const [, stack] of src.matchAll(LITERAL_STACK)) {
        if (!COVERED.test(stack)) offenders.push(`${path.relative(PKG, file)}: ${stack}`);
      }
    }
    // Route it through lib/fonts (UI_SANS / UI_MONO) or GodsPanel's SANS / MONO.
    expect(offenders).toEqual([]);
  });
});
