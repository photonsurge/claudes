import { readFile } from "node:fs/promises";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";
import type { AdminAreaInput } from "@photonsurge/shared/db/admin-area-geom-repo";
import { windGeometry } from "@photonsurge/shared/alerts/rings";
import { log } from "@photonsurge/shared/utill/logger";
import { storableGeometry } from "./repair";
import { gadmNameKey } from "./gadmNameKey";
import { geomAnchor, resolveAreaNames } from "./nameResolve";
import { unzipFirstEntry } from "./unzip";

const TAG = "alerts:gadm";

/**
 * Import GADM administrative boundaries so China's CMA warnings can be drawn.
 *
 * CMA (sender `cn-cma-xx`) is the opposite of NUTS: it ships neither a geocode nor
 * a polygon, only an English county NAME ("Jinghe County"). MEASURED against the
 * live feed, 42% of CMA areas already arrive with a polygon (via WMO); of the rest,
 * folding the name to a GADM county fills 78% unambiguously (84% with sibling
 * disambiguation) — see [[alert-geometry-emma-cache]]. So this loads GADM's county
 * polygons keyed by a normalised name, and the ingest/reconcile resolver joins on it.
 *
 * LICENSE — READ BEFORE CHANGING THE SOURCE. GADM 4.1 is free to USE but may NOT be
 * redistributed and is non-commercial. So the data is NEVER committed to the repo
 * and NEVER re-served: it is fetched on the operator's explicit request and only
 * its resolved boundaries are copied onto alert docs. `parseGadmFeatures` is
 * source-agnostic — point `GADM_FILE`/`GADM_URL` at an OSM/ODbL county export of the
 * same shape (a FeatureCollection with an English name + polygon) to make the
 * boundary set redistributable. Unlike GISCO/NUTS (CC-BY, fetched freely), this one
 * has strings attached.
 */

const SCHEME = (process.env.GADM_SCHEME || "GADM3").toUpperCase();
const COUNTRY = process.env.GADM_COUNTRY || "CN";
const SENDER = (process.env.GADM_SENDER || "cn-cma-xx").toLowerCase();
const SOURCE = process.env.GADM_SOURCE_TAG || "gadm-4.1";
// A local unzipped .json wins if set (dev/offline); otherwise fetch + unzip the URL.
const FILE = process.env.GADM_FILE || "";
const URL = process.env.GADM_URL || "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_3.json.zip";

interface GadmFeature {
  properties?: { GID_3?: string; NAME_3?: string; NAME_1?: string; GID_0?: string };
  geometry: AlertGeometry | null;
}

/**
 * Parse a GADM level-3 FeatureCollection into name-keyed admin areas. Pure — the
 * tests drive it. Keeps a feature only if it has a unique code (GID_3), a name to
 * join on (NAME_3), and geometry Mongo's 2dsphere will actually store.
 */
export function parseGadmFeatures(body: string): { areas: AdminAreaInput[]; skipped: number } {
  let doc: { features?: GadmFeature[] };
  try {
    doc = JSON.parse(body);
  } catch {
    return { areas: [], skipped: 0 };
  }
  const feats = Array.isArray(doc?.features) ? doc.features : [];
  const areas: AdminAreaInput[] = [];
  let skipped = 0;
  for (const f of feats) {
    const code = f?.properties?.GID_3;
    const name = f?.properties?.NAME_3;
    if (!code || !name) {
      skipped++;
      continue;
    }
    // Anchor from the ORIGINAL shape (repair only has to satisfy the 2dsphere; the
    // centroid only has to name the right province for disambiguation).
    const centroid = geomAnchor(f.geometry) ?? undefined;
    const geometry = storableGeometry(windGeometry(f.geometry));
    if (!geometry) {
      skipped++;
      continue;
    }
    areas.push({
      scheme: SCHEME,
      code,
      countryCode: f.properties?.GID_0 === "CHN" ? "CN" : COUNTRY,
      name,
      nameKey: gadmNameKey(name),
      centroid,
      geometry,
      source: SOURCE,
    });
  }
  return { areas, skipped };
}

async function fetchGadm(): Promise<string> {
  if (FILE) return readFile(FILE, "utf8");
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`GADM ${URL}: ${r.status} ${r.statusText}`);
  if (URL.endsWith(".zip")) {
    const buf = Buffer.from(await r.arrayBuffer());
    return unzipFirstEntry(buf).toString("utf8");
  }
  return r.text();
}

export interface GadmImportResult {
  scheme: string;
  fetched: number;
  stored: number;
  skipped: number;
  /** Stored CMA alerts retro-fitted with a county boundary they were missing. */
  backfilled: number;
  /** Of those, how many were a shared name disambiguated by a sibling polygon. */
  disambiguated: number;
  failures: string[];
}

/**
 * Retro-fit stored active CMA alerts that a name we now hold can draw.
 *
 * The ingest resolver only ever sees NEW alerts, and CMA warnings that don't change
 * are never rewritten, so without this a warning stored before the import stays
 * shapeless until it expires. Mirrors the NUTS/EMMA reconciles — but per-alert,
 * because disambiguating a shared county name needs the alert's other areas. Costs
 * no network; in the steady state (nothing missing) it writes nothing.
 */
export async function reconcileGadmGeometry(
  db: AppDb,
): Promise<{ backfilled: number; disambiguated: number; failures: string[] }> {
  const out = { backfilled: 0, disambiguated: 0, failures: [] as string[] };
  const alerts = await db.alerts.activeAlertsBySender([SENDER]);
  if (!alerts.length) return out;

  const keys = new Set<string>();
  for (const a of alerts) {
    for (const area of a.areas) {
      if ((area.geometry as { coordinates?: unknown } | null)?.coordinates) continue;
      const k = gadmNameKey(area.areaDesc);
      if (k) keys.add(k);
    }
  }
  if (!keys.size) return out;

  const cache = await db.adminAreaGeom.byNameKeys(SCHEME, [...keys]);
  if (!cache.size) return out;

  const rows: { identifier: string; areaDesc: string; geometry: AlertGeometry }[] = [];
  for (const a of alerts) {
    for (const d of resolveAreaNames(a.areas, cache)) {
      const areaDesc = a.areas[d.index].areaDesc;
      if (!areaDesc) continue;
      rows.push({ identifier: a.identifier, areaDesc, geometry: d.geometry });
      if (d.disambiguated) out.disambiguated++;
    }
  }
  try {
    out.backfilled = await db.alerts.backfillAreaGeometryByName(rows);
  } catch (err) {
    out.failures.push(`backfill: ${String((err as Error)?.message ?? err)}`);
  }
  if (out.backfilled) log(TAG, `reconciled GADM boundaries onto stored CMA alerts`, out);
  return out;
}

/** Fetch GADM, load the name-keyed cache, and retro-fit stored CMA alerts. */
export async function importGadmBoundaries(db: AppDb): Promise<GadmImportResult> {
  const res: GadmImportResult = {
    scheme: SCHEME,
    fetched: 0,
    stored: 0,
    skipped: 0,
    backfilled: 0,
    disambiguated: 0,
    failures: [],
  };
  try {
    const { areas, skipped } = parseGadmFeatures(await fetchGadm());
    res.fetched = areas.length + skipped;
    res.skipped = skipped;
    if (areas.length) res.stored = (await db.adminAreaGeom.upsertMany(areas)).upserted;
  } catch (err) {
    res.failures.push(String((err as Error)?.message ?? err));
  }

  const rec = await reconcileGadmGeometry(db);
  res.backfilled = rec.backfilled;
  res.disambiguated = rec.disambiguated;
  res.failures.push(...rec.failures);

  log(TAG, `GADM import`, { ...res, failures: res.failures.length });
  return res;
}
