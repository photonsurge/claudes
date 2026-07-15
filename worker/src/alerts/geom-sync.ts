import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import {
  fetchCountryFeatures,
  meteogateCountries,
  resolveFeature,
  type EdrFeature,
} from "./meteogate";

const TAG = "alerts:geom-sync";

export interface GeomSyncResult {
  /** Countries swept without error. */
  countries: number;
  /** EDR features seen across all countries. */
  features: number;
  /** Alerts we actually resolved (each costs two small fetches). */
  resolved: number;
  /** EMMA areas written (new boundary or a bbox→exact upgrade). */
  cached: number;
  /** Alerts skipped because the ledger had already resolved them. */
  skipped: number;
  failures: string[];
}

/**
 * Fill the EMMA_ID → boundary cache from MeteoGate.
 *
 * Cost control is the whole design. Resolving an alert costs two fetches, and
 * Europe carries thousands of live alerts, so we resolve as few as possible:
 * one feature per alertId (a feature exists per language × area), skip alertIds
 * the ledger has already resolved, and stop once `budget` new resolutions land.
 * The cache is permanent and the ledger is TTL'd, so a steady-state run resolves
 * only genuinely new alerts and usually writes nothing.
 *
 * Deliberately tolerant: one country's failure must not lose the rest of Europe.
 */
export async function syncAreaGeometry(
  db: AppDb,
  opts: { now?: Date; budget?: number } = {},
): Promise<GeomSyncResult> {
  const now = opts.now ?? new Date();
  const budget = opts.budget ?? Number(process.env.METEOGATE_BUDGET || 400);
  const res: GeomSyncResult = {
    countries: 0,
    features: 0,
    resolved: 0,
    cached: 0,
    skipped: 0,
    failures: [],
  };

  // One feature per alert: the feed repeats each alert per language and per area,
  // and they all resolve through the same linked CAP document.
  const byAlert = new Map<string, EdrFeature>();
  for (const cc of meteogateCountries()) {
    try {
      const feats = await fetchCountryFeatures(cc, now);
      res.features += feats.length;
      res.countries++;
      for (const f of feats) if (!byAlert.has(f.alertId)) byAlert.set(f.alertId, f);
    } catch (err) {
      res.failures.push(`${cc}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  const seen = await db.alertAreaGeom.seenAlertIds([...byAlert.keys()]);
  const todo = [...byAlert.values()].filter((f) => !seen.has(f.alertId));
  res.skipped = byAlert.size - todo.length;

  const areas = [];
  const marks: { alertId: string; emmaId?: string }[] = [];
  for (const f of todo.slice(0, budget)) {
    try {
      const { area, emmaId } = await resolveFeature(f);
      res.resolved++;
      // Mark even when it yielded no area: an alert with no EMMA_ID will never
      // resolve, so remembering it stops us paying for it again every run.
      marks.push({ alertId: f.alertId, emmaId });
      if (area) areas.push(area);
    } catch (err) {
      // Leave it unmarked so a later run retries this alert.
      res.failures.push(`${f.alertId}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  if (areas.length) {
    const r = await db.alertAreaGeom.upsertAreas(areas);
    res.cached = r.upserted;
  }
  await db.alertAreaGeom.markSeen(marks);

  if (todo.length > budget) {
    log(TAG, `budget reached — ${todo.length - budget} alerts deferred to the next run`, {
      budget,
      pending: todo.length - budget,
    });
  }
  return res;
}
