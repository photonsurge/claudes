"use client";

/**
 * NOW SOLVING: the spotlight clue, big, with its letters so far as tiles and
 * the time left on it. While the word sits solved for its short beat (or the
 * host's reveal hold) the card says who took it instead of counting down.
 */
import { entryCells, CROSSWORD_HOST_NAME, type CrosswordPublicEntry, type CrosswordSpotlight } from "@photonsurge/shared/crossword";
import Countdown from "./Countdown";
import { ACCENT, EYEBROW, CELL, LINE, INK, INK_DIM, MONO, PLATE, SANS, TEXT_INK } from "./styles";

export interface SpotlightCardProps {
  entry: CrosswordPublicEntry | null;
  spotlight: CrosswordSpotlight | null;
  rows: string[];
  offset: number;
  paused: boolean;
}

/** The entry's letters as they show on the board; null where a cell is still empty. */
export function entryPattern(entry: Pick<CrosswordPublicEntry, "row" | "col" | "dir" | "length">, rows: string[]): (string | null)[] {
  return entryCells(entry).map(({ row, col }) => {
    const ch = rows[row]?.[col];
    return ch && ch !== "." && ch !== "#" ? ch : null;
  });
}

const dirWord = (d: "across" | "down") => (d === "across" ? "ACROSS" : "DOWN");

export default function SpotlightCard({ entry, spotlight, rows, offset, paused }: SpotlightCardProps) {
  if (!entry || !spotlight) {
    return <div style={{ ...PLATE, height: "100%" }} />;
  }
  const pattern = entryPattern(entry, rows);
  const tile = Math.min(48, Math.floor(560 / Math.max(1, pattern.length)));
  const solved = entry.solved;
  const byHost = solved?.name === CROSSWORD_HOST_NAME;

  return (
    <div
      data-testid="cw-spotlight"
      style={{ ...PLATE, height: "100%", padding: "20px 28px", display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <div style={EYEBROW}>Now solving</div>
        <div style={{ color: INK_DIM, fontFamily: MONO, fontSize: 22, letterSpacing: 1.5 }}>
          {entry.num} {dirWord(entry.dir)} · {entry.length} letters
        </div>
      </div>
      <div
        style={{
          color: INK,
          fontFamily: SANS,
          fontSize: 40,
          fontWeight: 500,
          lineHeight: 1.15,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {entry.clue}
      </div>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {pattern.map((ch, i) => (
            <div
              key={i}
              style={{
                width: tile,
                height: tile,
                boxSizing: "border-box",
                background: CELL,
                border: `1px solid ${ch ? ACCENT : LINE}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: solved ? INK : ACCENT,
                fontFamily: SANS,
                fontSize: Math.round(tile * 0.6),
                fontWeight: 600,
              }}
            >
              {ch ? (
                <span key={ch} data-cw-anim="" style={{ animation: "cwLand 0.5s ease-out both" }}>
                  {ch}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {solved ? (
            <div data-testid="cw-spotlight-solved" style={{ color: TEXT_INK, fontFamily: SANS, fontSize: 26, textAlign: "right" }}>
              {byHost ? (
                "The host filled it"
              ) : (
                <>
                  <span style={{ color: ACCENT }}>✓ {solved.name}</span> +{solved.points}
                  {solved.late ? " (late)" : ""}
                </>
              )}
            </div>
          ) : (
            <Countdown endsAt={spotlight.endsAt} startedAt={spotlight.startedAt} offset={offset} paused={paused} />
          )}
        </div>
      </div>
    </div>
  );
}
