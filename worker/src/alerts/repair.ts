import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { windGeometry } from "@photonsurge/shared/alerts/rings";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * Make a source polygon storable, for the small number that aren't.
 *
 * Mongo's 2dsphere refuses a ring that touches itself ("Can't extract geo keys"
 * / "Loop is not valid"), and some official boundaries genuinely do. Croatia's
 * South Dalmatia (HR806) is the real one: a 1,794-point coastline whose vertex 0
 * reappears at vertex 1,790, with a 3-point tail looping back to the same
 * spot — one main loop plus a tiny appendix, pinched at a single vertex. S2 has
 * no way to say which side is inside, so it rejects the whole shape, the area
 * never gets a footprint, and every alert over it stays undrawable.
 *
 * This lives in the WORKER because polygon-clipping does, and it stays out of
 * public. Geometry is repaired ONCE on the way into the permanent cache, so
 * nothing downstream ever meets a shape Mongo won't take.
 */

/**
 * Does any ring visit the same vertex twice (the closing repeat aside)?
 *
 * The cheap, precise test for the pinch above — and deliberately the ONLY thing
 * that triggers a repair. Validated against every cached area: of 316, it flags
 * exactly the 3 Mongo refuses, with no false positives. That matters, because
 * repairing means pushing a polygon through polygon-clipping, and that library
 * is quite capable of returning a shape worse than the one it was given. Good
 * geometry must not go near it.
 */
export function selfTouching(g: AlertGeometry | null | undefined): boolean {
  for (const poly of partsOf(g)) {
    for (const ring of poly) {
      if (!Array.isArray(ring)) continue;
      const seen = new Set<string>();
      // Length-1: the closing vertex repeats the first by definition.
      for (let i = 0; i < ring.length - 1; i++) {
        const key = `${ring[i]?.[0]},${ring[i]?.[1]}`;
        if (seen.has(key)) return true;
        seen.add(key);
      }
    }
  }
  return false;
}

/** Polygon/MultiPolygon → a uniform list of polygons. Anything else is empty. */
function partsOf(g: AlertGeometry | null | undefined): [number, number][][][] {
  // A `type` without usable `coordinates` is a malformed source doc, not a
  // polygon — treat it as nothing rather than trusting the type field.
  if (!Array.isArray(g?.coordinates)) return [];
  if (g.type === "MultiPolygon") {
    return (g.coordinates as unknown[]).filter(Array.isArray) as [number, number][][][];
  }
  if (g.type === "Polygon") return [g.coordinates as unknown as [number, number][][]];
  return [];
}

/**
 * Normalise a self-touching polygon into one Mongo accepts.
 *
 * polygon-clipping's sweep-line rebuilds the rings from their edges, so unioning
 * a shape with nothing resolves the pinch — it decides what's enclosed and emits
 * clean, non-self-touching rings. Verified on all three real offenders (HR804,
 * HR806, CZ06203): 8–107ms each, all three accepted afterwards.
 *
 * Returns null if it can't be saved, so the caller falls back rather than caching
 * a shape that will fail on every write forever.
 */
export function repairGeometry(g: AlertGeometry | null | undefined): AlertGeometry | null {
  const parts = partsOf(g);
  if (!parts.length) return null;

  let unioned: MultiPolygon;
  try {
    unioned = polygonClipping.union(parts as unknown as MultiPolygon);
  } catch {
    return null;
  }
  if (!unioned?.length) return null;

  const out = windGeometry({
    type: "MultiPolygon",
    coordinates: unioned,
  } as unknown as AlertGeometry);

  // A repair that leaves the shape still touching itself hasn't repaired it.
  return out && !selfTouching(out) ? out : null;
}

/**
 * The storable form of a source polygon: as-is when it's fine, repaired when it
 * isn't, null when it can't be saved. The one entry point worth calling.
 */
export function storableGeometry(g: AlertGeometry | null | undefined): AlertGeometry | null {
  if (!g) return null;
  if (!selfTouching(g)) return g;
  return repairGeometry(g);
}

/** The collection calls this pass needs. Injected so it tests without a database. */
export interface RepairDeps {
  uncheckedAreas(limit: number): Promise<{ emmaId: string; geometry: AlertGeometry }[]>;
  markChecked(emmaId: string, geometry?: AlertGeometry | null): Promise<void>;
}

export interface RepairStats {
  /** Boundaries examined this pass. */
  checked: number;
  /** Boundaries that were self-touching and are now storable. */
  repaired: number;
  /** Self-touching AND beyond saving — they keep the shape they had. */
  unfixable: number;
}

/**
 * Heal boundaries cached before geometry was repaired on the way in.
 *
 * Needed because the cache is write-once: a resolved area is marked seen and
 * never fetched again, so a bad shape would sit there being rejected by every
 * backfill forever with nothing left to re-download. This re-examines the
 * existing rows in place — no MeteoGate quota, no network — and marks each so
 * the backlog drains once and never comes back.
 */
export async function repairCachedGeometry(
  db: RepairDeps,
  limit = 200,
): Promise<RepairStats> {
  const stats: RepairStats = { checked: 0, repaired: 0, unfixable: 0 };

  for (const area of await db.uncheckedAreas(limit)) {
    stats.checked++;
    if (!selfTouching(area.geometry)) {
      await db.markChecked(area.emmaId);
      continue;
    }
    const fixed = repairGeometry(area.geometry);
    if (fixed) stats.repaired++;
    else stats.unfixable++;
    // Marked either way: an unfixable shape re-examined every run is just a
    // slow way to never finish the sweep.
    await db.markChecked(area.emmaId, fixed);
  }
  return stats;
}
