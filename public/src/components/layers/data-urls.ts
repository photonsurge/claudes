/**
 * Static basemap data served from /public/data. Kept in a dependency-free
 * module so non-deck consumers (the sub-globe painter's Web Worker, the
 * country-glow resolver) can import the paths without pulling deck.gl in.
 */
export const LAND_URL = "/data/land.geojson";
export const COUNTRIES_URL = "/data/countries.geojson";
