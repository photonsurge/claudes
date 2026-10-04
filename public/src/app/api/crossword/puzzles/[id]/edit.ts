/**
 * The Puzzles page's edits to a stored puzzle (docs/crossword-mode-plan.md
 * §8.3): a clue rewrite and dropping a word. Pure, so the route only loads,
 * calls and saves.
 *
 * Dropping a word is a simplification of the plan's "re-lays the grid":
 * public runs no layout search, so a drop removes the entry, keeps every other
 * word where it is, trims empty edge rows and columns, and renumbers. When
 * that leaves the grid in pieces or under the minimum word count the drop is
 * refused, and the message points at Generate for a fresh layout instead.
 */
import {
  CLUE_MAX,
  CLUE_MIN,
  cellKey,
  cleanClue,
  entryCells,
  numberEntries,
  validateClue,
  type ClueProblem,
  type CrosswordEntry,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";

export type EditResult = { ok: true; puzzle: CrosswordPuzzle } | { ok: false; error: string };

const PROBLEM_TEXT: Record<ClueProblem, string> = {
  short: `is under ${CLUE_MIN} characters`,
  long: `is over ${CLUE_MAX} characters`,
  leak: "gives the answer away (it contains the answer or its stem)",
  blocked: "hits the blocklist",
};

/** Rewrite one entry's clue: cleaned (`cleanClue`), then refused if `validateClue` finds a problem. */
export function editClue(puzzle: CrosswordPuzzle, entryId: string, raw: string, blocklist: readonly string[] = []): EditResult {
  const entry = puzzle.entries.find((e) => e.id === entryId);
  if (!entry) return { ok: false, error: `no entry ${entryId} in this puzzle` };
  const clue = cleanClue(raw);
  const problem = validateClue(clue, entry.answer, blocklist);
  if (problem) return { ok: false, error: `The clue for ${entry.id} ${PROBLEM_TEXT[problem]}.` };
  return { ok: true, puzzle: { ...puzzle, entries: puzzle.entries.map((e) => (e.id === entryId ? { ...e, clue } : e)) } };
}

/** True when every entry reaches every other through shared cells. */
export function isConnected(entries: Pick<CrosswordEntry, "row" | "col" | "dir" | "answer">[]): boolean {
  if (entries.length <= 1) return true;
  const byCell = new Map<string, number[]>();
  entries.forEach((e, i) => {
    for (const c of entryCells(e)) {
      const k = cellKey(c.row, c.col);
      byCell.set(k, [...(byCell.get(k) ?? []), i]);
    }
  });
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    for (const c of entryCells(entries[i])) {
      for (const j of byCell.get(cellKey(c.row, c.col)) ?? []) {
        if (!seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
  }
  return seen.size === entries.length;
}

/**
 * Remove one entry, keeping the others in place (shifted only to trim empty
 * edges), and renumber. Refused below `minWords` or if the rest falls apart.
 */
export function dropEntry(puzzle: CrosswordPuzzle, entryId: string, minWords: number): EditResult {
  if (!puzzle.entries.some((e) => e.id === entryId)) return { ok: false, error: `no entry ${entryId} in this puzzle` };
  const rest = puzzle.entries.filter((e) => e.id !== entryId);
  if (rest.length < minWords) {
    return {
      ok: false,
      error: `Dropping ${entryId} leaves ${rest.length} words, under the minimum of ${minWords}. Generate a new puzzle instead.`,
    };
  }
  if (!isConnected(rest)) {
    return {
      ok: false,
      error: `Dropping ${entryId} splits the grid into pieces, and the grid can't be laid out again here. Generate a new puzzle instead.`,
    };
  }
  const cells = rest.flatMap((e) => entryCells(e));
  const top = Math.min(...cells.map((c) => c.row));
  const left = Math.min(...cells.map((c) => c.col));
  const bottom = Math.max(...cells.map((c) => c.row));
  const right = Math.max(...cells.map((c) => c.col));
  const entries = numberEntries(
    rest.map((e) => ({ answer: e.answer, clue: e.clue, row: e.row - top, col: e.col - left, dir: e.dir })),
  );
  return { ok: true, puzzle: { ...puzzle, entries, width: right - left + 1, height: bottom - top + 1 } };
}
