import { sparklinePath, type SparkPoint } from "../lib/sparkline";

/** A tiny inline-SVG line chart (no deps, no canvas). Shared by the admin card
 *  and the on-air slide so both draw a series identically. */
export default function Sparkline({
  samples,
  width = 120,
  height = 28,
  color = "#60a5fa",
  strokeWidth = 1.5,
}: {
  samples: SparkPoint[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const { d, last } = sparklinePath(samples, width, height);
  if (!d) return null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2} fill={color} /> : null}
    </svg>
  );
}
