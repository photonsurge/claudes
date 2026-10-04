/**
 * What is "in" a short video's scope (docs/short-video-plan.md §4.2): the
 * ACTIVE alerts, quakes and volcanoes inside a country, an area or the whole
 * globe, each already cut by the scene config's thresholds. The lineup
 * template (script-template.ts) turns these into scored candidates and picks.
 *
 * Geography, per kind:
 *  • alerts — by the alert's decoded country (`alertCountryCode`), never by
 *    position: a country scope matches its ISO code, an area its member
 *    countries (bbox-scoped bands like US West also need the alert inside the
 *    area's bbox, the same rule region-membership applies to cities).
 *  • quakes / volcanoes — by position: a country is its real polygon, or
 *    offshore inside its bbox and inside no other country; an area is its bbox.
 *
 * Every point is bbox-tested before it reaches a polygon (and each MultiPolygon
 * part has its own bbox), so only a handful of ray casts run on the worker's
 * main loop.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorConfig } from "@photonsurge/shared/director";
import type { ShortScope } from "@photonsurge/shared/short-script";
import { countryShot, type CountryShot } from "@photonsurge/shared/director-countries";
import { regionShot, type RegionShot } from "@photonsurge/shared/director-regions";
import { CONTINENT_LABEL, isBboxScoped, memberCountryCodes } from "@photonsurge/shared/region-membership";
import { pointInPolygon, type SimplePolygon } from "@photonsurge/shared/geo/pointInPolygon";
import { bboxOf, type Bbox } from "@photonsurge/shared/geo/polygon";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { quakeLiveWindowSince } from "@photonsurge/shared/seismic";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";
import type { iQuakeModel } from "@photonsurge/shared/db/quake-model";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";

/**
 * True when [lng,lat] is inside a [w,s,e,n] box. Copes with both antimeridian
 * conventions the catalogs use: a wrapping box (w > e) and an extended one
 * (e past +180, like the Pacific presets). A box 360° wide holds every longitude.
 */
export function inBbox(lng: number, lat: number, [w, s, e, n]: Bbox): boolean {
  if (lat < s || lat > n) return false;
  const span = e >= w ? e - w : e - w + 360;
  if (span >= 360) return true;
  const x = (((lng - w) % 360) + 360) % 360;
  return x <= span;
}

/** A country boundary split into polygon parts, each with its own bbox — so a
 *  country whose whole bbox wraps the planet (the US, Russia, Fiji) still
 *  prefilters tightly on the part a point is near. */
interface Shape {
  bbox: Bbox;
  parts: { bbox: Bbox; polygon: SimplePolygon }[];
}

function shapeOf(doc: iCountryModel): Shape | null {
  const g = doc.geometry;
  if (!g || !Array.isArray(g.coordinates)) return null;
  const polys: [number, number][][][] = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  const parts: Shape["parts"] = [];
  for (const rings of polys) {
    const polygon: SimplePolygon = { type: "Polygon", coordinates: rings };
    const bbox = bboxOf(polygon);
    if (bbox) parts.push({ bbox, polygon });
  }
  if (!parts.length) return null;
  const bbox = Array.isArray(doc.bbox) && doc.bbox.length === 4 ? doc.bbox : bboxOf(g as any);
  return bbox ? { bbox, parts } : null;
}

function inShape(lng: number, lat: number, shape: Shape): boolean {
  if (!inBbox(lng, lat, shape.bbox)) return false;
  return shape.parts.some((p) => inBbox(lng, lat, p.bbox) && pointInPolygon(lng, lat, p.polygon));
}

/** Wide enough that it must wrap the antimeridian — useless as an "offshore" frame. */
const isWrapping = ([w, , e]: Bbox): boolean => e - w >= 180 || w > e;

/** A scope with everything its filters need loaded once. */
export type ResolvedScope =
  | { type: "globe" }
  | {
      type: "country";
      shot: CountryShot;
      /** The country's own boundary, or null when the catalog has no doc for it. */
      shape: Shape | null;
      /** Where an offshore quake/volcano still counts as this country's. */
      offshoreBbox: Bbox;
      /** Every OTHER country's doc, for the "in no other country" test. Shapes
       *  are built lazily — only for countries whose bbox a point falls in. */
      others: iCountryModel[];
    }
  | {
      type: "area";
      shot: RegionShot;
      bbox: Bbox;
      /** Member country ISO-2 codes, lowercase. */
      members: Set<string>;
      /** A sub-national band: an alert must also sit inside `bbox`. */
      bboxScoped: boolean;
    };

/** A scope of one place or the globe — what `resolveScope` loads. A `places`
 *  scope is resolved place by place (script-template.ts `buildPlacesLineup`). */
export type SingleScope = Exclude<ShortScope, { type: "places" }>;

/**
 * Load what a scope's filters need. Throws a readable error for a country or
 * area id that isn't in the curated catalog.
 */
export async function resolveScope(db: AppDb, scope: SingleScope): Promise<ResolvedScope> {
  if (scope.type === "globe") return { type: "globe" };

  if (scope.type === "country") {
    const shot = countryShot(scope.id);
    if (!shot) throw new Error(`unknown country id "${scope.id}" (not in COUNTRY_SHOTS)`);
    const iso = shot.iso2.toLowerCase();
    const all = await db.countries.list().catch(() => [] as iCountryModel[]);
    const own = all.find((c) => c.countryId === iso || c.iso2?.toLowerCase() === iso) ?? null;
    const shape = own ? shapeOf(own) : null;
    // The real bbox reaches outlying islands (Japan's Ogasawara), so prefer it —
    // unless it wraps the antimeridian (the Aleutians, the Chathams), where the
    // curated mainland box is the only sane "offshore" frame.
    const offshoreBbox = shape && !isWrapping(shape.bbox) ? shape.bbox : shot.bbox;
    return { type: "country", shot, shape, offshoreBbox, others: all.filter((c) => c !== own) };
  }

  const shot = regionShot(scope.id);
  if (!shot) throw new Error(`unknown area id "${scope.id}" (not in REGION_SHOTS)`);
  const region = await db.regions.get(shot.id).catch(() => null);
  // Continents resolve membership from the Country catalog; curated groups and
  // bands from their lists. The Region doc's own enriched `countries` joins in.
  const catalog = CONTINENT_LABEL[shot.id] ? await db.countries.list().catch(() => [] as iCountryModel[]) : [];
  const members = new Set(memberCountryCodes(shot.id, catalog));
  for (const c of region?.countries ?? []) if (c.cc) members.add(c.cc.toLowerCase());
  const bbox = region?.bbox && region.bbox.length === 4 ? region.bbox : shot.bbox;
  return { type: "area", shot, bbox, members, bboxScoped: isBboxScoped(shot.id) };
}

/** A shape cache over the "other countries" list, so each is built at most once. */
function otherCountryTest(others: iCountryModel[]): (lng: number, lat: number) => boolean {
  const shapes = new Map<iCountryModel, Shape | null>();
  return (lng, lat) =>
    others.some((doc) => {
      if (!Array.isArray(doc.bbox) || doc.bbox.length !== 4 || !inBbox(lng, lat, doc.bbox)) return false;
      if (!shapes.has(doc)) shapes.set(doc, shapeOf(doc));
      const shape = shapes.get(doc);
      return shape ? inShape(lng, lat, shape) : false;
    });
}

/**
 * A point test for quakes and volcanoes. Country: inside its polygon, or
 * offshore inside its bbox and inside no other country. Without a catalog doc
 * the curated bbox alone decides. Area: inside the bbox. Globe: everything.
 */
export function pointFilter(rs: ResolvedScope): (lng: number, lat: number) => boolean {
  if (rs.type === "globe") return () => true;
  if (rs.type === "area") return (lng, lat) => inBbox(lng, lat, rs.bbox);
  const { shape, offshoreBbox } = rs;
  if (!shape) return (lng, lat) => inBbox(lng, lat, offshoreBbox);
  const inOther = otherCountryTest(rs.others);
  return (lng, lat) => {
    if (inShape(lng, lat, shape)) return true;
    return inBbox(lng, lat, offshoreBbox) && !inOther(lng, lat);
  };
}

/** Fields of an alert doc the director builders read — `info[0].area[0]`. */
const firstArea = (a: any) => (Array.isArray(a?.info) ? a.info[0]?.area?.[0] : undefined);

/**
 * Active alerts in scope at or above `cfg.minAlertSeverity`, each with a
 * polygon to frame (the same requirement `stormCandidate` has). Severity-ranked,
 * most severe first — the order `alerts.list` returns.
 *
 * Two reads, because the store has no country filter: a scan of every active
 * alert WITHOUT coordinates picks the in-scope ones by decoded country, then
 * only those are loaded whole (a whole-planet marine polygon must not be
 * parsed for an alert that's then thrown away).
 */
export async function scopeAlerts(db: AppDb, cfg: DirectorConfig, rs: ResolvedScope): Promise<any[]> {
  const light = await db.alerts.list({
    activeOnly: true,
    severityMin: cfg.minAlertSeverity,
    omitCoordinates: true,
    lean: true,
  });
  const iso = rs.type === "country" ? rs.shot.iso2.toUpperCase() : null;
  const ids = (light as any[])
    .filter((a) => firstArea(a)?.geometry?.type) // geocode-only — nothing to frame
    .filter((a) => {
      if (rs.type === "globe") return true;
      const code = alertCountryCode(a);
      if (!code) return false;
      return iso ? code === iso : rs.type === "area" && rs.members.has(code.toLowerCase());
    })
    .map((a) => a.id as string);
  if (!ids.length) return [];

  const docs = (await db.alerts.listByIds(ids)) as any[];
  const byId = new Map(docs.map((d) => [d.id, d]));
  // Back in the scan's severity order; a doc gone between reads drops out.
  return ids
    .map((id) => byId.get(id))
    .filter((a) => {
      if (!a) return false;
      const center = alertRepPoint(firstArea(a)?.geometry);
      if (!center) return false;
      return !(rs.type === "area" && rs.bboxScoped) || inBbox(center[0], center[1], rs.bbox);
    });
}

/** Quakes in scope inside the live window, at or above `cfg.minQuakeMag`, newest first. */
export async function scopeQuakes(db: AppDb, cfg: DirectorConfig, rs: ResolvedScope, now: number): Promise<iQuakeModel[]> {
  // The whole live window, unboxed: a Mongo `$geoWithin` box has great-circle
  // edges (a mainland-US box's southern edge bows past Florida) and can't wrap
  // the antimeridian, so the box test runs here instead. The window is small.
  const quakes = await db.quakes.list({ minMag: cfg.minQuakeMag, sinceMs: quakeLiveWindowSince(now), limit: 0 });
  const inScope = pointFilter(rs);
  return quakes.filter((q) => inScope(q.lng, q.lat));
}

/** Volcanoes in scope that are erupting or in unrest (dormant carries no headline). */
export async function scopeVolcanoes(db: AppDb, rs: ResolvedScope): Promise<Volcano[]> {
  const [erupting, unrest] = await Promise.all([
    db.volcanoes.list({ status: "erupting" }),
    db.volcanoes.list({ status: "unrest" }),
  ]);
  const inScope = pointFilter(rs);
  return [...erupting, ...unrest].filter((v) => v.status !== "dormant" && inScope(v.lng, v.lat));
}
