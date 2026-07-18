/**
 * Compute a "go round the country" camera tour from a country's own cities.
 *
 * The auto-director's `country` spotlight used to hold ONE hand-tuned frame and
 * pull its on-air cities from a coarse mainland bbox with no country scoping (so
 * it grabbed neighbours and missed territory). This replaces that with a real
 * tour, computed per country from its OWN cities (queried by `cc`):
 *
 *   1. CENTRE — the population-weighted centroid ("where the country lives",
 *      which — unlike a geometric centroid — never lands in the sea or a
 *      neighbour). The tour STARTS here as a wide establishing shot.
 *   2. WAYPOINTS — the country divided into 8 compass sectors around the centre;
 *      the BIGGEST city in each sector is picked (never the most-extreme, which
 *      is always some tiny edge town). Same directional spread the naive
 *      "northernmost/easternmost/…" idea wanted, but every stop is a real place.
 *      The #1 city overall is always force-included. Ordered clockwise from north
 *      so the camera sweeps rather than ping-pongs.
 *   3. FRAME — a {center,zoom} fitted to the picked cities' bbox, so the whole
 *      set frames without the country rendering tiny around a far-flung outlier.
 *
 * Pure + dependency-free (bar the shared `cameraForBbox`) so it unit-tests and
 * runs in the worker (`countries.computeTours`) the same way. Antimeridian-safe:
 * all longitude maths run in an "unwrapped" frame anchored on the biggest city,
 * then wrap back to [-180,180) on the way out — so Fiji/Russia/US+Alaska don't
 * blow the centroid or the frame across the seam.
 */
import { cameraForBbox } from "./director-regions";

/** A city fed into the tour computation (a projection of the City doc). */
export interface TourCityInput {
  cityId?: string;
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
}

/** A picked tour stop — a city tagged with the compass sector it represents. */
export interface TourCity extends TourCityInput {
  /** 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW. */
  sector: number;
}

export interface CountryTour {
  /** Population-weighted centre, [lng, lat] — the establishing shot. */
  centroid: [number, number];
  /** The waypoint cities, clockwise from north. */
  cities: TourCity[];
  /** Camera fitted to the waypoints' bbox. */
  frame: { center: [number, number]; zoom: number };
}

const SECTORS = 8;
const SECTOR_DEG = 360 / SECTORS;

/** Cities this big are the preferred waypoint pool; relaxed when a country is
 *  too sparse to fill it (so a small nation still tours its biggest few). */
export const COUNTRY_TOUR_POP_FLOOR = 100_000;
/** Cap on waypoints — keeps the spotlight's hold sane (each stop dwells ~40s). */
export const COUNTRY_TOUR_MAX_STOPS = 6;
/** If fewer than this clear the floor, relax the pool to the biggest N cities. */
const COUNTRY_TOUR_MIN_POOL = 4;

/** Shift `lng` into (anchor-180, anchor+180] so a country straddling ±180 has
 *  contiguous longitudes for centroid/bearing/bbox maths. */
function unwrapLng(lng: number, anchor: number): number {
  let x = lng;
  while (x - anchor > 180) x -= 360;
  while (x - anchor < -180) x += 360;
  return x;
}

/** Wrap any real longitude back into [-180, 180). */
function wrapLng(lng: number): number {
  const x = ((lng % 360) + 360) % 360;
  return x >= 180 ? x - 360 : x;
}

interface Unwrapped {
  c: TourCityInput;
  lng: number; // unwrapped
  lat: number;
  pop: number;
}

/** Compass bearing (0=N, 90=E, clockwise) from the centre to a city. */
function bearingOf(x: Unwrapped, cLng: number, cLat: number, cosLat: number): number {
  const dLng = (x.lng - cLng) * cosLat;
  const dLat = x.lat - cLat;
  let deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Build a country's spotlight tour, or null when it has no usable cities.
 */
export function computeCountryTour(
  citiesIn: TourCityInput[],
  opts: { popFloor?: number; maxStops?: number } = {},
): CountryTour | null {
  const popFloor = opts.popFloor ?? COUNTRY_TOUR_POP_FLOOR;
  const maxStops = opts.maxStops ?? COUNTRY_TOUR_MAX_STOPS;

  const cities = citiesIn.filter(
    (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat >= -90 && c.lat <= 90,
  );
  if (!cities.length) return null;

  // Anchor longitude maths on the biggest city so the unwrap frame is stable.
  const anchorCity = cities.reduce((a, b) => ((b.population ?? 0) > (a.population ?? 0) ? b : a), cities[0]);
  const anchor = anchorCity.lng;
  const u: Unwrapped[] = cities.map((c) => ({
    c,
    lng: unwrapLng(c.lng, anchor),
    lat: c.lat,
    pop: Math.max(0, c.population ?? 0),
  }));

  // Population-weighted centroid (simple mean when every population is 0).
  const totalPop = u.reduce((s, x) => s + x.pop, 0);
  const cLng = totalPop > 0 ? u.reduce((s, x) => s + x.lng * x.pop, 0) / totalPop : u.reduce((s, x) => s + x.lng, 0) / u.length;
  const cLat = totalPop > 0 ? u.reduce((s, x) => s + x.lat * x.pop, 0) / totalPop : u.reduce((s, x) => s + x.lat, 0) / u.length;
  const cosLat = Math.cos((cLat * Math.PI) / 180);

  // Waypoint pool: cities ≥ floor, relaxed to the biggest few for sparse nations.
  const sortedByPop = [...u].sort((a, b) => b.pop - a.pop);
  let pool = sortedByPop.filter((x) => x.pop >= popFloor);
  if (pool.length < COUNTRY_TOUR_MIN_POOL) pool = sortedByPop.slice(0, Math.min(COUNTRY_TOUR_MIN_POOL, sortedByPop.length));

  // Biggest city per compass sector.
  const bestBySector = new Map<number, { x: Unwrapped; sector: number; bearing: number }>();
  for (const x of pool) {
    const bearing = bearingOf(x, cLng, cLat, cosLat);
    const sector = Math.round(bearing / SECTOR_DEG) % SECTORS;
    const prev = bestBySector.get(sector);
    if (!prev || x.pop > prev.x.pop) bestBySector.set(sector, { x, sector, bearing });
  }
  let picks = [...bestBySector.values()];

  // Always include the country's #1 city, even if a bigger neighbour won its
  // sector — a spotlight that skipped the capital/primate city reads as broken.
  const top = sortedByPop[0];
  if (!picks.some((p) => p.x === top)) {
    const bearing = bearingOf(top, cLng, cLat, cosLat);
    picks.push({ x: top, sector: Math.round(bearing / SECTOR_DEG) % SECTORS, bearing });
  }

  // Cap to the biggest `maxStops`, then order clockwise from north for the sweep.
  if (picks.length > maxStops) {
    picks = [...picks].sort((a, b) => b.x.pop - a.x.pop).slice(0, maxStops);
  }
  picks.sort((a, b) => a.bearing - b.bearing);

  const outCities: TourCity[] = picks.map((p) => ({
    cityId: p.x.c.cityId,
    name: p.x.c.name,
    cc: p.x.c.cc,
    lat: p.x.c.lat,
    lng: p.x.c.lng, // the original (wrapped) coordinate
    population: p.x.c.population,
    sector: p.sector,
  }));

  // Frame from the picks' bbox in the UNWRAPPED frame (so an antimeridian
  // country spans correctly), then wrap the centre back across the seam.
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of picks) {
    if (p.x.lng < w) w = p.x.lng;
    if (p.x.lng > e) e = p.x.lng;
    if (p.x.lat < s) s = p.x.lat;
    if (p.x.lat > n) n = p.x.lat;
  }
  const framed = cameraForBbox([w, s, e, n]);
  const frame = {
    center: [wrapLng(framed.center[0]), framed.center[1]] as [number, number],
    zoom: framed.zoom,
  };

  return { centroid: [wrapLng(cLng), cLat], cities: outCities, frame };
}
