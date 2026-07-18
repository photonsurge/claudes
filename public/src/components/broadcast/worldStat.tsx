"use client";

/**
 * Shared stat primitives for the top-right WORLD REPORT deck: the hero
 * count tile, the "● 34 Extreme" breakdown chip, and the per-continent mini
 * bar-graph. Lifted out of WorldSituationPanel so the DETECTION GRID slide and
 * the per-category ALERTS / SEISMIC / VOLCANOES drill-down slides all render
 * the exact same shapes instead of re-implementing them.
 */

/** Hero count + caption. */
export function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 39.6,
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1,
          textShadow: "0 1px 6px rgba(0,0,0,0.5)",
        }}
      >
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 12.1, fontWeight: 800, letterSpacing: 1, color, marginTop: 5 }}>{label}</div>
    </div>
  );
}

/** One "● 34 Extreme" chip in the severity/magnitude breakdown — a coloured
 *  dot + count + label, light enough that a dozen of them still read as one
 *  scannable line instead of a wall of boxed pills. */
export function BreakdownChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
          boxShadow: `0 0 5px ${color}99`,
          flex: "0 0 auto",
        }}
      />
      <span style={{ fontSize: 13.2, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
      <span style={{ fontSize: 12.1, fontWeight: 700, color: "#c3cee0", letterSpacing: 0.3 }}>{label}</span>
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
        height: 9,
        borderRadius: 3,
        background: "rgba(255,255,255,0.07)",
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
