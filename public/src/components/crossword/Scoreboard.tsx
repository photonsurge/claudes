"use client";

/** THIS PUZZLE and TODAY: the top few names and their points. */
import type { CrosswordScore } from "@photonsurge/shared/crossword";
import { ACCENT, EYEBROW, INK, INK_FAINT, MONO, SANS } from "./styles";

export interface ScoreboardProps {
  scores: CrosswordScore[];
  today: { name: string; points: number }[];
  /** Rows per table. */
  limit?: number;
}

function Table({ title, rows, empty }: { title: string; rows: { name: string; points: number }[]; empty: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ ...EYEBROW, fontSize: 16 }}>{title}</div>
      {rows.length === 0 ? <div style={{ color: INK_FAINT, fontFamily: SANS, fontSize: 20 }}>{empty}</div> : null}
      {rows.map((r, i) => (
        <div key={`${r.name}-${i}`} style={{ display: "flex", gap: 10, fontFamily: SANS, fontSize: 20, color: INK }}>
          <span style={{ color: i === 0 ? ACCENT : INK_FAINT, fontFamily: MONO, width: 20 }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          <span style={{ fontFamily: MONO }}>{r.points}</span>
        </div>
      ))}
    </div>
  );
}

export default function Scoreboard({ scores, today, limit = 4 }: ScoreboardProps) {
  return (
    <div style={{ display: "flex", gap: 24, minWidth: 0, flex: 2 }}>
      <Table title="This puzzle" rows={scores.slice(0, limit)} empty="No solves yet" />
      <Table title="Today" rows={today.slice(0, limit)} empty="—" />
    </div>
  );
}
