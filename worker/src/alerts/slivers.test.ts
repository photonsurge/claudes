import {
  dropSliverHoles,
  ringArea,
  thinness,
  isSeam,
  MIN_HOLE_AREA_DEG2,
  MAX_SEAM_AREA_DEG2,
  type SliverStats,
} from "./slivers";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * The union leaves hairline gaps where two counties' borders don't match to the
 * micron, and they come back as HOLES that the globe draws an outline round —
 * the streaks across the middle of Poland and Texas. Measured on a live rebuild:
 * 7,608 of them across 624 blobs, holding 18% of every vertex stored.
 *
 * The risk being managed here is the opposite one: a real enclave with no warning
 * over it is also a hole, and dropping THAT would paint a warning over somewhere
 * that hasn't got one.
 */

/** A closed square ring of side `s` at (x, y). */
const square = (x: number, y: number, s: number): number[][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

const outer = square(0, 0, 10); // a big country-sized shape

const polygon = (rings: number[][][]): AlertGeometry =>
  ({ type: "Polygon", coordinates: rings }) as unknown as AlertGeometry;

const holesOf = (g: AlertGeometry | null | undefined): number =>
  ((g as { coordinates: number[][][] }).coordinates.length - 1);

describe("ringArea", () => {
  it("measures a square", () => {
    expect(ringArea(square(0, 0, 2))).toBeCloseTo(4);
  });

  it("ignores winding — a hole is wound the other way and still has an area", () => {
    const cw = [...square(0, 0, 2)].reverse();
    expect(ringArea(cw)).toBeCloseTo(4);
  });

  it("gives a hairline seam a vanishing area", () => {
    // 1° long, 1e-6° wide: the shape of a real sliver — long enough to look like
    // a line on screen, thin enough to be nothing.
    const seam = [[0, 0], [1, 0], [1, 1e-6], [0, 1e-6], [0, 0]];
    expect(ringArea(seam)).toBeLessThan(MIN_HOLE_AREA_DEG2);
  });
});

describe("dropSliverHoles", () => {
  it("drops a LONG hairline seam — the shape the streaks actually were", () => {
    // 4° long, 11m wide. Its AREA is 4e-4 deg², bigger than plenty of real
    // enclaves, so the area rule alone kept it. This is the regression: an area
    // threshold cannot see a seam, only its shape can.
    const seam = [[1, 1], [5, 1], [5, 1.0001], [1, 1.0001], [1, 1]];
    expect(ringArea(seam)).toBeGreaterThan(MIN_HOLE_AREA_DEG2); // area says "keep"

    expect(holesOf(dropSliverHoles(polygon([outer, seam])))).toBe(0); // shape says "seam"
  });

  it("drops a hairline seam left between two counties", () => {
    const seam = [[1, 1], [1.5, 1], [1.5, 1.00001], [1, 1.00001], [1, 1]];

    expect(holesOf(dropSliverHoles(polygon([outer, seam])))).toBe(0);
  });

  it("KEEPS a real enclave — somewhere with no warning must stay uncovered", () => {
    // A county-sized hole (1°, ~110km). Dropping this would paint a warning over
    // a place that hasn't got one, which is worse than any seam.
    const enclave = square(3, 3, 1);
    const out = dropSliverHoles(polygon([outer, enclave]));

    expect(holesOf(out)).toBe(1);
  });

  it("keeps the outer ring even when it is tiny — a small island is real", () => {
    // Outer rings are never dropped: the Greek and Croatian coasts are made of
    // islands smaller than the hole threshold, and losing a warning off the globe
    // is worse than drawing a seam.
    const island = polygon([square(0, 0, 0.001)]);

    expect(dropSliverHoles(island)).toBe(island);
  });

  it("separates the two populations at the measured threshold", () => {
    // From the live rebuild: the median hole is ~1.7e-7 deg² and real holes are
    // three orders of magnitude bigger. Both sides of that gap, pinned.
    const sliver = square(2, 2, 0.001); // 1e-6 deg²
    const real = square(5, 5, 0.5); // 0.25 deg²
    const out = dropSliverHoles(polygon([outer, sliver, real]));

    expect(holesOf(out)).toBe(1);
    expect((out as { coordinates: number[][][] }).coordinates[1]).toBe(real);
  });

  /**
   * The failure that matters. A seam drawn on the globe is ugly; a REAL void
   * deleted means a warning painted over somewhere that never had one — we'd be
   * telling a viewer a place is under a warning when it isn't. Every one of these
   * must survive.
   */
  describe("never removes a real void", () => {
    it("keeps a LONG THIN valley — thinness alone would have eaten it", () => {
      // 2° long x 0.01° wide: thinness 0.0156, DEEP in the seam range, but area
      // 2e-2 deg² — above the ceiling. This is the exact case where the two rules
      // disagree and the ceiling has to win. Measured: a thinness-only rule
      // dropped a live hole of 1.4e-1 deg² (~40km) purely for being elongated.
      const valley = [[2, 2], [4, 2], [4, 2.01], [2, 2.01], [2, 2]];
      expect(thinness(valley)).toBeLessThan(0.05); // shape says "seam"
      expect(ringArea(valley)).toBeGreaterThan(MAX_SEAM_AREA_DEG2); // size says "real"

      expect(isSeam(valley, MIN_HOLE_AREA_DEG2)).toBe(false); // real wins
    });

    it("keeps ANY hole above the ceiling, whatever shape it is", () => {
      // The invariant, stated directly: county-scale is never touched.
      const shapes = [
        square(2, 2, 0.2), // compact, 0.04 deg²
        [[2, 2], [6, 2], [6, 2.05], [2, 2.05], [2, 2]], // long and thin, 0.2 deg²
        square(3, 3, 1), // a whole county
      ];

      for (const s of shapes) {
        if (ringArea(s) <= MAX_SEAM_AREA_DEG2) throw new Error("bad fixture: below the ceiling");
        expect(isSeam(s, MIN_HOLE_AREA_DEG2)).toBe(false);
      }
    });

    it("keeps a compact enclave far smaller than the ceiling", () => {
      // ~3km across and round: too small for the ceiling to protect it, but its
      // SHAPE says place, not seam.
      const hamlet = square(3, 3, 0.03); // 9e-4 deg², thinness ~0.79
      expect(ringArea(hamlet)).toBeLessThan(MAX_SEAM_AREA_DEG2);

      expect(isSeam(hamlet, MIN_HOLE_AREA_DEG2)).toBe(false);
    });
  });

  describe("thinness", () => {
    it("scores a square ~0.79 and a seam near zero", () => {
      expect(thinness(square(0, 0, 1))).toBeCloseTo(Math.PI / 4, 2);
      expect(thinness([[0, 0], [1, 0], [1, 1e-5], [0, 1e-5], [0, 0]])).toBeLessThan(0.001);
    });

    it("is scale-free — a big square and a small one score the same", () => {
      // So the rule reads shape, not size; size is the ceiling's job.
      expect(thinness(square(0, 0, 10))).toBeCloseTo(thinness(square(0, 0, 0.01)), 6);
    });

    it("does not divide by zero on a degenerate ring", () => {
      expect(thinness([[1, 1], [1, 1], [1, 1]])).toBe(0);
    });
  });

  it("reports what it dropped, so the saving shows up in the job log", () => {
    const stats: SliverStats = { dropped: 0, vertices: 0 };
    const seam = square(1, 1, 0.0001);

    dropSliverHoles(polygon([outer, seam, square(4, 4, 2)]), MIN_HOLE_AREA_DEG2, stats);

    expect(stats.dropped).toBe(1);
    expect(stats.vertices).toBe(seam.length);
  });

  it("cleans every part of a MultiPolygon", () => {
    const multi = {
      type: "MultiPolygon",
      coordinates: [
        [square(0, 0, 10), square(1, 1, 0.001)],
        [square(20, 20, 10), square(21, 21, 0.001)],
      ],
    } as unknown as AlertGeometry;

    const out = dropSliverHoles(multi) as { coordinates: number[][][][] };

    expect(out.coordinates[0]).toHaveLength(1);
    expect(out.coordinates[1]).toHaveLength(1);
  });

  it("returns the input by identity when there's nothing to drop", () => {
    // The common case must not allocate a copy of a 40k-vertex shape.
    const clean = polygon([outer, square(3, 3, 1)]);

    expect(dropSliverHoles(clean)).toBe(clean);
  });

  it("leaves a shape with no holes alone", () => {
    const plain = polygon([outer]);

    expect(dropSliverHoles(plain)).toBe(plain);
  });

  it("keeps every hole when switched off", () => {
    const g = polygon([outer, square(1, 1, 0.0001)]);

    expect(dropSliverHoles(g, 0)).toBe(g);
  });

  it("refuses nonsense instead of throwing at a rebuild", () => {
    expect(dropSliverHoles(null)).toBeNull();
    expect(dropSliverHoles(undefined)).toBeUndefined();
    const pt = { type: "Point", coordinates: [1, 2] } as unknown as AlertGeometry;
    expect(dropSliverHoles(pt)).toBe(pt);
  });
});
