// weather/pick.ts
// When several models archived the same variable+validTime (a global run vs a
// regional nest), keep — per valid time — only the finest-resolution frame that
// actually covers the point. PURE + generic over any frame carrying bounds/grid/
// validTime, so both the public history builders and the worker panel precompute
// select frames identically (one implementation, no drift).
import { latLngToPixel } from "./sample";

/** The minimum a frame must expose to be point-selected. */
export interface PickableFrame {
  bounds: number[];
  grid: { width: number; height: number; res: number };
  validTime: Date | string | number;
}

const covers = (f: PickableFrame, lat: number, lng: number) =>
  latLngToPixel(lat, lng, { bounds: f.bounds, res: f.grid.res, width: f.grid.width, height: f.grid.height }) != null;

/**
 * Every frame covering the point, grouped by valid time (ascending) and ordered
 * FINEST-FIRST within each time. `pickFramesForPoint` takes the head of each
 * group; a caller that can tell "this frame has no data HERE" from "no frame
 * covers this point" walks further down — a nest whose grid covers the point but
 * whose field is masked there (a coastal sea-only frame, a partial run) would
 * otherwise blank a step the global run could have answered.
 */
export function pickFrameCandidatesForPoint<F extends PickableFrame>(
  frames: F[],
  lat: number,
  lng: number,
): F[][] {
  const byTime = new Map<string, F[]>();
  for (const f of frames) {
    if (!covers(f, lat, lng)) continue;
    const key = new Date(f.validTime).toISOString();
    const group = byTime.get(key);
    if (group) group.push(f);
    else byTime.set(key, [f]);
  }
  return [...byTime.entries()]
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
    .map(([, group]) => group.sort((a, b) => a.grid.res - b.grid.res));
}

export function pickFramesForPoint<F extends PickableFrame>(frames: F[], lat: number, lng: number): F[] {
  return pickFrameCandidatesForPoint(frames, lat, lng).map((group) => group[0]);
}
