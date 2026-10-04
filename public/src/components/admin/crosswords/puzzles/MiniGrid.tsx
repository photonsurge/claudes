"use client";

/**
 * A small crossword grid for the admin pages: the Puzzles detail (every
 * answer showing) and the Desk (the public projection's shown letters). Rows
 * are strings, "#" a block, "." an empty cell, a letter a shown one — the
 * public state's own shape, so both pages feed it the same way.
 */
import Box from "@mui/material/Box";
import { cellKey, entryCells, puzzleLetters, type CrosswordDir } from "@photonsurge/shared/crossword";
import { font } from "../../../../theme/tokens";

export interface MiniGridEntry {
  id: string;
  num: number;
  dir: CrosswordDir;
  row: number;
  col: number;
  length: number;
}

interface Props {
  width: number;
  height: number;
  rows: string[];
  entries: MiniGridEntry[];
  /** Entry to outline (the spotlight, or the clue row being edited). */
  highlight?: string | null;
  /** Cell side in px. */
  cell?: number;
}

/** Rows with every answer showing, from a stored puzzle. */
export function answerRows(p: { width: number; height: number; entries: { row: number; col: number; dir: CrosswordDir; answer: string }[] }): string[] {
  const letters = puzzleLetters(p as never);
  return Array.from({ length: p.height }, (_, r) =>
    Array.from({ length: p.width }, (_, c) => letters.get(cellKey(r, c)) ?? "#").join(""),
  );
}

export default function MiniGrid({ width, height, rows, entries, highlight, cell = 26 }: Props) {
  const numbers = new Map<string, number>();
  for (const e of entries) numbers.set(cellKey(e.row, e.col), e.num);
  const lit = new Set<string>();
  const hi = highlight ? entries.find((e) => e.id === highlight) : undefined;
  if (hi) for (const c of entryCells(hi)) lit.add(cellKey(c.row, c.col));

  return (
    <Box
      role="grid"
      aria-label="Crossword grid"
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${width}, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap: "1px",
        width: "fit-content",
      }}
    >
      {Array.from({ length: height }, (_, r) =>
        Array.from({ length: width }, (_, c) => {
          const ch = rows[r]?.[c] ?? "#";
          const k = cellKey(r, c);
          if (ch === "#") return <Box key={k} />;
          const num = numbers.get(k);
          return (
            <Box
              key={k}
              role="gridcell"
              data-cell={k}
              sx={{
                position: "relative",
                border: 1,
                borderColor: lit.has(k) ? "primary.main" : "divider",
                bgcolor: lit.has(k) ? "action.selected" : "background.paper",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: font.mono,
                fontWeight: 700,
                fontSize: cell * 0.5,
              }}
            >
              {num != null && (
                <Box component="span" sx={{ position: "absolute", top: 0, left: 2, fontSize: Math.max(8, cell * 0.3), color: "text.secondary", fontWeight: 400 }}>
                  {num}
                </Box>
              )}
              {ch === "." ? "" : ch}
            </Box>
          );
        }),
      )}
    </Box>
  );
}
