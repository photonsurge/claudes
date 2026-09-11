/**
 * "Where is the locator globe pointed?" — continent + country for a lon/lat,
 * resolved on the client with NO network call of its own.
 *
 * It indexes the SAME countries.geojson the basemap borders already fetch and
 * parse once per page (country-features.ts), so this costs one lazy pass over
 * features that are already in memory — never a second 4 MB download.
 *
 * The index is per POLYGON PART, not per country: a country's parts each get
 * their own bbox, so an antimeridian-spanning multipolygon (Russia, Fiji) still
 * prefilters usefully instead of claiming the whole world. A point tests only
 * the handful of parts whose box spans it, and ties break to the SMALLEST part
 * — the same rule /api/countries/at uses, so an enclave or an island territory
 * wins over the big country whose box merely covers it.
 */
import { loadCountryFeatureList, type CountryFeature } from "../layers/country-features";
import { pointInPolygon } from "@photonsurge/shared/geo/pointInPolygon";

export interface Place {
  /** Short display name, e.g. "United Kingdom" (Natural Earth `name`). */
  country: string;
  /** "Europe", "Asia", … — null when the feature carries no usable continent. */
  continent: string | null;
  /** ISO-3166 alpha-2, upper case, when the feature has one. */
  iso: string | null;
}

/** Natural Earth files the open ocean's scattered territories under this
 *  pseudo-continent; on air that reads as nonsense, so it counts as unknown. */
const NON_CONTINENT = /seven seas/i;

type Ring = [number, number][];

interface Part {
  rings: Ring[];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Rough bbox area in deg² — the tie-break between overlapping parts. */
  area: number;
  place: Place;
}

let parts: Part[] | null = null;
let building: Promise<void> | null = null;

/** Wrap to (-180, 180] so a spun longitude lands in the file's coordinate space. */
function wrapLng(lng: number): number {
  return (((lng + 180) % 360) + 360) % 360 - 180;
}

function placeOf(feature: CountryFeature): Place | null {
  const p = feature?.properties ?? {};
  const country = String(p.name ?? p.name_long ?? p.admin ?? "").trim();
  if (!country) return null;
  const continent = String(p.continent ?? "").trim();
  const iso = String(p.iso_a2 ?? "").trim().toUpperCase();
  return {
    country,
    continent: continent && !NON_CONTINENT.test(continent) ? continent : null,
    iso: iso && iso !== "-99" ? iso : null,
  };
}

function addPart(out: Part[], rings: unknown, place: Place): void {
  if (!Array.isArray(rings) || !rings.length) return;
  const outer = rings[0] as Ring;
  if (!Array.isArray(outer) || outer.length < 4) return;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of outer) {
    const [x, y] = point;
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return;
  out.push({
    rings: rings as Ring[],
    bbox: [west, south, east, north],
    area: Math.max(0.0001, (east - west) * (north - south)),
    place,
  });
}

/** Flatten every country feature into bbox-tagged polygon parts. */
export function buildPlaceParts(features: readonly CountryFeature[]): Part[] {
  const out: Part[] = [];
  for (const feature of features) {
    const place = placeOf(feature);
    const geometry = feature?.geometry;
    if (!place || !geometry?.coordinates) continue;
    if (geometry.type === "Polygon") addPart(out, geometry.coordinates, place);
    else if (geometry.type === "MultiPolygon") {
      for (const poly of geometry.coordinates as unknown[]) addPart(out, poly, place);
    }
  }
  return out;
}

/**
 * Build the index (idempotent, one promise for the life of the page). Callers
 * should schedule this when the page is idle: it waits on the shared
 * countries.geojson promise, so calling it early would only pull that 4 MB
 * fetch forward ahead of the map's own work.
 */
export function ensurePlaceIndex(): Promise<void> {
  if (!building) {
    building = loadCountryFeatureList()
      .then((features) => {
        parts = buildPlaceParts(features);
      })
      .catch(() => {
        parts = [];
      });
  }
  return building;
}

/** True once the index is built — before that `placeAt` always answers null. */
export function isPlaceIndexReady(): boolean {
  return parts !== null;
}

/**
 * The country under [lng, lat], or null for open ocean (and for every call
 * before the index is ready — this never blocks and never fetches).
 */
export function placeAt(lng: number, lat: number): Place | null {
  if (!parts) return null;
  const x = wrapLng(lng);
  let best: Part | null = null;
  for (const part of parts) {
    const [west, south, east, north] = part.bbox;
    if (x < west || x > east || lat < south || lat > north) continue;
    if (best && part.area >= best.area) continue; // a bigger part can't win the tie-break
    if (pointInPolygon(x, lat, { type: "Polygon", coordinates: part.rings })) best = part;
  }
  return best ? best.place : null;
}

/** Forget the built index (tests only). */
export function resetPlaceIndexForTests(): void {
  parts = null;
  building = null;
}
