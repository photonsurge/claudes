import type { AppDb } from "@photonsurge/shared/db/index";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";
import type { AdminAreaInput } from "@photonsurge/shared/db/admin-area-geom-repo";
import { windGeometry } from "@photonsurge/shared/alerts/rings";
import { storableGeometry } from "./repair";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "alerts:nuts";

/**
 * Import NUTS administrative boundaries from Eurostat GISCO into the admin-area
 * cache, so France (NUTS3) and Hungary (NUTS2) warnings — which ship a bare NUTS
 * code and no polygon — can be drawn.
 *
 * VINTAGE 2013. Measured against the live feed: 2013 covers 155/155 of the NUTS
 * codes our active alerts reference; 2016/2021/2024 cover 66/155 (the 2016
 * revision renamed most French codes — FR715 Loire → FRK25). Do not bump the year
 * without re-measuring what MeteoAlarm actually sends. See [[alert-source-overlap]].
 *
 * One-shot + idempotent: GISCO publishes the whole nomenclature as GeoJSON, so we
 * fetch it once, repair each shape the same way EMMA boundaries are (a polygon
 * Mongo's 2dsphere rejects becomes a permanent hole once it lands on an alert
 * doc), and bulk-upsert keyed on (scheme, code). Re-running refreshes in place.
 */

const YEAR = Number(process.env.NUTS_VINTAGE || 2013);
const RES = process.env.NUTS_RESOLUTION || "01M"; // GISCO generalisation: 01M is coarse enough for a globe
const BASE = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson";

/** The NUTS levels the feed actually uses: 2 (HU, BE) and 3 (FR). */
const LEVELS = (process.env.NUTS_LEVELS || "2,3").split(",").map((s) => Number(s.trim()));

interface NutsFeature {
  type: "Feature";
  properties: { NUTS_ID?: string; LEVL_CODE?: number; CNTR_CODE?: string; NUTS_NAME?: string };
  geometry: AlertGeometry | null;
}

/** Parse one GISCO level file into storable admin areas. Pure — the tests drive it. */
export function parseNutsFeatures(body: string): { areas: AdminAreaInput[]; skipped: number } {
  let doc: { features?: NutsFeature[] };
  try {
    doc = JSON.parse(body);
  } catch {
    return { areas: [], skipped: 0 };
  }
  const feats = Array.isArray(doc?.features) ? doc.features : [];
  const areas: AdminAreaInput[] = [];
  let skipped = 0;
  for (const f of feats) {
    const code = f?.properties?.NUTS_ID;
    const level = f?.properties?.LEVL_CODE;
    if (!code || level == null) {
      skipped++;
      continue;
    }
    // Repair on the way in — same reason as the EMMA cache. A shape the 2dsphere
    // would refuse is worthless the moment it's copied onto an alert doc.
    const geometry = storableGeometry(windGeometry(f.geometry));
    if (!geometry) {
      skipped++;
      continue;
    }
    areas.push({
      scheme: `NUTS${level}`,
      code,
      countryCode: f.properties?.CNTR_CODE,
      name: f.properties?.NUTS_NAME,
      geometry,
      source: `gisco:nuts-${YEAR}`,
    });
  }
  return { areas, skipped };
}

async function fetchLevel(level: number): Promise<string> {
  const url = `${BASE}/NUTS_RG_${RES}_${YEAR}_4326_LEVL_${level}.geojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GISCO ${url}: ${r.status} ${r.statusText}`);
  return r.text();
}

export interface NutsImportResult {
  levels: number[];
  fetched: number;
  stored: number;
  skipped: number;
  /** Stored alerts retro-fitted with a NUTS boundary they were missing. */
  backfilled: number;
  failures: string[];
}

/** The admin schemes this import produces, for the reconcile below. */
const SCHEMES = () => LEVELS.map((l) => `NUTS${l}`);

/**
 * Retro-fit stored alerts that reference a NUTS code we now hold.
 *
 * The ingest enrich only ever sees NEW alerts, so France/Hungary warnings stored
 * before this import stay shapeless until they expire. Mirrors the EMMA reconcile
 * (geom-sync#reconcileCachedGeometry) — costs no network, and in the steady state
 * (nothing missing) it writes nothing.
 */
export async function reconcileNutsGeometry(db: AppDb): Promise<{ backfilled: number; failures: string[] }> {
  const out = { backfilled: 0, failures: [] as string[] };
  const missing = await db.alerts.adminCodesMissingGeometry(SCHEMES());
  if (!missing.length) return out;

  const cache = await db.adminAreaGeom.byCodes(missing);
  for (const { scheme, code } of missing) {
    const geom = cache.get(`${scheme.toUpperCase()}:${code.toUpperCase()}`);
    if (!geom) continue; // code we don't hold (outside our levels/vintage) — not a miss
    try {
      out.backfilled += await db.alerts.backfillAdminGeometry(scheme, code, geom);
    } catch (err) {
      out.failures.push(`backfill ${scheme}:${code}: ${String((err as Error)?.message ?? err)}`);
    }
  }
  if (out.backfilled) log(TAG, `reconciled NUTS boundaries onto stored alerts`, { alerts: out.backfilled });
  return out;
}

/** Fetch every configured NUTS level, bulk-load the cache, and retro-fit alerts. */
export async function importNutsBoundaries(db: AppDb): Promise<NutsImportResult> {
  const res: NutsImportResult = { levels: LEVELS, fetched: 0, stored: 0, skipped: 0, backfilled: 0, failures: [] };
  const all: AdminAreaInput[] = [];
  for (const level of LEVELS) {
    try {
      const { areas, skipped } = parseNutsFeatures(await fetchLevel(level));
      res.fetched += areas.length + skipped;
      res.skipped += skipped;
      all.push(...areas);
    } catch (err) {
      res.failures.push(`level ${level}: ${String((err as Error)?.message ?? err)}`);
    }
  }
  if (all.length) res.stored = (await db.adminAreaGeom.upsertMany(all)).upserted;

  const rec = await reconcileNutsGeometry(db);
  res.backfilled = rec.backfilled;
  res.failures.push(...rec.failures);

  log(TAG, `NUTS ${YEAR} import`, { ...res, failures: res.failures.length });
  return res;
}
