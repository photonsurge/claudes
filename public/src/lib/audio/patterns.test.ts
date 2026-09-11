import { mulberry32 } from "./rng";
import { BASSES, COMPS, DRUMS, fillFor, steps } from "./patterns";

describe("patterns", () => {
  it("parses masks into hits and ghosts", () => {
    expect(steps("x.o.", 0.8)).toEqual([
      { s: 0, v: 0.8 },
      { s: 2, v: 0.4 },
    ]);
    expect(steps("x", 0.5, 0.7)).toEqual([{ s: 0, v: 0.5, p: 0.7 }]);
  });

  it("keeps every hit inside the bar with sane velocities", () => {
    for (const bank of Object.values(DRUMS))
      for (const p of bank)
        for (const hits of Object.values(p.hits))
          for (const h of hits!) {
            expect(h.s >= 0 && h.s < 16).toBe(true);
            expect(h.v > 0 && h.v <= 1).toBe(true);
          }
    for (const bank of Object.values(BASSES))
      for (const p of bank)
        for (const n of p.notes) {
          expect(n.s >= 0 && n.s < 16).toBe(true);
          expect(n.len).toBeGreaterThan(0);
        }
    for (const bank of Object.values(COMPS)) for (const p of bank) expect(p.hits.length > 0 || p.sustain).toBe(true);
  });

  it("gives each groove section a choice of patterns", () => {
    for (const cls of ["lounge", "deep", "min", "breaks"] as const) {
      expect(DRUMS[cls].length).toBeGreaterThanOrEqual(2);
      expect(BASSES[cls].length).toBeGreaterThanOrEqual(2);
      expect(COMPS[cls].length).toBeGreaterThanOrEqual(2);
    }
  });

  it("builds fills: a light pickup keeps the kick, a big roll pulls it", () => {
    const rng = mulberry32(1);
    expect(fillFor("none", rng)).toEqual({ hits: {}, kickMuteFrom: 16 });
    expect(fillFor("light", rng).kickMuteFrom).toBe(16);
    const big = fillFor("big", rng);
    expect(big.kickMuteFrom).toBe(12);
    const vs = big.hits.snare!.filter((h) => h.s >= 12).map((h) => h.v);
    expect([...vs].sort((a, b) => a - b)).toEqual(vs); // roll rises into the downbeat
  });
});
