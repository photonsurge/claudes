export type Direction = "across" | "down";
export type PlayerCell = string | null; // null=black, ""=empty, "A"=filled

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface iCrosswordWord {
  word: string;
  clue: string;
  length: number;
  difficulty: Difficulty;
  category: string;
}

export type Placement = {
  word: string;
  row: number;
  col: number;
  dir: Direction;
};
export type PlacementWithEntry = Placement & {
  entry: iCrosswordWord;
};
export type PlacementWithRef = PlacementWithEntry & {
  startRef: string; // like "A1"
};

export type LockedPlacement = {
  word: string;
  row: number;
  col: number;
  dir: Direction;
  locked: true;
};

export type CrosswordState = {
  grid: (string | null)[][];
  locked: LockedPlacement[];
};

export type CrosswordResult = {
  width: number;
  height: number;
  grid: (string | null)[][];
  placements: PlacementWithEntry[];
};

export type GenerateOptions = {
  maxSize?: number;           // default 15
  maxAttempts?: number;       // default 200
  pad?: number;               // empty border around content for nicer look (default 1)
  cellSize?: number;          // for SVG (default 40)
  showLetters?: boolean;      // false => blank sheet, true => answer key
};

export type ScoreMap = Record<string, number>;


export type Puzzle = {
  width: number;
  height: number;
  placements: PlacementWithRef[]
  solutionGrid: (string | null)[][]; // letters or null(black)
  playerGrid: (string | null)[][];   // only correct letters shown, null elsewhere

  solvedSlots: Set<string>;              // e.g. "C5-across"
  score: ScoreMap;         // per player id if needed
};

export type GuessResult =
  | { ok: true; dir: Direction; filled: Array<{ row: number; col: number; letter: string }> }
  | { ok: false; reason: string; correctLength?: number; candidates?: Array<{ dir: Direction; length: number }> };

