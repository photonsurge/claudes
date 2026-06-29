/**
 * Client-side dead reckoning. The worker caches aircraft/ship frames in Mongo at
 * a modest cadence; between frames we advance each track along its heading at its
 * speed so motion looks live (the same idea as propagating satellites from TLEs).
 * Great-circle projection from a start point, bearing (deg) and distance (m).
 */
const EARTH_R = 6_371_000; // metres
const KT_TO_MS = 0.514444;

export function advance(
  lng: number,
  lat: number,
  headingDeg: number | undefined,
  speedMS: number | undefined,
  dtSec: number,
): [number, number] {
  if (!speedMS || speedMS <= 0 || headingDeg == null || dtSec <= 0) return [lng, lat];
  const dist = speedMS * dtSec;
  const dr = dist / EARTH_R;
  const brng = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    );

  const outLng = (((lng2 * 180) / Math.PI + 540) % 360) - 180; // normalise to −180..180
  return [outLng, (lat2 * 180) / Math.PI];
}

/** Knots → m/s, for AIS ship speeds. */
export const knotsToMS = (kn: number): number => kn * KT_TO_MS;
