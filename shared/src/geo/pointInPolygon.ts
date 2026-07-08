// geo/pointInPolygon.ts
// Ray-casting point-in-polygon over plain GeoJSON Polygon/MultiPolygon
// geometry — used both to mask area-weather pixel sampling to a country's
// real boundary (worker/src/areaWeather) and, potentially, exact-boundary
// hotspot labelling later. Dependency-free by design, like weather/sample.ts.

export interface SimplePolygon {
  type: "Polygon";
  /** [outer ring, ...hole rings], each a closed [lng,lat][] loop. */
  coordinates: [number, number][][];
}

export interface SimpleMultiPolygon {
  type: "MultiPolygon";
  coordinates: [number, number][][][];
}

export type SimpleGeometry = SimplePolygon | SimpleMultiPolygon;

/** Standard even-odd ray cast against one closed ring. */
function rayCastRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and not inside any hole. */
function pointInRings(lng: number, lat: number, rings: [number, number][][]): boolean {
  if (!rings.length) return false;
  if (!rayCastRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (rayCastRing(lng, lat, rings[h])) return false;
  }
  return true;
}

/** True when [lng,lat] falls inside `geometry` (any constituent polygon of a MultiPolygon), holes excluded. */
export function pointInPolygon(lng: number, lat: number, geometry: SimpleGeometry): boolean {
  if (geometry.type === "Polygon") return pointInRings(lng, lat, geometry.coordinates);
  return geometry.coordinates.some((rings) => pointInRings(lng, lat, rings));
}
