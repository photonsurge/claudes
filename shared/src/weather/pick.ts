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

export function pickFramesForPoint<F extends PickableFrame>(frames: F[], lat: number, lng: number): F[] {
  const byTime = new Map<string, F>();
  for (const f of frames) {
    if (!latLngToPixel(lat, lng, { bounds: f.bounds, res: f.grid.res, width: f.grid.width, height: f.grid.height })) {
      continue;
    }
    const key = new Date(f.validTime).toISOString();
    const kept = byTime.get(key);
    if (!kept || f.grid.res < kept.grid.res) byTime.set(key, f);
  }
  return [...byTime.values()].sort(
    (a, b) => new Date(a.validTime).getTime() - new Date(b.validTime).getTime(),
  );
}
