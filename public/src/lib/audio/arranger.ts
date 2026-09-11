/**
 * Phrase planner — the "song" layer above the step sequencer. Every 8–32 bars
 * it picks a role (intro / main / build / break), a progression, a key (with
 * occasional modulation), drum, bass and comping patterns, the instrument
 * patches and how the phrase ends (fill, riser, drop-out). Deterministic given
 * the Rng, so it's unit-tested; the engine seeds it from the wall clock.
 */
import { type BassPattern, BASSES, type CompPattern, COMPS, type DrumPattern, DRUMS, type FillKind } from "./patterns";
import { type Rng, chance, pickOther, pickWeighted } from "./rng";
import { HOME_KEY, type Key, type Progression, type SectionCls, keyName, modulate, pickProgression } from "./theory";

export type Role = "intro" | "main" | "build" | "break";
export type KeysPatch = "rhodes" | "stab" | "pluck";
export type LeadPatch = "fm" | "bell" | "acid";
export type Transition = "none" | "riser" | "dropout";

export const ALL_STEMS = ["keys", "pad", "lead", "bass", "kick", "hat", "perc", "atmos"] as const;
export type StemId = (typeof ALL_STEMS)[number];

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
  /** Stems this phrase lets through (energy gates + operator toggles still apply). */
  layers: ReadonlySet<StemId>;
  keysPatch: KeysPatch;
  leadPatch: LeadPatch;
  fill: FillKind;
  transition: Transition;
  swing: number;
}

const ROLE_NEXT: Record<Role, readonly (readonly [Role, number])[]> = {
  intro: [["main", 1]],
  main: [
    ["main", 5],
    ["build", 2],
    ["break", 3],
  ],
  build: [["main", 1]],
  break: [
    ["build", 1],
    ["main", 1],
  ],
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

function layersFor(role: Role, rng: Rng): ReadonlySet<StemId> {
  switch (role) {
    case "intro":
      return new Set<StemId>(["pad", "atmos", "hat", ...(chance(rng, 0.5) ? (["keys"] as const) : [])]);
    case "build":
      return new Set<StemId>(["pad", "keys", "lead", "hat", "perc", "atmos"]);
    case "break":
      return new Set<StemId>(["pad", "keys", "lead", "atmos", ...(chance(rng, 0.5) ? (["hat"] as const) : [])]);
    default:
      return new Set<StemId>(ALL_STEMS);
  }
}

/** Plan the phrase that follows `prev` (null = the very first) for the section. */
export function planPhrase(rng: Rng, cls: SectionCls, prev: Phrase | null): Phrase {
  const role: Role = prev ? pickWeighted(rng, ROLE_NEXT[prev.role]) : "intro";
  const bars =
    role === "intro" || role === "build"
      ? 8
      : role === "break"
        ? pickWeighted(rng, [[8, 7], [16, 3]] as const)
        : pickWeighted(rng, [[16, 3], [32, 1], [8, 1]] as const);

  // Modulate at a main/break boundary now and then, never twice running.
  const mayModulate = !!prev && !prev.modulated && (role === "main" || role === "break") && prev.role !== "build";
  const modulated = mayModulate && chance(rng, 0.3);
  const key = prev ? (modulated ? modulate(rng, prev.key) : prev.key) : HOME_KEY;

  const fill: FillKind = role === "build" ? "big" : role === "main" ? (chance(rng, 0.6) ? "light" : "none") : "none";
  const transition: Transition =
    role === "build" ? "riser" : role === "break" ? (chance(rng, 0.5) ? "riser" : "none") : role === "main" && chance(rng, 0.35) ? "dropout" : "none";

  return {
    role,
    bars,
    cls,
    key,
    modulated,
    progression: pickProgression(rng, cls, prev?.progression ?? null),
    drums: pickOther(rng, DRUMS[cls], prev?.drums ?? null),
    bass: pickOther(rng, BASSES[cls], prev?.bass ?? null),
    comp: pickOther(rng, COMPS[cls], prev?.comp ?? null),
    layers: layersFor(role, rng),
    keysPatch: pickWeighted(rng, KEYS_PATCH[cls]),
    leadPatch: pickWeighted(rng, LEAD_PATCH[cls]),
    fill,
    transition,
    swing: SWING[cls] + (rng() - 0.5) * 0.06,
  };
}

/** Short human label for the lab readout, e.g. "main · 16 bars · vamp · D minor". */
export function phraseLabel(p: Phrase): string {
  return `${p.role} · ${p.bars} bars · ${p.progression.name} · ${keyName(p.key)}`;
}
