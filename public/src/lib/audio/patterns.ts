/**
 * Pattern banks for the bed: drums, bass lines and chord comping as 16-step
 * masks per section, plus end-of-phrase fills. Pure data + tiny helpers; the
 * arranger picks from these per phrase so no two phrases groove the same.
 */
import type { SectionCls } from "./theory";
import { type Rng, chance } from "./rng";

export interface Hit {
  /** 16th-note step in the bar, 0..15. */
  s: number;
  /** Velocity 0..1. */
  v: number;
  /** Probability the hit plays (default 1). */
  p?: number;
}

/** Mask → hits: `x` = hit at v, `o` = ghost at v/2, anything else = rest. */
export function steps(mask: string, v: number, p?: number): Hit[] {
  const out: Hit[] = [];
  for (let s = 0; s < Math.min(16, mask.length); s++) {
    if (mask[s] === "x") out.push(p ? { s, v, p } : { s, v });
    else if (mask[s] === "o") out.push(p ? { s, v: v / 2, p } : { s, v: v / 2 });
  }
  return out;
}

export type DrumVoice = "kick" | "snare" | "clap" | "rim" | "hatC" | "hatO" | "shaker" | "ride";
export type DrumHits = Partial<Record<DrumVoice, Hit[]>>;

export interface DrumPattern {
  name: string;
  hits: DrumHits;
}

const FOUR = "x...x...x...x...";
const OFF = "..x...x...x...x.";
const BACK = "....x.......x...";

export const DRUMS: Record<SectionCls, DrumPattern[]> = {
  chill: [{ name: "brush", hits: { shaker: steps("...x...x...x...x", 0.25, 0.6), rim: steps("........x.......", 0.3) } }],
  lounge: [
    { name: "halftime", hits: { kick: steps("x.......x.......", 0.8), hatC: steps(OFF, 0.5), rim: steps(BACK, 0.4) } },
    { name: "soft four", hits: { kick: steps(FOUR, 0.78), hatO: steps(OFF, 0.5), shaker: steps("...x...x...x...x", 0.3) } },
    { name: "skip", hits: { kick: steps("x...x...x.x.x...", 0.8), hatC: steps(OFF, 0.55), shaker: steps("..x...x...x...x.", 0.25, 0.7) } },
  ],
  deep: [
    {
      name: "classic",
      hits: { kick: steps(FOUR, 0.92), clap: steps(BACK, 0.55), hatO: steps(OFF, 0.6), hatC: steps("x.x.x.x.x.x.x.x.", 0.3, 0.7), shaker: steps("...x...x...x...x", 0.4) },
    },
    {
      name: "shuffle",
      hits: { kick: steps(FOUR, 0.92), hatC: steps("x.xxx.xxx.xxx.xx", 0.32, 0.8), hatO: steps(OFF, 0.55), rim: steps("...x..x....x..x.", 0.45), clap: steps(BACK, 0.5) },
    },
    {
      name: "sparse",
      hits: { kick: steps(FOUR, 0.9), hatO: steps("..x.......x.....", 0.6), hatC: steps("....x...x...x...", 0.3), clap: steps("............x...", 0.55), shaker: steps("xxxxxxxxxxxxxxxx", 0.18, 0.6) },
    },
  ],
  min: [
    {
      name: "drive",
      hits: { kick: steps(FOUR, 0.95), hatC: steps("x.x.x.x.x.x.x.x.", 0.35), hatO: steps(OFF, 0.6), clap: steps(BACK, 0.5), ride: steps(FOUR, 0.25, 0.5) },
    },
    {
      name: "sixteens",
      hits: { kick: steps(FOUR, 0.95), hatC: steps("xoxoxoxoxoxoxoxo", 0.36), rim: steps(".x..x..x.x..x..x", 0.35, 0.7), hatO: steps("......x.......x.", 0.55) },
    },
    {
      name: "off kick",
      hits: { kick: steps("x...x...x...x.x.", 0.95), hatO: steps(OFF, 0.6), clap: steps("............x...", 0.5), shaker: steps("xxxxxxxxxxxxxxxx", 0.2, 0.7) },
    },
  ],
  breaks: [
    {
      name: "classic",
      hits: { kick: steps("x.....x...x.....", 0.92), snare: steps("....x..o....x.o.", 0.95), hatC: steps("x.x.x.x.x.x.x.x.", 0.4), hatO: steps("..............x.", 0.5) },
    },
    {
      name: "funky",
      hits: { kick: steps("x.....x.x.....x.", 0.92), snare: steps("..o.x..o...ox.o.", 0.9), hatC: steps("x.x.x.x.x.x.x.x.", 0.4), ride: steps(FOUR, 0.3) },
    },
    {
      name: "two step",
      hits: { kick: steps("x.....x...x.....", 0.95), snare: steps("....x.......x...", 0.95), hatC: steps("x.xx.x.xx.x.xx.x", 0.35), shaker: steps("xxxxxxxxxxxxxxxx", 0.3, 0.6) },
    },
  ],
};

export interface BassNote {
  s: number;
  /** Length in steps. */
  len: number;
  /** Semitones above the chord root (0 root, 7 fifth, 10 seventh, 12 octave). */
  iv: number;
  v: number;
  glide?: boolean;
  p?: number;
}
export interface BassPattern {
  name: string;
  notes: BassNote[];
}

const OFFBEAT: BassNote[] = [2, 6, 10, 14].map((s) => ({ s, len: 1.8, iv: 0, v: 0.85 }));

export const BASSES: Record<SectionCls, BassPattern[]> = {
  chill: [{ name: "long", notes: [{ s: 0, len: 14, iv: 0, v: 0.6 }] }],
  lounge: [
    { name: "dub", notes: [{ s: 0, len: 6, iv: 0, v: 0.8 }, { s: 8, len: 4, iv: 0, v: 0.7, glide: true }, { s: 12, len: 2, iv: 7, v: 0.6, p: 0.5 }] },
    { name: "offbeat", notes: OFFBEAT },
  ],
  deep: [
    { name: "offbeat", notes: OFFBEAT },
    { name: "rolling", notes: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ s, len: 1.5, iv: s === 14 ? 12 : 0, v: s % 4 ? 0.6 : 0.85 })) },
    { name: "octave", notes: [...OFFBEAT, { s: 4, len: 1.4, iv: 12, v: 0.55, glide: true }, { s: 12, len: 1.4, iv: 12, v: 0.55, glide: true }] },
  ],
  min: [
    { name: "pulse", notes: Array.from({ length: 16 }, (_, s) => ({ s, len: 0.8, iv: s === 14 ? 12 : 0, v: s % 4 ? 0.5 : 0.8 })) },
    { name: "octaves", notes: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ s, len: 1.2, iv: s % 4 ? 12 : 0, v: s % 4 ? 0.55 : 0.85 })) },
    { name: "off kick", notes: [...OFFBEAT, { s: 15, len: 1, iv: 10, v: 0.6, p: 0.6 }] },
  ],
  breaks: [
    { name: "sub", notes: [{ s: 0, len: 6, iv: 0, v: 0.9 }, { s: 6, len: 2, iv: 0, v: 0.7 }, { s: 10, len: 4, iv: 0, v: 0.85 }, { s: 14, len: 2, iv: 10, v: 0.6 }] },
    { name: "rolling", notes: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ s, len: 1.5, iv: s === 14 ? 10 : 0, v: s % 4 ? 0.6 : 0.9 })) },
    { name: "stab", notes: [{ s: 3, len: 1, iv: 0, v: 0.9 }, { s: 7, len: 1, iv: 0, v: 0.8 }, { s: 11, len: 1, iv: 7, v: 0.85 }, { s: 15, len: 1, iv: 10, v: 0.8 }] },
  ],
};

export interface CompPattern {
  name: string;
  /** Chord stabs; empty with `sustain` = hold the chord on each change. */
  hits: Hit[];
  sustain?: boolean;
}

const OFFBEAT_COMP: Hit[] = steps(OFF, 0.6);

export const COMPS: Record<SectionCls, CompPattern[]> = {
  chill: [{ name: "hold", hits: [], sustain: true }],
  lounge: [
    { name: "offbeat", hits: OFFBEAT_COMP },
    { name: "lazy", hits: [...steps("..x.......x.....", 0.6), ...steps(".......x........", 0.45, 0.5)] },
  ],
  deep: [
    { name: "offbeat", hits: OFFBEAT_COMP },
    { name: "skank", hits: [...OFFBEAT_COMP, ...steps(".......x...x....", 0.45)] },
    { name: "push", hits: steps("...x...x...x...x", 0.55) },
  ],
  min: [
    { name: "sparse", hits: steps("......x.......x.", 0.5) },
    { name: "offbeat", hits: OFFBEAT_COMP },
  ],
  breaks: [
    { name: "stabs", hits: steps("..x....x..x.....", 0.7) },
    { name: "offbeat", hits: OFFBEAT_COMP },
  ],
};

export type FillKind = "none" | "light" | "big";

export interface Fill {
  hits: DrumHits;
  /** Kick (and bass) muted from this step of the fill bar; 16 = never. */
  kickMuteFrom: number;
}

/** Last-bar fill: a couple of pickups, or a rising snare roll with the kick pulled. */
export function fillFor(kind: FillKind, rng: Rng): Fill {
  if (kind === "light") {
    return { hits: { snare: [{ s: 14, v: 0.45 }, { s: 15, v: 0.65 }], hatO: [{ s: 15, v: 0.5 }] }, kickMuteFrom: 16 };
  }
  if (kind === "big") {
    const roll = [8, 10, 12, 13, 14, 15].map((s, i) => ({ s, v: 0.4 + i * 0.1 }));
    if (chance(rng, 0.5)) roll.push({ s: 9, v: 0.35 }, { s: 11, v: 0.4 });
    return { hits: { snare: roll, hatO: [{ s: 15, v: 0.6 }] }, kickMuteFrom: 12 };
  }
  return { hits: {}, kickMuteFrom: 16 };
}
