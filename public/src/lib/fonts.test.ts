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
import { FLAG_FAMILY, UI_SANS, UI_MONO } from "./fonts";

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
    // hijacking the HUD's ▸ ● ★ text glyphs.
    expect(CSS.match(/unicode-range: U\+1F1E6-1F1FF;/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("extends Saira and JetBrains Mono, the two families the chrome sets directly", () => {
    // GodsPanel's SANS/MONO replace the inherited stack, so the body font-family
    // alone would never reach a country card or the ACTIVE FEED.
    for (const family of ['font-family: "Saira"', 'font-family: "JetBrains Mono"']) {
      const block = CSS.slice(CSS.indexOf(family));
      expect(block).toContain("noto-color-emoji-flags.woff2");
      expect(block.slice(0, 400)).toContain("unicode-range: U+1F1E6-1F1FF");
    }
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

  it("across src/components/broadcast", () => {
    const offenders = walk(path.join(PKG, "src/components/broadcast")).filter((p) =>
      /fontFamily: "(system-ui|ui-monospace)/.test(fs.readFileSync(p, "utf8")),
    );
    expect(offenders.map((p) => path.relative(PKG, p))).toEqual([]);
  });
});
