import { AxisAlignedBoundingBox, makeOrientedBoundingBoxFromPoints } from "@math.gl/culling";
import {
  clearVolumeCache,
  installTileObbPatch,
  memoisedGetBoundingVolume,
  patchOsmNode,
  patchTileset,
  probeIsCacheable,
  projectionKey,
  volumeKey,
  type GetBoundingVolume,
  type Project,
} from "./tile-obb-patch";

const TILE_SIZE = 512;
const REF_POINTS_5 = [
  [0.5, 0.5],
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];
const REF_POINTS_9 = REF_POINTS_5.concat([
  [0, 0.5],
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
]);
const REF_POINTS_11 = REF_POINTS_9.concat([
  [0.25, 0.5],
  [0.75, 0.5],
]);

/** deck's own osmTile2lngLat (tileset-2d/utils.js). */
function osmTile2lngLat(x: number, y: number, z: number): number[] {
  const scale = Math.pow(2, z);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
}

/** The real `_GlobeViewport.projectPosition` — a prototype method that reads
 *  nothing off `this`, which is what makes the cache sound. */
const EARTH_RADIUS = 6370972;
const GLOBE_RADIUS = 256;
const projectPosition: Project = (xyz) => {
  const [lng, lat, Z = 0] = xyz;
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const D = (Z / EARTH_RADIUS + 1) * GLOBE_RADIUS;
  return [Math.sin(lambda) * cosPhi * D, -Math.cos(lambda) * cosPhi * D, Math.sin(phi) * D];
};

/** deck 9.3's OSMNode.getBoundingVolume, verbatim, over the real @math.gl/culling. */
class FakeOSMNode {
  static built = 0;
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}
  getBoundingVolume(zRange: number[], worldOffset: number, project: Project | null): unknown {
    FakeOSMNode.built++;
    if (project) {
      const refPoints = this.z < 1 ? REF_POINTS_11 : this.z < 2 ? REF_POINTS_9 : REF_POINTS_5;
      const refPointPositions: number[][] = [];
      for (const p of refPoints) {
        const lngLat = osmTile2lngLat(this.x + p[0], this.y + p[1], this.z);
        lngLat[2] = zRange[0];
        refPointPositions.push(project(lngLat));
        if (zRange[0] !== zRange[1]) {
          lngLat[2] = zRange[1];
          refPointPositions.push(project(lngLat));
        }
      }
      return makeOrientedBoundingBoxFromPoints(refPointPositions);
    }
    const scale = Math.pow(2, this.z);
    const extent = TILE_SIZE / scale;
    const originX = this.x * extent + worldOffset * TILE_SIZE;
    const originY = TILE_SIZE - (this.y + 1) * extent;
    return new AxisAlignedBoundingBox([originX, originY, zRange[0]], [originX + extent, originY + extent, zRange[1]]);
  }
}

const numbers = (v: unknown): number[] => {
  const { center, halfAxes } = v as { center: ArrayLike<number>; halfAxes: ArrayLike<number> };
  return [...Array.from(center), ...Array.from(halfAxes)];
};

/** A fresh, unpatched computation for the same tile — the parity reference. */
const truth = (x: number, y: number, z: number, zRange: number[]) =>
  numbers(FakeOSMNode.prototype.getBoundingVolume.call(new FakeOSMNode(x, y, z), zRange, 0, projectPosition));

describe("tile bounding-volume memo", () => {
  beforeEach(() => {
    FakeOSMNode.built = 0;
  });

  it("caches per (tile, elevation range) and returns exactly deck's own volume", () => {
    const original = FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume;
    // Every reference computed up front, so the counter below sees only the memo.
    const expected = truth(3, 5, 4, [0, 0]);
    const expectedOther = truth(4, 5, 4, [0, 0]);
    const expectedRaised = truth(3, 5, 4, [0, 100]);
    const wrapped = memoisedGetBoundingVolume(original);
    FakeOSMNode.built = 0;

    const first = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, projectPosition);
    const again = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, projectPosition);
    expect(again).toBe(first); // one volume, shared across frames
    expect(FakeOSMNode.built).toBe(1);
    expect(numbers(first)).toEqual(expected); // and it is deck's answer

    // A different tile, and a different elevation range, each get their own.
    const other = wrapped.call(new FakeOSMNode(4, 5, 4), [0, 0], 0, projectPosition);
    expect(numbers(other)).toEqual(expectedOther);
    const raised = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 100], 0, projectPosition);
    expect(numbers(raised)).toEqual(expectedRaised);
    expect(FakeOSMNode.built).toBe(3);
  });

  it("matches deck across the reference-point tiers and a swept camera", () => {
    const wrapped = memoisedGetBoundingVolume(FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume);
    // z 0 and 1 take the 11- and 9-point tiers; z ≥ 2 the 5-point one.
    const tiles: Array<[number, number, number]> = [
      [0, 0, 0],
      [1, 0, 1],
      [0, 1, 1],
      [2, 1, 2],
      [11, 7, 4],
      [40, 25, 6],
    ];
    // Ten "frames" over the same tiles: every answer stays deck's own.
    for (let frame = 0; frame < 10; frame++) {
      for (const [x, y, z] of tiles) {
        const v = wrapped.call(new FakeOSMNode(x, y, z), [0, 0], 0, projectPosition);
        expect(numbers(v)).toEqual(truth(x, y, z, [0, 0]));
      }
    }
  });

  it("leaves the Web Mercator branch alone (it does depend on worldOffset)", () => {
    const wrapped = memoisedGetBoundingVolume(FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume);
    FakeOSMNode.built = 0;
    const a = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, null);
    const b = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, null);
    expect(b).not.toBe(a); // never cached
    const shifted = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 1, null);
    expect((shifted as { minimum: number[] }).minimum[0]).not.toBe((a as { minimum: number[] }).minimum[0]);
    expect(FakeOSMNode.built).toBe(3);
    // A repeated-world offset on the projected branch is passed through too.
    FakeOSMNode.built = 0;
    wrapped.call(new FakeOSMNode(9, 9, 4), [0, 0], 1, projectPosition);
    wrapped.call(new FakeOSMNode(9, 9, 4), [0, 0], 1, projectPosition);
    expect(FakeOSMNode.built).toBe(2);
  });

  it("keys a volume by tile and elevation range", () => {
    expect(volumeKey({ x: 3, y: 5, z: 4 }, [0, 0])).toBe("4/3/5|0|0");
    expect(volumeKey({ x: 3, y: 5, z: 4 }, [0, 100])).not.toBe(volumeKey({ x: 3, y: 5, z: 4 }, [0, 0]));
  });

  it("patches the class once, and keeps deck's answers through it", () => {
    const expected = truth(11, 7, 4, [0, 0]);
    expect(patchOsmNode(FakeOSMNode)).toBe("patched");
    expect(patchOsmNode(FakeOSMNode)).toBe("already");
    const node = new FakeOSMNode(11, 7, 4);
    expect(numbers(node.getBoundingVolume([0, 0], 0, projectPosition))).toEqual(expected);
    expect(node.getBoundingVolume([0, 0], 0, projectPosition)).toBe(node.getBoundingVolume([0, 0], 0, projectPosition));
  });
});

describe("keying the projection by behaviour, not identity", () => {
  beforeEach(() => {
    clearVolumeCache();
    FakeOSMNode.built = 0;
  });

  // deck's Viewport constructor runs `this.projectPosition =
  // this.projectPosition.bind(this)`, and it builds a new viewport every frame
  // the camera moves — so the projection arrives as a DIFFERENT function object
  // every frame. Keying on identity made this cache a no-op.
  it("shares one cache across the per-frame bound copies deck hands out", () => {
    const wrapped = memoisedGetBoundingVolume(FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume);
    const frame1 = projectPosition.bind(null);
    const frame2 = projectPosition.bind(null);
    expect(frame1).not.toBe(frame2);
    const a = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, frame1);
    const b = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, frame2);
    expect(b).toBe(a);
    expect(FakeOSMNode.built).toBe(1);
  });

  it("gives a genuinely different projection its own volumes", () => {
    const wrapped = memoisedGetBoundingVolume(FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume);
    const twice: Project = (lngLat) => projectPosition(lngLat).map((n) => n * 2);
    const a = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, projectPosition);
    const b = wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, twice);
    expect(b).not.toBe(a);
    expect(numbers(b)).not.toEqual(numbers(a));
    expect(FakeOSMNode.built).toBe(2);
  });

  it("fingerprints equal behaviour alike and different behaviour apart", () => {
    expect(projectionKey(projectPosition)).toBe(projectionKey(projectPosition.bind(null)));
    expect(projectionKey((p) => projectPosition(p).map((n) => n + 1))).not.toBe(projectionKey(projectPosition));
  });

  it("declines to cache a projection that isn't one", () => {
    const wrapped = memoisedGetBoundingVolume(FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume);
    for (const bad of [
      (() => [NaN, 0, 0]) as Project,
      (() => [1, 2]) as Project,
      (() => {
        throw new Error("nope");
      }) as Project,
    ]) {
      expect(projectionKey(bad)).toBeNull();
    }
    const nanProject: Project = () => [NaN, 0, 0];
    FakeOSMNode.built = 0;
    // Passed straight through, so it fails exactly as it would unpatched —
    // @math.gl rejects the NaN — rather than being swallowed or cached.
    expect(() => wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, nanProject)).toThrow();
    expect(() => wrapped.call(new FakeOSMNode(3, 5, 4), [0, 0], 0, nanProject)).toThrow();
    expect(FakeOSMNode.built).toBe(2);
  });
});

describe("the cacheability probe", () => {
  it("accepts deck's own implementation", () => {
    expect(probeIsCacheable(FakeOSMNode.prototype.getBoundingVolume as GetBoundingVolume)).toBe(true);
  });

  it("rejects one that reads anything else off the node", () => {
    function readsCamera(this: { x: number; y: number; z: number; bearing?: number }) {
      return makeOrientedBoundingBoxFromPoints([
        [this.x, this.y, this.z],
        [this.x + 1, this.y, this.z],
        [this.x, this.y + 1, this.z],
        [this.x, this.y, this.z + (this.bearing as number)],
      ]);
    }
    expect(probeIsCacheable(readsCamera as unknown as GetBoundingVolume)).toBe(false);
  });

  it("rejects one whose projected branch uses worldOffset", () => {
    const usesOffset: GetBoundingVolume = function (this: { x: number; y: number; z: number }, zRange, worldOffset, project) {
      const p = project as Project;
      return makeOrientedBoundingBoxFromPoints([
        p([this.x + worldOffset, this.y, zRange[0]]),
        p([this.x + 1 + worldOffset, this.y, zRange[0]]),
        p([this.x + worldOffset, this.y + 1, zRange[0]]),
        p([this.x + worldOffset, this.y, zRange[1] + 1]),
      ]);
    };
    expect(probeIsCacheable(usesOffset)).toBe(false);
  });

  it("rejects a non-deterministic one, and one that ignores the tile", () => {
    const jitters: GetBoundingVolume = function () {
      const r = Math.random();
      return makeOrientedBoundingBoxFromPoints([
        [r, 0, 0],
        [1, r, 0],
        [0, 1, r],
        [r, r, 1],
      ]);
    };
    expect(probeIsCacheable(jitters)).toBe(false);
    const constant: GetBoundingVolume = () =>
      makeOrientedBoundingBoxFromPoints([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]);
    expect(probeIsCacheable(constant)).toBe(false);
  });

  it("rejects a method of the wrong arity, or one that throws", () => {
    class WrongArity {
      getBoundingVolume() {
        return null;
      }
    }
    expect(patchOsmNode(WrongArity)).toBe("skipped");
    class Throws {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      getBoundingVolume(_a: unknown, _b: unknown, _c: unknown): unknown {
        throw new Error("nope");
      }
    }
    expect(patchOsmNode(Throws)).toBe("skipped");
  });
});

describe("reaching the node class through the tileset", () => {
  it("patches the node class from the first geospatial result, then restores itself", () => {
    class Node2 extends FakeOSMNode {}
    class FakeTileset {
      static calls = 0;
      getTileIndices(): unknown[] {
        FakeTileset.calls++;
        return [new Node2(1, 2, 3)];
      }
    }
    const original = FakeTileset.prototype.getTileIndices;
    expect(patchTileset(FakeTileset)).toBe("patched");
    expect(patchTileset(FakeTileset)).toBe("already");
    expect(FakeTileset.prototype.getTileIndices).not.toBe(original);

    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    const out = new FakeTileset().getTileIndices();
    // Says out loud that the cache went live — the line to look for in the CEF
    // console, since a tile-less scene prints neither line.
    expect(info).toHaveBeenCalledWith("[globe] deck tile bounding-volume cache active");
    info.mockRestore();
    expect(out).toHaveLength(1); // the result is deck's, untouched
    expect(FakeTileset.calls).toBe(1);
    // The node class is patched and the wrapper has stepped back out.
    expect(patchOsmNode(Node2)).toBe("already");
    expect(FakeTileset.prototype.getTileIndices).toBe(original);
  });

  it("waits through non-geospatial results, which are plain {x, y, z}", () => {
    class FakeTileset {
      getTileIndices(): unknown[] {
        return [{ x: 1, y: 2, z: 3 }];
      }
    }
    const original = FakeTileset.prototype.getTileIndices;
    expect(patchTileset(FakeTileset)).toBe("patched");
    new FakeTileset().getTileIndices();
    new FakeTileset().getTileIndices();
    expect(FakeTileset.prototype.getTileIndices).not.toBe(original); // still waiting
  });

  it("skips a tileset with no getTileIndices, or none at all", () => {
    expect(patchTileset(class {})).toBe("skipped");
    expect(patchTileset(undefined)).toBe("skipped");
  });

  it("installs on the deck export, idempotently", () => {
    expect(installTileObbPatch()).toBe("patched");
    expect(installTileObbPatch()).toBe("patched");
  });
});
