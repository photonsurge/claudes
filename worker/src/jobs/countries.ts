import { existsSync, readFileSync } from "node:fs";
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { simplifyRing, type Point } from "@photonsurge/shared/geo/simplify";
import { fetchWikiSummary, fetchWikiGallery } from "@photonsurge/shared/utill/wikipedia";
import { fetchCountryFacts } from "@photonsurge/shared/utill/wikidata";
import { computeCountryTour, type TourCityInput } from "@photonsurge/shared/director-country-tour";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { dataFile } from "../dataDir";

const TAG = "job:countries";

// Natural Earth admin-0 geojson. Overridable via WEATHER_DATA_DIR so the worker
// reads its own baked-in copy in Docker instead of the Next app's public dir.
const GEOJSON = dataFile("countries.geojson");

// ~5.5km at the equator — well under a GFS 0.25° pixel (~25km), so
// simplification can't change which grid cells the polygon mask includes.
const SIMPLIFY_TOLERANCE_DEG = 0.05;

type Ring = Point[];
/** [outer ring, ...hole rings]. */
type PolygonRings = Ring[];

function polygonsOf(geom: { type: string; coordinates: unknown }): PolygonRings[] {
  if (geom.type === "Polygon") return [geom.coordinates as PolygonRings];
  if (geom.type === "MultiPolygon") return geom.coordinates as PolygonRings[];
  return [];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

interface RawCountry {
  countryId: string;
  name: string;
  iso2?: string;
  iso3?: string;
  continent?: string;
  subregion?: string;
  polygons: PolygonRings[];
}

/**
 * Parse the bundled Natural Earth admin-0 GeoJSON into one entry per country,
 * MERGING every feature that shares an id (a country occasionally ships as
 * several admin-0 features). Unlike the camera-framing bbox baked by
 * `scripts/gen-country-bboxes.mjs` (biggest ring only, deliberately dropping
 * remote territories so the camera doesn't zoom out to fit them), the
 * area-weather mask needs the WHOLE country — every island of an archipelago
 * nation like Indonesia or the Philippines is real national territory, not an
 * overseas outlier to exclude.
 */
export function parseCountries(): RawCountry[] {
  if (!existsSync(GEOJSON)) {
    throw new Error(`countries.geojson not found at ${GEOJSON} — run ./fetch-assets.sh`);
  }
  const geo = JSON.parse(readFileSync(GEOJSON, "utf8")) as {
    features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[];
  };
  const byId = new Map<string, RawCountry>();
  for (const f of geo.features) {
    const p = f.properties || {};
    const name = (p.admin || p.name || p.name_long) as string | undefined;
    if (!name || /antarctica/i.test(name)) continue;
    const iso2raw = p.iso_a2;
    const iso2 = typeof iso2raw === "string" && /^[A-Za-z]{2}$/.test(iso2raw) ? iso2raw.toLowerCase() : undefined;
    const id = iso2 || slug(name);
    const polygons = polygonsOf(f.geometry);
    if (!polygons.length) continue;

    let entry = byId.get(id);
    if (!entry) {
      entry = {
        countryId: id,
        name,
        iso2: iso2?.toUpperCase(),
        iso3: typeof p.iso_a3 === "string" ? (p.iso_a3 as string) : undefined,
        continent: typeof p.continent === "string" ? (p.continent as string) : undefined,
        subregion: typeof p.subregion === "string" ? (p.subregion as string) : undefined,
        polygons: [],
      };
      byId.set(id, entry);
    }
    entry.polygons.push(...polygons);
  }
  return [...byId.values()];
}

function bboxOfPolygons(polygons: PolygonRings[]): [number, number, number, number] {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const rings of polygons) {
    for (const [lng, lat] of rings[0] ?? []) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [w, s, e, n];
}

/** Seed/refresh the full country catalog from the bundled Natural Earth GeoJSON. */
export async function runCountrySeed(): Promise<{ countries: number; upserted: number }> {
  const raw = parseCountries();
  const db = await getAppDb();
  const docs = raw.map((c) => ({
    countryId: c.countryId,
    name: c.name,
    iso2: c.iso2,
    iso3: c.iso3,
    continent: c.continent,
    subregion: c.subregion,
    bbox: bboxOfPolygons(c.polygons),
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: c.polygons.map((rings) => rings.map((ring) => simplifyRing(ring, SIMPLIFY_TOLERANCE_DEG))),
    },
  }));
  const res = await db.countries.upsertMany(docs);
  const result = { countries: docs.length, upserted: res.upserted };
  log(TAG, "seed done", result);
  blogInfo(TAG, `countries seed: ${docs.length} countries (${res.upserted} new)`, result, "countries", "seed");
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "countries", count: docs.length } });
  return result;
}

/** Job handler: `countries.seed`. */
export async function seed(_job: Job) {
  try {
    return await runCountrySeed();
  } catch (err) {
    log(TAG, "seed failed", summarizeForLog(err));
    blogErr(TAG, "countries seed failed", err, "countries", "seed");
    throw err;
  }
}

// ── Wikipedia/Wikidata enrichment ────────────────────────────────────────

const STALE_DAYS = 30;
const GAP_MS = 150; // ~6-7 req/s — same pacing as volcano/city enrichment.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Most country names already match their Wikipedia title; "United States of
 *  America" is the one common divergence in the Natural Earth `admin` field. */
export function countryTitleCandidates(name: string): string[] {
  const out = [name];
  const stripped = name.replace(/\s+of America$/i, "");
  if (stripped !== name) out.push(stripped);
  return out;
}

export interface CountryWikiEnrichOpts {
  /** Re-fetch even countries enriched within STALE_DAYS. */
  force?: boolean;
}

/** Cache Wikipedia title/thumb/extract + Wikidata population/capital/currency onto country docs. */
export async function runCountryWikiEnrich(opts: CountryWikiEnrichOpts = {}) {
  const force = Boolean(opts.force);
  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const countries = await db.countries.listNeedingEnrichment(staleBefore, force);
  log(TAG, `enrichWiki ${countries.length} countries`, { force });

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (const c of countries) {
    try {
      let r: Awaited<ReturnType<typeof fetchWikiSummary>> = "missing";
      for (const title of countryTitleCandidates(c.name)) {
        r = await fetchWikiSummary(title);
        if (r !== "missing" && r !== "disambig") break;
        await sleep(GAP_MS);
      }
      if (r === "missing" || r === "disambig") {
        noMatch++;
        await db.countries.updateEnrichment(c.countryId, { wikiFetchedAt: new Date() });
      } else {
        await sleep(GAP_MS);
        const [gallery, facts] = await Promise.all([fetchWikiGallery(r.title), fetchCountryFacts(r.title)]);
        await db.countries.updateEnrichment(c.countryId, {
          wikiTitle: r.title,
          wikiThumb: r.thumb,
          wikiPhoto: r.photo,
          wikiExtract: r.extract,
          wikiGallery: gallery.length ? gallery : undefined,
          wikiFetchedAt: new Date(),
          population: facts.population,
          capital: facts.capital,
          currency: facts.currency,
        });
        enriched++;
        if (r.thumb || r.photo) withPhoto++;
      }
    } catch (err) {
      log(TAG, `enrichWiki ${c.name} failed`, summarizeForLog(err));
    }
    await sleep(GAP_MS);
  }

  const result = { candidates: countries.length, enriched, withPhoto, noMatch };
  log(TAG, "enrichWiki done", result);
  blogInfo(
    TAG,
    `country wiki enrich: ${enriched} enriched (${withPhoto} with a photo), ${noMatch} no match`,
    result,
    "countries",
    "enrich",
  );
  if (enriched > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "countries", count: enriched } });
  return result;
}

/** Job handler: `countries.enrichWiki`. */
export async function enrichWiki(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runCountryWikiEnrich({ force: d.force });
  } catch (err) {
    log(TAG, "enrichWiki failed", summarizeForLog(err));
    blogErr(TAG, "country wiki enrichment failed", err, "countries", "enrich");
    throw err;
  }
}

// ── Spotlight tour dossier: centre + spread-out waypoint cities ─────────────
// Precompute each country's `country`-spotlight camera tour from its OWN cities
// (queried by `cc`, never a coarse bbox) — the population-weighted centre plus
// the biggest city per compass sector. Pure local Mongo maths (no external
// calls); the director reads the stored dossier so no per-cut geo query runs.
// Like the other catalog work it's operator-triggered (yarn tours:countries or
// the /admin button), not a cron — a country's cities barely move.

/** Cap on cities pulled per country before the sector-picking maths (biggest
 *  first) — keeps a dense country (China/India) from loading tens of thousands
 *  of rows just to pick ~6. Well above any sector count. */
const TOUR_CITY_QUERY_LIMIT = 500;

/** Recompute the spotlight tour dossier for every country that has cities. */
export async function runCountryTours(): Promise<{ countries: number; withTour: number; noCities: number }> {
  const db = await getAppDb();
  const countries = await db.countries.list();
  log(TAG, `computeTours ${countries.length} countries`);

  let withTour = 0;
  let noCities = 0;
  for (const c of countries) {
    const cc = (c.iso2 || c.countryId || "").toLowerCase();
    if (!cc) {
      noCities++;
      continue;
    }
    // Cities in this country, either catalog casing, biggest first.
    const ccVariants = [cc, cc.toUpperCase()];
    const cityDocs = await db.cities.model
      .find({ cc: { $in: ccVariants } }, { id: 1, name: 1, cc: 1, lat: 1, lng: 1, population: 1, _id: 0 })
      .sort({ population: -1 })
      .limit(TOUR_CITY_QUERY_LIMIT)
      .lean()
      .exec();

    const input: TourCityInput[] = cityDocs.map((d: any) => ({
      cityId: d.id,
      name: d.name,
      cc: d.cc,
      lat: d.lat,
      lng: d.lng,
      population: d.population ?? 0,
    }));

    const tour = computeCountryTour(input);
    if (!tour) {
      noCities++;
      // Clear any stale dossier so a country that lost its cities stops touring.
      await db.countries.updateTour(c.countryId, { tourCentroid: undefined, tourCities: [], tourFrame: undefined, tourComputedAt: new Date() });
      continue;
    }

    await db.countries.updateTour(c.countryId, {
      tourCentroid: tour.centroid,
      tourCities: tour.cities,
      tourFrame: tour.frame,
      tourComputedAt: new Date(),
    });
    withTour++;
  }

  const result = { countries: countries.length, withTour, noCities };
  log(TAG, "computeTours done", result);
  blogInfo(
    TAG,
    `country tours: ${withTour}/${countries.length} with a tour (${noCities} no cities)`,
    result,
    "countries",
    "tours",
  );
  if (withTour > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "countries", count: withTour } });
  return result;
}

/** Job handler: `countries.computeTours`. */
export async function computeTours(_job: Job) {
  try {
    return await runCountryTours();
  } catch (err) {
    log(TAG, "computeTours failed", summarizeForLog(err));
    blogErr(TAG, "country tours failed", err, "countries", "tours");
    throw err;
  }
}
