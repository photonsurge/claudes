/**
 * The hazard vocabulary must reach the screen as vectors, never as the emoji
 * the shared model carries: the Chromium inside OBS has no emoji font, so a
 * raw `hazardMeta().icon` draws a .notdef box on air (the ACTIVE FEED row mark
 * did exactly that). `HAZARD_PATH` is an exhaustive Record, so a hazard added
 * to `shared` without a drawing is already a compile error — these cover what
 * types cannot: that each mark actually draws, and that no on-air component
 * quietly goes back to rendering the emoji.
 */
import fs from "fs";
import path from "path";
import { render } from "@testing-library/react";
import { HAZARDS } from "@photonsurge/shared/alerts/hazard";
import { HazardGlyph, type HazardGlyphId } from "./glyphs";

const IDS: HazardGlyphId[] = [...HAZARDS.map((h) => h.id), "quake"];

describe("HazardGlyph", () => {
  it.each(IDS)("draws a tinted vector mark for %s", (id) => {
    const { container } = render(<HazardGlyph id={id} color="#ff8800" size={22} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
    // Something is actually drawn, and it carries the hazard's colour.
    expect(svg!.children.length).toBeGreaterThan(0);
    expect(container.innerHTML).toContain("#ff8800");
  });

  it("covers every hazard in the shared vocabulary", () => {
    expect(IDS.length).toBe(HAZARDS.length + 1);
  });

  it("sizes to the caller's request", () => {
    const { container } = render(<HazardGlyph id="flood" color="#38bdf8" size={15} />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("15");
  });
});

/**
 * The guard that matters: an emoji string reaching the DOM is invisible in
 * jsdom and in the operator's Chrome, and only shows up on the stream.
 */
describe("no on-air component renders the hazard emoji", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });

  const SRC = path.join(__dirname, "..", "..");
  // The globe's badge layer still draws `meta.icon` into a deck SDF text atlas;
  // that surface needs its own icon-atlas pass, so it is named here rather than
  // silently passing.
  const KNOWN = ["components/layers/alerts.ts"];
  // `spec.icon` in MonitorCluster is deliberately absent from the pattern: it
  // already holds a ReactNode (<WindIcon/>, <GaugeIcon/>), not an emoji string.

  it("across the broadcast surface", () => {
    const files = [...walk(path.join(SRC, "components/broadcast")), ...walk(path.join(SRC, "components/layers"))];
    const offenders = files
      .filter((p) => /\{\s*(item|h|meta|segment)\.icon\s*\}|getText: \(b\) => b\.icon/.test(fs.readFileSync(p, "utf8")))
      .map((p) => path.relative(SRC, p));
    expect(offenders).toEqual(KNOWN);
  });
});
