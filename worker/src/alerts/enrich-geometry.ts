import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";

export interface GeomEnrichResult {
  /** Areas that arrived with no geometry and could be drawn after all. */
  filled: number;
  /** Of those, how many got the true boundary rather than the bbox fallback. */
  exact: number;
  /** Areas still geometry-less (EMMA area not resolved yet, or no EMMA_ID). */
  unresolved: number;
}

const EMMA = "EMMA_ID";

const emmaOf = (area: { geocodes?: { valueName: string; value: string }[] }): string | undefined =>
  area.geocodes?.find((g) => g.valueName?.toUpperCase() === EMMA)?.value || undefined;

const hasGeometry = (area: { geometry?: unknown }): boolean =>
  !!(area.geometry as { coordinates?: unknown } | null)?.coordinates;

/**
 * Give geocode-only alert areas a footprint, in place, before they're persisted.
 *
 * MeteoAlarm identifies an area by `EMMA_ID` and ships no polygon, so those
 * alerts render nowhere — no globe, no director framing. The EMMA boundary cache
 * (filled asynchronously by the MeteoGate sync) resolves that code to a real
 * shape, and since EMMA areas are stable administrative regions the join is a
 * single batched read per tick rather than a fetch per alert.
 *
 * Only ever ADDS geometry: an area that came with its own polygon (GDACS, WMO)
 * is left exactly as the source sent it.
 */
export async function enrichAreaGeometry(alerts: iAlert[], db: AppDb): Promise<GeomEnrichResult> {
  const res: GeomEnrichResult = { filled: 0, exact: 0, unresolved: 0 };

  const wanted: string[] = [];
  for (const a of alerts) {
    for (const info of a.info ?? []) {
      for (const area of info.area ?? []) {
        if (hasGeometry(area)) continue;
        const emma = emmaOf(area);
        if (emma) wanted.push(emma);
      }
    }
  }
  if (!wanted.length) return res;

  const cache = await db.alertAreaGeom.byEmmaIds(wanted);
  if (!cache.size) {
    res.unresolved = wanted.length;
    return res;
  }

  for (const a of alerts) {
    for (const info of a.info ?? []) {
      for (const area of info.area ?? []) {
        if (hasGeometry(area)) continue;
        const emma = emmaOf(area);
        const hit = emma ? cache.get(emma) : undefined;
        if (!hit) {
          if (emma) res.unresolved++;
          continue;
        }
        area.geometry = hit.geometry;
        res.filled++;
        if (hit.precision === "exact") res.exact++;
      }
    }
  }
  return res;
}
