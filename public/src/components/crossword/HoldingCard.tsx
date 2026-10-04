"use client";

/** Idle: no puzzle to play yet (or the state is still loading). */
import { EYEBROW, INK, INK_DIM, PLATE, SANS } from "./styles";

export default function HoldingCard({ brand }: { brand: string }) {
  return (
    <div
      data-testid="cw-holding"
      style={{
        ...PLATE,
        width: 1000,
        padding: "56px 72px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 22,
        textAlign: "center",
      }}
    >
      <div style={{ ...EYEBROW, fontSize: 24, letterSpacing: 6 }}>{brand} · Crossword</div>
      <div style={{ color: INK, fontFamily: SANS, fontSize: 64, fontWeight: 600 }}>The next puzzle is on its way</div>
      <div style={{ color: INK_DIM, fontFamily: SANS, fontSize: 28 }}>Stay tuned — the host is setting the grid</div>
    </div>
  );
}
