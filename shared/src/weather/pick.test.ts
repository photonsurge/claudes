import { pickFramesForPoint, pickFrameCandidatesForPoint, type PickableFrame } from "./pick";

interface Frame extends PickableFrame {
  id: string;
}

const frame = (id: string, res: number, bounds: number[], validTime: string): Frame => ({
  id,
  res,
  bounds,
  validTime,
  grid: { width: Math.round((bounds[2] - bounds[0]) / res), height: Math.round((bounds[3] - bounds[1]) / res), res },
} as unknown as Frame);

const GLOBAL = [-180, -90, 180, 90];
const EUROPE = [-25, 30, 45, 72];

describe("pickFramesForPoint", () => {
  it("keeps the finest frame that covers the point, one per valid time", () => {
    const coarse = frame("gfs", 0.25, GLOBAL, "2026-09-16T00:00:00Z");
    const fine = frame("icon-eu", 0.0625, EUROPE, "2026-09-16T00:00:00Z");
    expect(pickFramesForPoint([coarse, fine], 51.5, -0.12).map((f) => f.id)).toEqual(["icon-eu"]);
    // Outside the nest, the global run is the only cover.
    expect(pickFramesForPoint([coarse, fine], -33.9, 151.2).map((f) => f.id)).toEqual(["gfs"]);
  });

  it("sorts by valid time", () => {
    const later = frame("b", 0.25, GLOBAL, "2026-09-16T06:00:00Z");
    const sooner = frame("a", 0.25, GLOBAL, "2026-09-16T00:00:00Z");
    expect(pickFramesForPoint([later, sooner], 5, 5).map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("pickFrameCandidatesForPoint", () => {
  it("returns every covering frame per time, finest first", () => {
    const coarse = frame("gfs", 0.25, GLOBAL, "2026-09-16T00:00:00Z");
    const fine = frame("icon-eu", 0.0625, EUROPE, "2026-09-16T00:00:00Z");
    const next = frame("gfs-2", 0.25, GLOBAL, "2026-09-16T03:00:00Z");
    const groups = pickFrameCandidatesForPoint([coarse, fine, next], 51.5, -0.12);
    expect(groups.map((g) => g.map((f) => f.id))).toEqual([["icon-eu", "gfs"], ["gfs-2"]]);
  });

  it("drops frames that do not cover the point at all", () => {
    const fine = frame("icon-eu", 0.0625, EUROPE, "2026-09-16T00:00:00Z");
    expect(pickFrameCandidatesForPoint([fine], -33.9, 151.2)).toEqual([]);
  });
});
