"use client";

/**
 * The board, as DOM: one square per cell of the public `rows` ("#" block,
 * "." empty, a letter = shown). It can only ever draw what the projection
 * carries, so an unsolved answer cannot reach the screen from here.
 *
 * Solve effects, CSS only: a letter drops into its cell when it first appears
 * (a hint or a solve), and a word solved while the page is up flashes once.
 * Words already solved when the page loaded (or the puzzle changed) do not.
 */
import { memo, useRef } from "react";
import { cellKey, entryCells, type CrosswordPublicEntry } from "@photonsurge/shared/crossword";
import { ACCENT, GODS_TILE, GODS_TILE_BORDER, INK, INK_FAINT, MONO, SANS } from "./styles";

export interface GridProps {
  rows: string[];
  entries: CrosswordPublicEntry[];
  /** The spotlight entry's id; its cells are outlined. */
  spotlightId?: string | null;
  /** Cell size in px. */
  cell: number;
  /** Identifies the puzzle, so a new one resets which solves count as fresh. */
  puzzleKey: string | number;
}

function Grid({ rows, entries, spotlightId, cell, puzzleKey }: GridProps) {
  const width = rows[0]?.length ?? 0;

  // Solved ids at the first render of this puzzle: those never flash.
  const known = useRef<{ key: string | number; ids: Set<string> } | null>(null);
  if (!known.current || known.current.key !== puzzleKey) {
    known.current = { key: puzzleKey, ids: new Set(entries.filter((e) => e.solved).map((e) => e.id)) };
  }

  const numbers = new Map<string, number>();
  const solvedCells = new Set<string>();
  const freshByCell = new Map<string, string[]>();
  let spotCells = new Set<string>();
  for (const e of entries) {
    numbers.set(cellKey(e.row, e.col), e.num);
    const cells = entryCells(e).map((c) => cellKey(c.row, c.col));
    if (e.id === spotlightId) spotCells = new Set(cells);
    if (!e.solved) continue;
    for (const k of cells) solvedCells.add(k);
    if (!known.current.ids.has(e.id)) {
      for (const k of cells) freshByCell.set(k, [...(freshByCell.get(k) ?? []), e.id]);
    }
  }

  const numSize = Math.max(10, Math.round(cell * 0.22));
  const letterSize = Math.round(cell * 0.6);

  return (
    <div
      data-testid="cw-grid"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${width}, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap: 0,
      }}
    >
      {rows.flatMap((line, r) =>
        Array.from(line).map((ch, c) => {
          const k = cellKey(r, c);
          if (ch === "#") return <div key={k} data-testid={`cw-cell-${r}-${c}`} data-block="" />;
          const spot = spotCells.has(k);
          const letter = ch === "." ? null : ch;
          return (
            <div
              key={k}
              data-testid={`cw-cell-${r}-${c}`}
              style={{
                position: "relative",
                boxSizing: "border-box",
                margin: -0.5,
                background: GODS_TILE,
                border: `${spot ? 3 : 1}px solid ${spot ? ACCENT : GODS_TILE_BORDER}`,
                zIndex: spot ? 1 : 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {freshByCell.get(k)?.map((id) => (
                <span
                  key={`flash-${id}`}
                  data-cw-anim=""
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: ACCENT,
                    opacity: 0,
                    animation: "cwFlash 1.4s ease-out forwards",
                  }}
                />
              ))}
              {numbers.has(k) ? (
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 4,
                    color: INK_FAINT,
                    fontFamily: MONO,
                    fontSize: numSize,
                    lineHeight: 1,
                  }}
                >
                  {numbers.get(k)}
                </span>
              ) : null}
              {letter ? (
                <span
                  key={letter}
                  data-cw-anim=""
                  data-testid="cw-letter"
                  style={{
                    position: "relative",
                    color: solvedCells.has(k) ? INK : ACCENT,
                    fontFamily: SANS,
                    fontSize: letterSize,
                    fontWeight: 600,
                    lineHeight: 1,
                    animation: "cwLand 0.5s ease-out both",
                  }}
                >
                  {letter}
                </span>
              ) : null}
            </div>
          );
        }),
      )}
    </div>
  );
}

export default memo(Grid);
