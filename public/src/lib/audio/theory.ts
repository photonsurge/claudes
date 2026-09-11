/**
 * Music theory for the bed: keys and modes, chords built by scale degree,
 * voice-led voicings, the per-section progression banks and key modulation.
 * Pure functions — the engine only turns the results into oscillators.
 */
import { type Rng, chance, pickOther, pickWeighted } from "./rng";

export type ModeName = "aeolian" | "dorian";
export const SCALES: Record<ModeName, readonly number[]> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** `tonic` is the MIDI note of the bass-register tonic (45 = A1). */
export interface Key {
  tonic: number;
  mode: ModeName;
}
export const HOME_KEY: Key = { tonic: 45, mode: "aeolian" };
/** Bass tonics stay inside this window so the sub never wanders out of register. */
const TONIC_LO = 40;
const TONIC_HI = 51;

export const keyName = (k: Key): string => `${NOTE_NAMES[k.tonic % 12]} ${k.mode === "dorian" ? "dorian" : "minor"}`;

/** Scale note for a 0-based degree index; indices beyond 0..6 wrap through octaves. */
export function scaleNote(key: Key, idx: number): number {
  const sc = SCALES[key.mode];
  return key.tonic + Math.floor(idx / 7) * 12 + sc[((idx % 7) + 7) % 7];
}

export interface Chord {
  /** 1-based scale degree (1 = tonic chord). */
  degree: number;
  /** Bass-register root. */
  root: number;
  /** Chord pitch classes (0..11). */
  pcs: number[];
  /** Voiced notes for the keys/pad register, low to high. */
  notes: number[];
}

/** Seventh chord on a degree: thirds stacked within the scale, as pitch classes. */
export function chordPcs(key: Key, degree: number): number[] {
  return [0, 2, 4, 6].map((k) => ((scaleNote(key, degree - 1 + k) % 12) + 12) % 12);
}

/**
 * Place the chord's pitch classes in [lo, hi] with the least total movement
 * from the previous voicing (smooth voice leading); with no previous voicing,
 * sit as close to the middle of the register as possible.
 */
export function voiceLead(pcs: number[], prev: number[] | null, lo: number, hi: number): number[] {
  const options = pcs.map((pc) => {
    const out: number[] = [];
    for (let n = lo; n <= hi; n++) if (n % 12 === pc) out.push(n);
    return out;
  });
  const centre = (lo + hi) / 2;
  let best: number[] | null = null;
  let bestCost = Infinity;
  const walk = (i: number, acc: number[]) => {
    if (i === options.length) {
      const v = [...acc].sort((a, b) => a - b);
      if (new Set(v).size !== v.length) return;
      const span = v[v.length - 1] - v[0];
      let cost = span > 14 ? (span - 14) * 3 : 0;
      if (prev) {
        const p = [...prev].sort((a, b) => a - b);
        for (let k = 0; k < v.length; k++) cost += Math.abs(v[k] - (p[Math.min(k, p.length - 1)] ?? centre));
      } else {
        for (const n of v) cost += Math.abs(n - centre) * 0.5;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
      return;
    }
    for (const n of options[i]) walk(i + 1, [...acc, n]);
  };
  walk(0, []);
  return best ?? pcs.map((pc) => lo + ((pc - lo + 120) % 12));
}

/** The chord on `degree`, voiced after `prev` (or freshly) in the keys register. */
export function chordOn(key: Key, degree: number, prev: Chord | null): Chord {
  const pcs = chordPcs(key, degree);
  const lo = key.tonic + 12;
  const notes = voiceLead(pcs, prev?.notes ?? null, lo, lo + 15);
  return { degree, root: scaleNote(key, degree - 1), pcs, notes };
}

/** Minor pentatonic over two octaves in the lead register (A1 tonic → A4..G6). */
export function pentatonic(key: Key): number[] {
  const base = key.tonic + 24;
  return [0, 3, 5, 7, 10, 12, 15, 17, 19, 22].map((i) => base + i);
}

export interface Progression {
  name: string;
  /** One 1-based degree per bar; repeats mean the chord holds. */
  degrees: number[];
}

export type SectionCls = "chill" | "lounge" | "deep" | "min" | "breaks";

export const PROGRESSIONS: Record<SectionCls, Progression[]> = {
  chill: [
    { name: "drift", degrees: [1, 1, 6, 6, 3, 7, 4, 5] },
    { name: "hymn", degrees: [1, 6, 3, 7, 1, 6, 3, 7] },
    { name: "still", degrees: [1, 1, 4, 4, 1, 1, 6, 7] },
  ],
  lounge: [
    { name: "circle", degrees: [1, 4, 7, 3, 6, 2, 5, 1] },
    { name: "sway", degrees: [1, 1, 4, 4, 6, 6, 5, 5] },
    { name: "late", degrees: [1, 7, 6, 7, 1, 7, 4, 5] },
  ],
  deep: [
    { name: "vamp", degrees: [1, 1, 6, 7, 1, 1, 6, 7] },
    { name: "roll", degrees: [1, 7, 6, 7, 1, 7, 4, 7] },
    { name: "plateau", degrees: [1, 1, 4, 4, 1, 1, 6, 6] },
  ],
  min: [
    { name: "drone", degrees: [1, 1, 1, 1, 1, 1, 4, 1] },
    { name: "lift", degrees: [1, 1, 1, 1, 6, 6, 1, 1] },
    { name: "pulse", degrees: [1, 7, 1, 7, 1, 7, 6, 7] },
  ],
  breaks: [
    { name: "surge", degrees: [1, 6, 7, 1, 1, 6, 7, 5] },
    { name: "climb", degrees: [1, 3, 7, 6, 1, 3, 7, 6] },
    { name: "storm", degrees: [1, 1, 6, 7, 1, 1, 4, 5] },
  ],
};

/** Pick a progression for the section, never the one just played. */
export function pickProgression(rng: Rng, cls: SectionCls, prev: Progression | null): Progression {
  return pickOther(rng, PROGRESSIONS[cls], prev);
}

/**
 * Move to a related key: up/down a fourth or fifth mostly, a minor third now
 * and then, folded back into the bass window; the mode flips occasionally so
 * the IV chord turns major (dorian) or back.
 */
export function modulate(rng: Rng, key: Key): Key {
  const step = pickWeighted(rng, [
    [5, 3],
    [7, 3],
    [-5, 2],
    [-7, 2],
    [3, 1],
    [-2, 1],
  ] as const);
  let tonic = key.tonic + step;
  while (tonic < TONIC_LO) tonic += 12;
  while (tonic > TONIC_HI) tonic -= 12;
  const mode: ModeName = chance(rng, 0.3) ? (key.mode === "aeolian" ? "dorian" : "aeolian") : key.mode;
  return { tonic, mode };
}
