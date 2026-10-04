"use client";

/** The title card before a puzzle: its number, title and word count, and when it starts. */
import Countdown from "./Countdown";
import { ACCENT, EYEBROW, INK, INK_DIM, PLATE, SANS } from "./styles";

export interface IntroCardProps {
  puzzleNo: number;
  title: string;
  words: number;
  phaseEndsAt: number;
  offset: number;
  paused: boolean;
}

export default function IntroCard({ puzzleNo, title, words, phaseEndsAt, offset, paused }: IntroCardProps) {
  return (
    <div
      data-testid="cw-intro"
      style={{
        ...PLATE,
        width: 1100,
        padding: "56px 72px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 26,
        textAlign: "center",
      }}
    >
      <div style={{ ...EYEBROW, fontSize: 26, letterSpacing: 6 }}>Puzzle {puzzleNo}</div>
      <div style={{ color: INK, fontFamily: SANS, fontSize: 96, fontWeight: 600, lineHeight: 1 }}>{title}</div>
      <div style={{ color: INK_DIM, fontFamily: SANS, fontSize: 32 }}>
        <span style={{ color: ACCENT }}>{words}</span> words to find
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, color: INK_DIM, fontFamily: SANS, fontSize: 28 }}>
        Starting in
        <Countdown endsAt={phaseEndsAt} offset={offset} paused={paused} bar={false} fontSize={32} />
      </div>
    </div>
  );
}
