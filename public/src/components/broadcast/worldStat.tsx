"use client";

/**
 * Shared stat primitives for the top-right WORLD REPORT deck: the hero
 * count tile, the "■ 34 EXTREME" breakdown chip, and the per-continent mini
 * bar-graph. Lifted out of WorldSituationPanel so the DETECTION GRID slide and
 * the per-category ALERTS / SEISMIC / VOLCANOES drill-down slides all render
 * the exact same shapes instead of re-implementing them. Styled on the shared
 * G.O.D.S. panel chrome (GodsPanel): thin Saira hero numerals, mono data ink,
 * square swatches — data colours still come from the callers.
 */
import { MONO, INK_DIM } from "./GodsPanel";

/** Hero count + caption. */
export function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 40,
          fontWeight: 300,
          color: "#ffffff",
          lineHeight: 0.95,
          letterSpacing: -0.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 2.6, color, marginTop: 5 }}>{label}</div>
    </div>
  );
}

/** One "■ 34 EXTREME" chip in the severity/magnitude breakdown — a coloured
 *  square + count + label, light enough that a dozen of them still read as one
 *  scannable line instead of a wall of boxed pills. */
export function BreakdownChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        whiteSpace: "nowrap",
        fontFamily: MONO,
        fontSize: 12.5,
        color: INK_DIM,
      }}
    >
      <span style={{ width: 8, height: 8, background: color, flex: "0 0 auto" }} />
      <span style={{ color: "#dfe9ee", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      <span style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>
    </span>
  );
}

/** A single mini bar-graph: coloured segments proportional to their own share,
 *  overall length relative to the busiest continent IN THIS SAME CATEGORY (not
 *  the combined total) — so each column reads on its own scale instead of one
 *  category swamping the other. Thin dark gaps between segments so adjacent
 *  colours never blur into one another. */
export function MiniBar({
  count,
  segments,
  max,
}: {
  count: number;
  segments: { key: string; color: string; count: number }[];
  max: number;
}) {
  const pct = max > 0 && count > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0;
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        height: 9,
        background: "#0d1f2b",
        border: "1px solid #163241",
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", display: "flex" }}>
        {count > 0 &&
          segments.map((s, i) => (
            <div
              key={s.key}
              style={{
                width: `${(s.count / count) * 100}%`,
                height: "100%",
                background: s.color,
                borderRight: i < segments.length - 1 ? "1px solid rgba(0,0,0,0.4)" : undefined,
              }}
            />
          ))}
      </div>
    </div>
  );
}
