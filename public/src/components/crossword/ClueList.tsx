"use client";

/**
 * Every clue, ACROSS and DOWN side by side. It never scrolls: the puzzle caps
 * (16 words, 48-character clues) are what make it fit, and a long list steps
 * the type down once rather than overflowing. The spotlight clue is marked;
 * a solved one carries who took it.
 */
import { CROSSWORD_HOST_NAME, type CrosswordPublicEntry } from "@photonsurge/shared/crossword";
import { ACCENT, EYEBROW, INK, INK_DIM, INK_FAINT, MONO, PLATE, SANS } from "./styles";

export interface ClueListProps {
  entries: CrosswordPublicEntry[];
  spotlightId?: string | null;
}

function Column({ title, entries, spotlightId, fontSize }: { title: string; entries: CrosswordPublicEntry[]; spotlightId?: string | null; fontSize: number }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={EYEBROW}>{title}</div>
      {entries.map((e) => {
        const spot = e.id === spotlightId;
        const solved = e.solved;
        return (
          <div
            key={e.id}
            data-testid={`cw-clue-${e.id}`}
            style={{
              display: "flex",
              gap: 10,
              fontFamily: SANS,
              fontSize,
              lineHeight: 1.2,
              color: solved ? INK_DIM : INK,
              borderLeft: `3px solid ${spot ? ACCENT : "transparent"}`,
              paddingLeft: 8,
            }}
          >
            <span style={{ color: spot ? ACCENT : INK_FAINT, fontFamily: MONO, minWidth: fontSize * 1.3, textAlign: "right" }}>
              {e.num}
            </span>
            <span
              style={{
                minWidth: 0,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {e.clue} <span style={{ color: INK_FAINT }}>({e.length})</span>
              {solved ? (
                <span style={{ color: ACCENT, fontSize: fontSize * 0.8 }}>
                  {" "}
                  ✓ {solved.name === CROSSWORD_HOST_NAME ? "host" : `${solved.name} +${solved.points}`}
                  {solved.late ? " late" : ""}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ClueList({ entries, spotlightId }: ClueListProps) {
  const across = entries.filter((e) => e.dir === "across").sort((a, b) => a.num - b.num);
  const down = entries.filter((e) => e.dir === "down").sort((a, b) => a.num - b.num);
  const fontSize = Math.max(across.length, down.length) > 7 ? 20 : 24;
  return (
    <div style={{ ...PLATE, height: "100%", padding: "18px 24px", display: "flex", gap: 28, overflow: "hidden" }}>
      <Column title="Across" entries={across} spotlightId={spotlightId} fontSize={fontSize} />
      <Column title="Down" entries={down} spotlightId={spotlightId} fontSize={fontSize} />
    </div>
  );
}
