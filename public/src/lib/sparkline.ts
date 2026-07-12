/**
 * Pure SVG-sparkline geometry — turns a numeric series into a path `d` string
 * (and the last point, for a dot). No dependency, no canvas, no sharp: the graph
 * is inline SVG rendered in the admin card + the on-air slide. Shared so both
 * draw the identical line.
 */
export interface SparkPoint {
  /** x ordinate (epoch ms, or any monotonic number). */
  t: number;
  v: number;
}

export interface SparklineGeometry {
  d: string;
  /** [x,y] of the newest point, or null when empty. */
  last: [number, number] | null;
}

export function sparklinePath(
  samples: SparkPoint[],
  width: number,
  height: number,
  pad = 2,
): SparklineGeometry {
  if (!samples.length) return { d: "", last: null };
  const ts = samples.map((s) => s.t);
  const vs = samples.map((s) => s.v);
  const minT = Math.min(...ts);
  const maxT = Math.max(...ts);
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);
  const spanT = maxT - minT || 1;
  const spanV = maxV - minV || 1;
  const px = (t: number) => pad + ((t - minT) / spanT) * (width - 2 * pad);
  const py = (v: number) => height - pad - ((v - minV) / spanV) * (height - 2 * pad);
  const pts = samples.map((s) => [px(s.t), py(s.v)] as [number, number]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return { d, last: pts[pts.length - 1] };
}
