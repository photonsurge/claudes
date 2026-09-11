import { ALL_STEMS, type Phrase, phraseLabel, planPhrase } from "./arranger";
import { BASSES, COMPS, DRUMS } from "./patterns";
import { mulberry32 } from "./rng";
import { PROGRESSIONS, keyName } from "./theory";

const run = (seed: number, n: number, cls: "deep" | "chill" | "breaks" | "min" | "lounge" = "deep"): Phrase[] => {
  const rng = mulberry32(seed);
  const out: Phrase[] = [];
  let prev: Phrase | null = null;
  for (let i = 0; i < n; i++) {
    prev = planPhrase(rng, cls, prev);
    out.push(prev);
  }
  return out;
};

describe("planPhrase", () => {
  it("opens with an 8-bar intro in the home key, then moves into a main phrase", () => {
    const [a, b] = run(1, 2);
    expect(a.role).toBe("intro");
    expect(a.bars).toBe(8);
    expect(keyName(a.key)).toBe("A minor");
    expect(b.role).toBe("main");
  });

  it("follows the role graph and valid phrase lengths", () => {
    const allowed = { intro: ["main"], main: ["main", "build", "break"], build: ["main"], break: ["build", "main"] };
    for (const seed of [2, 3, 4]) {
      const ps = run(seed, 60);
      for (let i = 1; i < ps.length; i++) expect(allowed[ps[i - 1].role]).toContain(ps[i].role);
      for (const p of ps) expect([8, 16, 32]).toContain(p.bars);
    }
  });

  it("picks patterns from the section's own banks and never repeats them back to back", () => {
    const ps = run(5, 40);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      expect(DRUMS.deep).toContain(p.drums);
      expect(BASSES.deep).toContain(p.bass);
      expect(COMPS.deep).toContain(p.comp);
      expect(PROGRESSIONS.deep).toContain(p.progression);
      if (i) {
        expect(p.drums).not.toBe(ps[i - 1].drums);
        expect(p.progression).not.toBe(ps[i - 1].progression);
      }
    }
  });

  it("actually varies: several keys and every progression over a long run", () => {
    const ps = run(7, 200);
    expect(new Set(ps.map((p) => keyName(p.key))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(ps.map((p) => p.progression.name)).size).toBe(3);
    expect(new Set(ps.map((p) => p.keysPatch)).size).toBeGreaterThanOrEqual(2);
    expect(ps.some((p) => p.transition === "riser")).toBe(true);
    expect(ps.some((p) => p.fill === "big")).toBe(true);
  });

  it("never modulates two phrases in a row", () => {
    const ps = run(9, 300);
    for (let i = 1; i < ps.length; i++) expect(ps[i].modulated && ps[i - 1].modulated).toBe(false);
  });

  it("shapes layers by role: intros are sparse, builds drop the kick, breaks drop the rhythm section", () => {
    const ps = run(11, 300);
    const byRole = (r: Phrase["role"]) => ps.filter((p) => p.role === r);
    for (const p of byRole("intro")) expect(p.layers.has("kick") || p.layers.has("bass")).toBe(false);
    for (const p of byRole("build")) {
      expect(p.layers.has("kick")).toBe(false);
      expect(p.fill).toBe("big");
      expect(p.transition).toBe("riser");
    }
    for (const p of byRole("break")) for (const s of ["kick", "bass", "perc"] as const) expect(p.layers.has(s)).toBe(false);
    for (const p of byRole("main")) expect(p.layers.size).toBe(ALL_STEMS.length);
  });

  it("labels a phrase for the lab readout", () => {
    const [p] = run(1, 1);
    expect(phraseLabel(p)).toMatch(/^intro · 8 bars · \w+ · A minor$/);
  });
});
