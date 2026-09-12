import { ALL_STEMS, BPM_RANGE, type Phrase, type Track, phraseLabel, planPhrase, planTrack, trackLabel } from "./arranger";
import { BASSES, COMPS, DRUMS } from "./patterns";
import { mulberry32 } from "./rng";
import { PROGRESSIONS, PROGRESSIONS_MAJOR, keyName } from "./theory";

type Cls = "deep" | "chill" | "breaks" | "min" | "lounge";

/** Run the planner the way the engine does: tracks of N phrases, each opening with an intro. */
const run = (seed: number, n: number, cls: Cls = "deep"): { phrases: Phrase[]; tracks: Track[] } => {
  const rng = mulberry32(seed);
  const phrases: Phrase[] = [];
  const tracks: Track[] = [];
  let prev: Phrase | null = null;
  let track: Track | null = null;
  let left = 0;
  for (let i = 0; i < n; i++) {
    let newTrack = false;
    if (!track || left === 0) {
      track = planTrack(rng, cls, track);
      tracks.push(track);
      left = track.phrases;
      newTrack = true;
    }
    prev = planPhrase(rng, cls, prev, { newTrack, key: track.key });
    phrases.push(prev);
    left--;
  }
  return { phrases, tracks };
};

describe("planTrack", () => {
  it("draws tempo from the section range and always moves to a new key", () => {
    const rng = mulberry32(2);
    let prev: Track | null = null;
    for (const cls of ["chill", "lounge", "deep", "min", "breaks"] as const) {
      for (let i = 0; i < 20; i++) {
        const t = planTrack(rng, cls, prev);
        const [lo, hi] = BPM_RANGE[cls];
        expect(t.bpm).toBeGreaterThanOrEqual(lo);
        expect(t.bpm).toBeLessThanOrEqual(hi);
        expect(t.phrases).toBeGreaterThanOrEqual(5);
        expect(t.phrases).toBeLessThanOrEqual(9);
        if (prev) {
          expect(t.n).toBe(prev.n + 1);
          expect(keyName(t.key)).not.toBe(keyName(prev.key));
        }
        prev = t;
      }
    }
  });

  it("varies the flavours that give a track its identity", () => {
    const { tracks } = run(4, 400, "deep");
    expect(new Set(tracks.map((t) => t.kick)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(tracks.map((t) => t.pad)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(tracks.map((t) => t.bass)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(tracks.map((t) => t.voicing)).size).toBe(3);
    expect(new Set(tracks.map((t) => t.bpm)).size).toBeGreaterThanOrEqual(4);
    expect(trackLabel(tracks[0])).toMatch(/^track 1 · \d+ bpm · \w+ kick · \w+ pad · \w+ bass · (7ths|triads|shells)$/);
  });
});

describe("planPhrase", () => {
  it("opens every track with an 8-bar intro in the track's key, the first one in A minor", () => {
    const { phrases, tracks } = run(1, 40);
    expect(phrases[0].role).toBe("intro");
    expect(phrases[0].bars).toBe(8);
    expect(keyName(phrases[0].key)).toBe("A minor");
    let i = 0;
    for (const t of tracks) {
      expect(phrases[i].role).toBe("intro");
      expect(keyName(phrases[i].key)).toBe(keyName(t.key));
      i += t.phrases;
      if (i >= phrases.length) break;
    }
  });

  it("follows the role graph and valid phrase lengths", () => {
    const allowed: Record<Phrase["role"], Phrase["role"][]> = {
      intro: ["main"],
      main: ["main", "build", "break", "interlude", "intro"],
      build: ["main", "intro"],
      break: ["build", "main", "intro"],
      interlude: ["main", "intro"],
    };
    for (const seed of [2, 3, 4]) {
      const { phrases } = run(seed, 80);
      for (let i = 1; i < phrases.length; i++) expect(allowed[phrases[i - 1].role]).toContain(phrases[i].role);
      for (const p of phrases) expect([8, 16, 32]).toContain(p.bars);
    }
  });

  it("picks patterns from the section's own banks and never repeats them back to back", () => {
    const { phrases } = run(5, 40);
    for (let i = 0; i < phrases.length; i++) {
      const p = phrases[i];
      expect(DRUMS.deep).toContain(p.drums);
      expect(BASSES.deep).toContain(p.bass);
      expect(COMPS.deep).toContain(p.comp);
      expect([...PROGRESSIONS.deep, ...PROGRESSIONS_MAJOR.deep]).toContain(p.progression);
      if (i) {
        expect(p.drums).not.toBe(phrases[i - 1].drums);
        expect(p.progression).not.toBe(phrases[i - 1].progression);
      }
    }
  });

  it("uses the major bank in major keys and the minor bank otherwise", () => {
    const { phrases } = run(7, 300);
    for (const p of phrases) {
      const major = p.key.mode === "ionian";
      expect((major ? PROGRESSIONS_MAJOR : PROGRESSIONS).deep).toContain(p.progression);
    }
    expect(phrases.some((p) => p.key.mode === "ionian")).toBe(true);
  });

  it("actually varies: many keys, every progression, every patch, interludes and builds", () => {
    const { phrases } = run(7, 300);
    expect(new Set(phrases.map((p) => keyName(p.key))).size).toBeGreaterThanOrEqual(6);
    expect(new Set(phrases.filter((p) => p.key.mode !== "ionian").map((p) => p.progression.name)).size).toBe(5);
    expect(new Set(phrases.map((p) => p.keysPatch)).size).toBe(3);
    expect(phrases.some((p) => p.role === "interlude")).toBe(true);
    expect(phrases.some((p) => p.transition === "riser")).toBe(true);
    expect(phrases.some((p) => p.fill === "big")).toBe(true);
  });

  it("never modulates two phrases in a row, nor straight out of a track's intro", () => {
    const { phrases } = run(9, 300);
    for (let i = 1; i < phrases.length; i++) {
      expect(phrases[i].modulated && phrases[i - 1].modulated).toBe(false);
      if (phrases[i - 1].role === "intro") expect(keyName(phrases[i].key)).toBe(keyName(phrases[i - 1].key));
    }
  });

  it("shapes layers by role, and main phrases vary their stem subset", () => {
    const { phrases } = run(11, 400);
    const byRole = (r: Phrase["role"]) => phrases.filter((p) => p.role === r);
    for (const p of byRole("intro")) expect(p.layers.has("kick") || p.layers.has("bass")).toBe(false);
    for (const p of byRole("build")) {
      expect(p.layers.has("kick")).toBe(false);
      expect(p.fill).toBe("big");
      expect(p.transition).toBe("riser");
    }
    for (const p of byRole("break")) for (const s of ["kick", "bass", "perc"] as const) expect(p.layers.has(s)).toBe(false);
    for (const p of byRole("interlude")) {
      expect(p.layers.has("kick")).toBe(false);
      expect(p.leadPatch).toBe("bell");
    }
    const mains = byRole("main");
    for (const p of mains) {
      expect(p.layers.has("kick")).toBe(true); // deep mains always have the kick
      expect(p.layers.size).toBeGreaterThanOrEqual(3);
    }
    const subsets = new Set(mains.map((p) => [...p.layers].sort().join(",")));
    expect(subsets.size).toBeGreaterThan(5);
    expect(mains.some((p) => p.layers.size === ALL_STEMS.length)).toBe(true);
    expect(mains.some((p) => !p.layers.has("pad"))).toBe(true);
  });

  it("labels a phrase for the lab readout", () => {
    const { phrases } = run(1, 1);
    expect(phraseLabel(phrases[0])).toMatch(/^intro · 8 bars · \w[\w ]* · A minor$/);
  });
});
