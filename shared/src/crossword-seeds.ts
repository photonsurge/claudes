/**
 * The seed set (docs/crossword-mode-plan.md §7.3): a small space-themed word
 * list for tests and for a box with no word bank imported. Answers are A–Z,
 * clues pass `validateClue` (crossword.test.ts pins that).
 *
 * The words and clues are the February prototype's `data.json`
 * (crosswords/data.json), uppercased. After a read-through they count as
 * approved and family friendly, words and clues alike (§7.3, §7.4). Each
 * carries a seed id for the puzzle entry's `wordId` / `clueId`.
 */
export interface CrosswordSeedWord {
  /** "seed:<ANSWER>". */
  id: string;
  /** "seed:<ANSWER>:1". */
  clueId: string;
  answer: string;
  clue: string;
  approved: true;
  familyFriendly: true;
}

export const CROSSWORD_SEED_THEME = "Space";

/** The seed word id for an answer. */
export const seedWordId = (answer: string) => `seed:${answer}`;
export const isSeedId = (id: string) => id.startsWith("seed:");

const RAW: readonly { answer: string; clue: string }[] = [
  { answer: "SPACE", clue: "The region beyond Earth's atmosphere" },
  { answer: "ORBIT", clue: "Path a body follows around another" },
  { answer: "EQUINOX", clue: "Day when day and night are nearly equal" },
  { answer: "SOLSTICE", clue: "Longest or shortest day of the year" },
  { answer: "ZENITH", clue: "Point in the sky directly overhead" },
  { answer: "MARS", clue: "The red planet" },
  { answer: "VENUS", clue: "Second planet from the sun" },
  { answer: "JUPITER", clue: "Largest planet in our solar system" },
  { answer: "SATURN", clue: "Ringed planet" },
  { answer: "NEPTUNE", clue: "Blue ice giant" },
  { answer: "ASTEROID", clue: "Rocky body orbiting the sun" },
  { answer: "METEOROID", clue: "Small rock in space before it enters air" },
  { answer: "METEORITE", clue: "Space rock that reaches the ground" },
  { answer: "PERIHELION", clue: "Closest point to the sun in an orbit" },
  { answer: "APHELION", clue: "Farthest point from the sun in an orbit" },
  { answer: "NEBULA", clue: "Cloud of gas and dust in space" },
  { answer: "GALAXY", clue: "Huge system of stars" },
  { answer: "MILKYWAY", clue: "Our home galaxy" },
  { answer: "SUPERNOVA", clue: "Massive star explosion" },
  { answer: "PULSAR", clue: "Rapidly spinning neutron star" },
  { answer: "QUASAR", clue: "Extremely bright galactic core" },
  { answer: "GRAVITY", clue: "Force that attracts masses" },
  { answer: "SPACETIME", clue: "The combined fabric of space and time" },
  { answer: "REDSHIFT", clue: "Light stretched to longer wavelengths" },
  { answer: "DARKMATTER", clue: "Unseen matter inferred by gravity" },
  { answer: "BLACKHOLE", clue: "Region where gravity prevents escape" },
  { answer: "ASTRONAUT", clue: "Space traveler" },
  { answer: "COSMONAUT", clue: "Russian space traveler" },
  { answer: "SPACESUIT", clue: "Protective gear for spacewalks" },
  { answer: "REENTRY", clue: "Return through an atmosphere" },
  { answer: "PAYLOAD", clue: "Cargo carried by a rocket" },
  { answer: "ORION", clue: "Famous hunter constellation" },
  { answer: "DRACO", clue: "Dragon constellation" },
  { answer: "CYGNUS", clue: "Swan constellation" },
  { answer: "WARP", clue: "Faster-than-light travel idea" },
  { answer: "TERRAFORM", clue: "Make a planet more Earth-like" },
  { answer: "HYPERSPACE", clue: "Sci-fi realm for rapid travel" },
];

export const CROSSWORD_SEED_WORDS: readonly CrosswordSeedWord[] = RAW.map((w) => ({
  id: seedWordId(w.answer),
  clueId: `${seedWordId(w.answer)}:1`,
  answer: w.answer,
  clue: w.clue,
  approved: true as const,
  familyFriendly: true as const,
}));
