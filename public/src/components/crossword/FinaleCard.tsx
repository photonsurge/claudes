"use client";

/**
 * The finale beside the finished grid: the podium for this puzzle, how many
 * words the host had to fill, and when the next puzzle starts. The host count
 * is read off the entries: a word still credited to the host by name (a late
 * answer moves the credit to the player, and the name with it).
 */
import { CROSSWORD_HOST_NAME, type CrosswordPublicEntry, type CrosswordScore } from "@photonsurge/shared/crossword";
import Countdown from "./Countdown";
import { ACCENT, EYEBROW, GODS_TILE, GODS_TILE_BORDER, INK, INK_DIM, INK_FAINT, MONO, PLATE, SANS } from "./styles";

export interface FinaleCardProps {
  puzzleNo: number;
  entries: CrosswordPublicEntry[];
  scores: CrosswordScore[];
  phaseEndsAt: number;
  offset: number;
  paused: boolean;
}

export const hostFilled = (entries: CrosswordPublicEntry[]) =>
  entries.filter((e) => e.solved?.name === CROSSWORD_HOST_NAME).length;

/** Podium order on screen: 2nd, 1st, 3rd, with 1st tallest. */
const STEPS = [
  { place: 1, height: 150 },
  { place: 0, height: 210 },
  { place: 2, height: 110 },
];

export default function FinaleCard({ puzzleNo, entries, scores, phaseEndsAt, offset, paused }: FinaleCardProps) {
  const host = hostFilled(entries);
  const total = entries.length;
  return (
    <div
      data-testid="cw-finale"
      style={{ ...PLATE, height: "100%", padding: "32px 40px", display: "flex", flexDirection: "column", gap: 28 }}
    >
      <div style={{ ...EYEBROW, fontSize: 24 }}>Puzzle {puzzleNo} complete</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 18, flex: 1 }}>
        {STEPS.map(({ place, height }) => {
          const s = scores[place];
          return (
            <div key={place} style={{ width: 260, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  color: s ? INK : INK_FAINT,
                  fontFamily: SANS,
                  fontSize: 30,
                  fontWeight: 600,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s ? s.name : "—"}
              </div>
              {s ? (
                <div style={{ color: INK_DIM, fontFamily: MONO, fontSize: 22 }}>
                  {s.points} pts · {s.words} {s.words === 1 ? "word" : "words"}
                </div>
              ) : null}
              <div
                style={{
                  width: "100%",
                  height,
                  boxSizing: "border-box",
                  background: GODS_TILE,
                  border: `1px solid ${place === 0 ? ACCENT : GODS_TILE_BORDER}`,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  paddingTop: 14,
                  color: place === 0 ? ACCENT : INK_DIM,
                  fontFamily: MONO,
                  fontSize: 48,
                }}
              >
                {place + 1}
              </div>
            </div>
          );
        })}
      </div>
      <div data-testid="cw-finale-host" style={{ color: INK, fontFamily: SANS, fontSize: 30, textAlign: "center" }}>
        {host === 0 ? (
          <>Every word was solved by the audience</>
        ) : (
          <>
            The host had to fill <span style={{ color: ACCENT }}>{host}</span> of {total}
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, color: INK_DIM, fontFamily: SANS, fontSize: 24 }}>
        Next puzzle
        <div style={{ flex: 1 }}>
          <Countdown endsAt={phaseEndsAt} offset={offset} paused={paused} fontSize={24} />
        </div>
      </div>
    </div>
  );
}
