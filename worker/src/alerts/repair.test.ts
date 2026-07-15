import { selfTouching, repairGeometry, storableGeometry, repairCachedGeometry } from "./repair";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";
import hr806 from "./__fixtures__/hr806-self-touching-ring.json";

/**
 * The real thing, baked in: Croatia's South Dalmatia coastline (HR806) exactly as
 * MeteoGate served it. Mongo's 2dsphere refuses it — a 1,794-point ring whose
 * vertex 0 reappears at vertex 1,790, with a 3-point tail looping back to the
 * same spot: one main loop plus a tiny appendix, pinched at a single vertex. S2
 * can't tell which side is inside, so the area got NO footprint and every alert
 * over it stayed undrawable.
 *
 * Kept as a fixture so this needs no network, no MeteoGate quota, and no live
 * database to reproduce — and so the bug can't quietly return.
 */
const REAL = hr806 as unknown as AlertGeometry;

const square = (): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
});

/** Two loops meeting at one vertex — the shape of the real bug, in miniature. */
const pinched = (): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0], [-1, -1], [-2, 0], [0, 0]]],
});

describe("selfTouching", () => {
  it("spots the real HR806 coastline", () => {
    expect(selfTouching(REAL)).toBe(true);
  });

  it("leaves an ordinary polygon alone", () => {
    // Load-bearing: repairing means pushing a shape through polygon-clipping,
    // which can return something worse than it was given. Good geometry must not
    // go near it. Measured over every cached area: 3 flagged, 0 false positives.
    expect(selfTouching(square())).toBe(false);
  });

  it("does not mistake the closing vertex for a self-touch", () => {
    // Every ring repeats its first point at the end. That's closure, not a pinch.
    expect(selfTouching(pinched())).toBe(true);
    expect(selfTouching({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe(false);
  });

  it("checks holes, not just the outer ring", () => {
    const holed: AlertGeometry = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]],
        [[1, 1], [3, 1], [3, 3], [1, 1], [0.5, 0.5], [1, 1]],
      ],
    };
    expect(selfTouching(holed)).toBe(true);
  });

  it("checks every part of a MultiPolygon", () => {
    const multi: AlertGeometry = {
      type: "MultiPolygon",
      coordinates: [square().coordinates as never, pinched().coordinates as never],
    };
    expect(selfTouching(multi)).toBe(true);
  });

  it("says no to a Point, a null and a nonsense shape", () => {
    expect(selfTouching({ type: "Point", coordinates: [1, 2] } as AlertGeometry)).toBe(false);
    expect(selfTouching(null)).toBe(false);
    expect(selfTouching({ type: "Polygon" } as AlertGeometry)).toBe(false);
  });
});

describe("repairGeometry", () => {
  it("makes the real HR806 coastline storable", () => {
    const fixed = repairGeometry(REAL);

    expect(fixed).not.toBeNull();
    expect(selfTouching(fixed)).toBe(false);
  });

  it("keeps HR806 where it actually is", () => {
    // A repair that moves Dalmatia is not a repair. Measured against the input's
    // OWN extent rather than coordinates I'd have to guess at.
    // Depth-agnostic: the input is a Polygon, the repair returns a MultiPolygon,
    // so a fixed `flat()` silently yields NaN for one of them.
    const points = (c: unknown): number[][] =>
      typeof (c as number[])[0] === "number"
        ? [c as number[]]
        : (c as unknown[]).flatMap(points);

    const bounds = (g: AlertGeometry) => {
      const pts = points(g.coordinates);
      const lng = pts.map((p) => p[0]);
      const lat = pts.map((p) => p[1]);
      return [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)];
    };

    const before = bounds(REAL);
    const after = bounds(repairGeometry(REAL)!);

    // The pinch is one vertex; resolving it must not move the coastline.
    for (let i = 0; i < 4; i++) expect(after[i]).toBeCloseTo(before[i], 6);
  });

  it("resolves a pinch into clean rings", () => {
    const fixed = repairGeometry(pinched());

    expect(fixed).not.toBeNull();
    expect(selfTouching(fixed)).toBe(false);
  });

  it("returns null rather than a shape that's still broken", () => {
    expect(repairGeometry({ type: "Point", coordinates: [1, 2] } as AlertGeometry)).toBeNull();
    expect(repairGeometry(null)).toBeNull();
  });
});

describe("storableGeometry", () => {
  it("hands back a good polygon untouched, not a rebuilt one", () => {
    const g = square();

    // Identity: the clean path must not go through polygon-clipping at all.
    expect(storableGeometry(g)).toBe(g);
  });

  it("repairs a bad one", () => {
    const out = storableGeometry(REAL);

    expect(out).not.toBeNull();
    expect(out).not.toBe(REAL);
    expect(selfTouching(out)).toBe(false);
  });

  it("passes a Point through — it has no rings to pinch", () => {
    const pt = { type: "Point", coordinates: [1, 2] } as AlertGeometry;
    expect(storableGeometry(pt)).toBe(pt);
  });
});

describe("repairCachedGeometry", () => {
  /** The cache, as the heal pass sees it. */
  function mockCache(areas: { emmaId: string; geometry: AlertGeometry }[]) {
    const marked: { emmaId: string; replaced: boolean }[] = [];
    return {
      marked,
      db: {
        uncheckedAreas: async (limit: number) => areas.slice(0, limit),
        markChecked: async (emmaId: string, geometry?: AlertGeometry | null) => {
          marked.push({ emmaId, replaced: !!geometry });
        },
      },
    };
  }

  it("fixes the stored HR806 in place, without re-fetching it", async () => {
    // The cache is write-once — a resolved area is never fetched again — so a bad
    // shape would be rejected by every backfill forever with nothing to re-download.
    const { db, marked } = mockCache([{ emmaId: "HR806", geometry: REAL }]);

    const stats = await repairCachedGeometry(db);

    expect(stats).toMatchObject({ checked: 1, repaired: 1, unfixable: 0 });
    expect(marked).toEqual([{ emmaId: "HR806", replaced: true }]);
  });

  it("marks a healthy boundary without rewriting its geometry", async () => {
    const { db, marked } = mockCache([{ emmaId: "PL1423", geometry: square() }]);

    const stats = await repairCachedGeometry(db);

    expect(stats).toMatchObject({ checked: 1, repaired: 0 });
    expect(marked).toEqual([{ emmaId: "PL1423", replaced: false }]);
  });

  it("marks an unfixable shape too, so the sweep can finish", async () => {
    // Self-touching AND zero-area: there's no region to recover, so the repair
    // yields nothing. Re-examining a hopeless shape every run is a slow way to
    // never finish the sweep.
    const { db, marked } = mockCache([
      { emmaId: "BAD", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0], [2, 2], [0, 0]]] } },
    ]);

    const stats = await repairCachedGeometry(db);

    expect(stats.unfixable).toBe(1);
    expect(marked).toEqual([{ emmaId: "BAD", replaced: false }]);
  });

  it("honours the limit so a run can't eat the worker", async () => {
    const { db, marked } = mockCache(
      Array.from({ length: 10 }, (_, i) => ({ emmaId: `A${i}`, geometry: square() })),
    );

    const stats = await repairCachedGeometry(db, 3);

    expect(stats.checked).toBe(3);
    expect(marked).toHaveLength(3);
  });

  it("does nothing once the backlog is swept", async () => {
    const { db } = mockCache([]);

    expect(await repairCachedGeometry(db)).toMatchObject({ checked: 0, repaired: 0 });
  });
});
