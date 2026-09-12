/**
 * Arrangement planner — two layers above the step sequencer.
 *
 * A TRACK is what a listener hears as "a tune": its own tempo, key, kick /
 * hat / pad / bass flavours and chord voicing, lasting a handful of phrases.
 * Tracks open with a sparse intro, so a track change reads like a DJ mix
 * moving on rather than a parameter tweak.
 *
 * A PHRASE (8–32 bars) inside a track picks a role (intro / main / build /
 * break / interlude), a progression, patterns, patches, which stems play,
 * and how the phrase ends (fill, riser, drop-out). Deterministic given the
 * Rng, so it's unit-tested; the engine seeds it from the wall clock.
 */
import { type BassPattern, BASSES, type CompPattern, COMPS, type DrumPattern, DRUMS, type FillKind } from "./patterns";
import { type Rng, chance, pickOther, pickWeighted } from "./rng";
import { HOME_KEY, type Key, type Progression, type SectionCls, type Voicing, isMajor, keyName, modulate, pickProgression } from "./theory";

export type Role = "intro" | "main" | "build" | "break" | "interlude";
export type KeysPatch = "rhodes" | "stab" | "pluck";
export type LeadPatch = "fm" | "bell" | "acid";
export type Transition = "none" | "riser" | "dropout";
export type KickFlavour = "punch" | "deep" | "tight" | "soft";
export type HatColour = "bright" | "dark" | "crisp";
export type PadType = "saw" | "soft" | "organ" | "strings" | "glass";
export type BassFlavour = "sub" | "reese" | "pluck";

export const ALL_STEMS = ["keys", "pad", "lead", "bass", "kick", "hat", "perc", "atmos"] as const;
export type StemId = (typeof ALL_STEMS)[number];

export interface Track {
  /** 1-based running number, for the readout. */
  n: number;
  /** Section the track was planned for (tempo range, flavour weights). */
  cls: SectionCls;
  bpm: number;
  key: Key;
  kick: KickFlavour;
  hat: HatColour;
  pad: PadType;
  bass: BassFlavour;
  voicing: Voicing;
  /** Lead register lift, semitones. */
  leadOctave: 0 | 12;
  /** Phrases this track runs for before the next track starts. */
  phrases: number;
}

export interface Phrase {
  role: Role;
  bars: number;
  cls: SectionCls;
  key: Key;
  modulated: boolean;
  progression: Progression;
  drums: DrumPattern;
  bass: BassPattern;
  comp: CompPattern;
  /** Stems this phrase lets through (operator toggles + energy floors still apply). */
  layers: ReadonlySet<StemId>;
  keysPatch: KeysPatch;
  leadPatch: LeadPatch;
  fill: FillKind;
  transition: Transition;
  swing: number;
}

/** Tempo range per section a new track draws from. */
export const BPM_RANGE: Record<SectionCls, readonly [number, number]> = {
  chill: [98, 110],
  lounge: [110, 120],
  deep: [118, 125],
  min: [124, 132],
  breaks: [128, 140],
};

const KICK_FLAVOUR: Record<SectionCls, readonly (readonly [KickFlavour, number])[]> = {
  chill: [["soft", 3], ["deep", 1]],
  lounge: [["soft", 2], ["punch", 2], ["deep", 1]],
  deep: [["punch", 3], ["deep", 2], ["tight", 1]],
  min: [["tight", 3], ["punch", 2], ["deep", 1]],
  breaks: [["punch", 2], ["tight", 2], ["deep", 1]],
};
const HAT_COLOUR: readonly (readonly [HatColour, number])[] = [["bright", 3], ["dark", 2], ["crisp", 2]];
const PAD_TYPE: Record<SectionCls, readonly (readonly [PadType, number])[]> = {
  chill: [["soft", 3], ["strings", 2], ["glass", 2], ["organ", 1]],
  lounge: [["soft", 2], ["strings", 2], ["organ", 2], ["glass", 1]],
  deep: [["saw", 3], ["organ", 2], ["strings", 1], ["glass", 1]],
  min: [["saw", 3], ["glass", 2], ["organ", 1]],
  breaks: [["saw", 3], ["strings", 2], ["glass", 1]],
};
const BASS_FLAVOUR: Record<SectionCls, readonly (readonly [BassFlavour, number])[]> = {
  chill: [["sub", 3], ["pluck", 1]],
  lounge: [["sub", 3], ["pluck", 2]],
  deep: [["sub", 3], ["reese", 1], ["pluck", 2]],
  min: [["sub", 2], ["reese", 2], ["pluck", 2]],
  breaks: [["reese", 3], ["sub", 2], ["pluck", 1]],
};
const VOICING: readonly (readonly [Voicing, number])[] = [["seventh", 3], ["triad", 2], ["shell", 2]];

/** Plan the next track: a fresh key (always), tempo from the section's range, new flavours. */
export function planTrack(rng: Rng, cls: SectionCls, prev: Track | null): Track {
  const [lo, hi] = BPM_RANGE[cls];
  return {
    n: (prev?.n ?? 0) + 1,
    cls,
    bpm: Math.round(lo + rng() * (hi - lo)),
    key: prev ? modulate(rng, prev.key) : HOME_KEY,
    kick: pickWeighted(rng, KICK_FLAVOUR[cls]),
    hat: pickWeighted(rng, HAT_COLOUR),
    pad: pickWeighted(rng, PAD_TYPE[cls]),
    bass: pickWeighted(rng, BASS_FLAVOUR[cls]),
    voicing: pickWeighted(rng, VOICING),
    leadOctave: chance(rng, 0.3) ? 12 : 0,
    phrases: 5 + Math.floor(rng() * 5),
  };
}

const ROLE_NEXT: Record<Role, readonly (readonly [Role, number])[]> = {
  intro: [["main", 1]],
  main: [
    ["main", 5],
    ["build", 2],
    ["break", 3],
    ["interlude", 1.5],
  ],
  build: [["main", 1]],
  break: [
    ["build", 1],
    ["main", 1],
  ],
  interlude: [["main", 1]],
};

const KEYS_PATCH: Record<SectionCls, readonly (readonly [KeysPatch, number])[]> = {
  chill: [["rhodes", 3], ["pluck", 1]],
  lounge: [["rhodes", 3], ["pluck", 1]],
  deep: [["rhodes", 2], ["stab", 2], ["pluck", 1]],
  min: [["stab", 2], ["pluck", 2], ["rhodes", 1]],
  breaks: [["stab", 2], ["rhodes", 1], ["pluck", 1]],
};

const LEAD_PATCH: Record<SectionCls, readonly (readonly [LeadPatch, number])[]> = {
  chill: [["bell", 2], ["fm", 2]],
  lounge: [["bell", 2], ["fm", 2]],
  deep: [["fm", 2], ["bell", 1], ["acid", 1]],
  min: [["acid", 3], ["fm", 1]],
  breaks: [["acid", 2], ["fm", 2]],
};

const SWING: Record<SectionCls, number> = { chill: 0.2, lounge: 0.2, deep: 0.16, min: 0.06, breaks: 0.12 };

/** Per-stem probability of playing in a MAIN phrase — texture changes phrase to phrase. */
const MAIN_LAYERS: Record<SectionCls, Record<StemId, number>> = {
  chill: { pad: 0.95, atmos: 0.9, keys: 0.75, lead: 0.35, bass: 0.45, kick: 0.3, hat: 0.35, perc: 0.35 },
  lounge: { pad: 0.85, atmos: 0.8, keys: 0.8, lead: 0.45, bass: 0.8, kick: 0.75, hat: 0.8, perc: 0.5 },
  deep: { pad: 0.8, atmos: 0.7, keys: 0.75, lead: 0.5, bass: 0.95, kick: 1, hat: 0.9, perc: 0.75 },
  min: { pad: 0.6, atmos: 0.6, keys: 0.6, lead: 0.7, bass: 0.95, kick: 1, hat: 0.95, perc: 0.7 },
  breaks: { pad: 0.7, atmos: 0.6, keys: 0.6, lead: 0.7, bass: 0.95, kick: 1, hat: 0.9, perc: 1 },
};

function layersFor(role: Role, cls: SectionCls, rng: Rng): ReadonlySet<StemId> {
  switch (role) {
    case "intro":
      return new Set<StemId>(["pad", "atmos", "hat", ...(chance(rng, 0.5) ? (["keys"] as const) : [])]);
    case "build":
      return new Set<StemId>(["pad", "keys", "lead", "hat", "perc", "atmos"]);
    case "break":
      return new Set<StemId>(["pad", "keys", "lead", "atmos", ...(chance(rng, 0.5) ? (["hat"] as const) : [])]);
    case "interlude":
      return new Set<StemId>(["pad", "atmos", "lead", ...(chance(rng, 0.5) ? (["keys"] as const) : [])]);
    default: {
      const on = new Set<StemId>();
      for (const s of ALL_STEMS) if (chance(rng, MAIN_LAYERS[cls][s])) on.add(s);
      if (on.size < 3) {
        on.add("pad");
        on.add("keys");
        on.add("atmos");
      }
      return on;
    }
  }
}

export interface PhraseOpts {
  /** True when this phrase opens a new track: it becomes the intro, in the track's key. */
  newTrack?: boolean;
  key?: Key;
}

/** Plan the phrase that follows `prev` (null = the very first) for the section. */
export function planPhrase(rng: Rng, cls: SectionCls, prev: Phrase | null, opts: PhraseOpts = {}): Phrase {
  const fresh = !prev || !!opts.newTrack;
  const role: Role = fresh ? "intro" : pickWeighted(rng, ROLE_NEXT[prev.role]);
  const bars =
    role === "intro" || role === "build" || role === "interlude"
      ? 8
      : role === "break"
        ? pickWeighted(rng, [[8, 7], [16, 3]] as const)
        : pickWeighted(rng, [[16, 3], [32, 1], [8, 1]] as const);

  // Within a track, modulate at a main/break boundary now and then, never twice running.
  const mayModulate = !fresh && !prev.modulated && (role === "main" || role === "break") && prev.role !== "build" && prev.role !== "intro";
  const modulated = mayModulate && chance(rng, 0.2);
  const key = fresh ? (opts.key ?? prev?.key ?? HOME_KEY) : modulated ? modulate(rng, prev.key) : prev.key;

  const fill: FillKind = role === "build" ? "big" : role === "main" ? (chance(rng, 0.6) ? "light" : "none") : "none";
  const transition: Transition =
    role === "build" ? "riser" : role === "break" ? (chance(rng, 0.5) ? "riser" : "none") : role === "main" && chance(rng, 0.35) ? "dropout" : "none";

  const leadPatch: LeadPatch = role === "interlude" ? "bell" : pickWeighted(rng, LEAD_PATCH[cls]);
  return {
    role,
    bars,
    cls,
    key,
    modulated,
    progression: pickProgression(rng, cls, prev?.progression ?? null, isMajor(key)),
    drums: pickOther(rng, DRUMS[cls], prev?.drums ?? null),
    bass: pickOther(rng, BASSES[cls], prev?.bass ?? null),
    comp: pickOther(rng, COMPS[cls], prev?.comp ?? null),
    layers: layersFor(role, cls, rng),
    keysPatch: pickWeighted(rng, KEYS_PATCH[cls]),
    leadPatch,
    fill,
    transition,
    swing: SWING[cls] + (rng() - 0.5) * 0.06,
  };
}

/** Short human label for the lab readout, e.g. "main · 16 bars · vamp · D minor". */
export function phraseLabel(p: Phrase): string {
  return `${p.role} · ${p.bars} bars · ${p.progression.name} · ${keyName(p.key)}`;
}

/** e.g. "track 3 · 122 bpm · deep kick · organ pad · reese bass · triads". */
export function trackLabel(t: Track): string {
  const v = t.voicing === "seventh" ? "7ths" : t.voicing === "triad" ? "triads" : "shells";
  return `track ${t.n} · ${t.bpm} bpm · ${t.kick} kick · ${t.pad} pad · ${t.bass} bass · ${v}`;
}
