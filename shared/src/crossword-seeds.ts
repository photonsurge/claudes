/**
 * The seed set (docs/crossword-mode-plan.md §7.3): a small space-themed word
 * list for tests and for a box with no word bank imported. Answers are A–Z,
 * clues pass `validateClue` (crossword.test.ts pins that).
 *
 * The February prototype's `data.json` was the model; it was not available
 * when this was written, so these are new words and clues of the same kind.
 */
export interface CrosswordSeedWord {
  answer: string;
  clue: string;
}

export const CROSSWORD_SEED_THEME = "Space";

export const CROSSWORD_SEED_WORDS: readonly CrosswordSeedWord[] = [
  { answer: "COMET", clue: "Icy visitor with a glowing tail" },
  { answer: "ORBIT", clue: "Curved path around a planet or star" },
  { answer: "GALAXY", clue: "Vast system of billions of stars" },
  { answer: "NEBULA", clue: "Cloud of gas and dust where stars form" },
  { answer: "PLANET", clue: "Mars or Venus, for example" },
  { answer: "ASTEROID", clue: "Rocky body, many between Mars and Jupiter" },
  { answer: "METEOR", clue: "Shooting star" },
  { answer: "ROCKET", clue: "Vehicle that launches satellites" },
  { answer: "SATURN", clue: "Ringed sixth planet" },
  { answer: "JUPITER", clue: "Largest planet in the solar system" },
  { answer: "MERCURY", clue: "Planet closest to the Sun" },
  { answer: "VENUS", clue: "Second planet, often the evening star" },
  { answer: "MARS", clue: "The Red Planet" },
  { answer: "NEPTUNE", clue: "Blue giant, eighth from the Sun" },
  { answer: "URANUS", clue: "Ice giant that spins on its side" },
  { answer: "PLUTO", clue: "Dwarf world demoted in 2006" },
  { answer: "MOON", clue: "Earth's only natural satellite" },
  { answer: "ECLIPSE", clue: "One body hiding another from view" },
  { answer: "QUASAR", clue: "Very bright, very distant galactic core" },
  { answer: "PULSAR", clue: "Spinning neutron star that flashes" },
  { answer: "COSMOS", clue: "The universe seen as an ordered whole" },
  { answer: "ZENITH", clue: "Point in the sky directly overhead" },
  { answer: "AURORA", clue: "Northern or southern lights" },
  { answer: "CRATER", clue: "Bowl left by an impact" },
  { answer: "GRAVITY", clue: "Force that keeps us on the ground" },
  { answer: "LUNAR", clue: "Relating to the Moon" },
  { answer: "SOLAR", clue: "Relating to the Sun" },
  { answer: "STAR", clue: "The Sun is one" },
  { answer: "ORION", clue: "Hunter constellation with a famous belt" },
  { answer: "ASTRONAUT", clue: "Crew member on a spaceflight" },
  { answer: "TELESCOPE", clue: "Instrument for viewing distant objects" },
  { answer: "COMPASS", clue: "Instrument that points to magnetic north" },
  { answer: "SUPERNOVA", clue: "Explosive death of a massive star" },
  { answer: "VACUUM", clue: "Space with no air at all" },
  { answer: "HELIUM", clue: "Second element, made in stars" },
  { answer: "CORONA", clue: "Sun's outer atmosphere, seen in totality" },
  { answer: "EQUINOX", clue: "Day and night of equal length" },
  { answer: "SOLSTICE", clue: "Longest or shortest day of the year" },
  { answer: "MILKYWAY", clue: "Our home galaxy" },
  { answer: "STATION", clue: "The ISS, for one" },
  { answer: "SHUTTLE", clue: "Reusable orbiter retired in 2011" },
  { answer: "LAUNCH", clue: "Liftoff from the pad" },
  { answer: "TITAN", clue: "Saturn's largest moon" },
];
