import { mulberry32 } from "./rng";
import { HOME_KEY, PROGRESSIONS, chordOn, chordPcs, keyName, modulate, pentatonic, pickProgression, scaleNote, voiceLead } from "./theory";

describe("theory", () => {
  it("names the home key A minor and builds its scale", () => {
    expect(keyName(HOME_KEY)).toBe("A minor");
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => scaleNote(HOME_KEY, i))).toEqual([45, 47, 48, 50, 52, 53, 55, 57]);
    expect(scaleNote(HOME_KEY, -1)).toBe(43); // G below the tonic
  });

  it("stacks sevenths by degree (i = Am7, VI = Fmaj7, dorian IV = D7)", () => {
    expect(chordPcs(HOME_KEY, 1)).toEqual([9, 0, 4, 7]);
    expect(chordPcs(HOME_KEY, 6)).toEqual([5, 9, 0, 4]);
    expect(chordPcs({ tonic: 45, mode: "dorian" }, 4)).toEqual([2, 6, 9, 0]);
  });

  it("reproduces the original A-minor pentatonic lead register", () => {
    expect(pentatonic(HOME_KEY)).toEqual([69, 72, 74, 76, 79, 81, 84, 86, 88, 91]);
  });

  it("voice-leads with minimal movement and stays in register", () => {
    const am = chordOn(HOME_KEY, 1, null);
    expect(am.notes.length).toBe(4);
    for (const n of am.notes) expect(n).toBeGreaterThanOrEqual(57);
    for (const n of am.notes) expect(n).toBeLessThanOrEqual(72);
    const f = chordOn(HOME_KEY, 6, am);
    const move = f.notes.reduce((s, n, i) => s + Math.abs(n - am.notes[i]), 0);
    expect(move).toBeLessThanOrEqual(6); // Am7 → Fmaj7 shares three notes
    expect(new Set(f.notes.map((n) => n % 12))).toEqual(new Set([5, 9, 0, 4]));
  });

  it("voiceLead never doubles a pitch class", () => {
    const v = voiceLead([0, 4, 7, 11], [60, 64, 67, 71], 57, 72);
    expect(new Set(v.map((n) => n % 12)).size).toBe(4);
  });

  it("has three 8-bar progressions per section, all on valid degrees", () => {
    for (const bank of Object.values(PROGRESSIONS)) {
      expect(bank.length).toBe(3);
      for (const p of bank) {
        expect(p.degrees.length).toBe(8);
        for (const d of p.degrees) expect(d >= 1 && d <= 7).toBe(true);
      }
    }
  });

  it("never repeats the previous progression when picking", () => {
    const rng = mulberry32(3);
    let prev = PROGRESSIONS.deep[0];
    for (let i = 0; i < 30; i++) {
      const next = pickProgression(rng, "deep", prev);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it("modulates within the bass window by related intervals", () => {
    const rng = mulberry32(11);
    let key = HOME_KEY;
    for (let i = 0; i < 50; i++) {
      const next = modulate(rng, key);
      expect(next.tonic).toBeGreaterThanOrEqual(40);
      expect(next.tonic).toBeLessThanOrEqual(51);
      const rel = (((next.tonic - key.tonic) % 12) + 12) % 12;
      expect([5, 7, 3, 10]).toContain(rel);
      key = next;
    }
  });
});
