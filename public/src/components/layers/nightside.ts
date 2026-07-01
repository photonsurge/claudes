"use client";

/**
 * Day/night terminator shading for the globe. A grid of small cells drapes the
 * whole sphere; each is tinted a deep space-blue whose alpha ramps up across the
 * night side (from the sun-zenith cosine, softened over a twilight band). Many
 * small cells hug the surface (a single hemisphere polygon would earcut into
 * huge flat triangles that chord THROUGH the sphere), giving a smooth curved
 * terminator that follows the real sun position.
 *
 * Drawn just above the basemap and below the weather/overlays, so the earth
 * darkens on its night side while borders, alerts and city lights stay bright on
 * top. Depth-TESTED (not written): the far hemisphere is occluded and the tint
 * never seals the depth buffer against the layers above it. Lifted a few km so it
 * hovers clear of the basemap depth sphere instead of z-fighting it.
 */
import { SolidPolygonLayer } from "@deck.gl/layers";
import { DEPTH_TEST } from "./depth";
import { cosSunZenith, nightAlpha } from "../../lib/sun";

/** Grid resolution in degrees — fine enough for a smooth terminator curve. */
const STEP = 5;
/** Metres above the surface, so the tint hovers clear of the depth sphere. */
const ELEV = 4_000;

interface NightCell {
  /** Cell-centre [lng, lat] used to sample the sun angle. */
  lng: number;
  lat: number;
  /** The cell quad as [lng, lat, elevation] rings. */
  poly: [number, number, number][];
}

/** Precomputed once: the full-globe grid of shading cells. */
const NIGHT_CELLS: NightCell[] = (() => {
  const cells: NightCell[] = [];
  for (let lat = -90; lat < 90; lat += STEP) {
    for (let lng = -180; lng < 180; lng += STEP) {
      const e = lng + STEP;
      const n = lat + STEP;
      cells.push({
        lng: lng + STEP / 2,
        lat: lat + STEP / 2,
        poly: [
          [lng, lat, ELEV],
          [e, lat, ELEV],
          [e, n, ELEV],
          [lng, n, ELEV],
          [lng, lat, ELEV],
        ],
      });
    }
  }
  return cells;
})();

/**
 * The night-shading layer for a given subsolar point. `maxDark` (0–255) caps the
 * darkest tint so deep night still keeps some satellite/city detail rather than
 * going pure black.
 */
export function nightLayer(subsolar: [number, number], maxDark = 175): SolidPolygonLayer<NightCell> {
  return new SolidPolygonLayer<NightCell>({
    id: "nightside",
    data: NIGHT_CELLS,
    getPolygon: (d) => d.poly,
    filled: true,
    getFillColor: (d) => {
      const a = nightAlpha(cosSunZenith(d.lng, d.lat, subsolar));
      return [3, 6, 16, Math.round(a * maxDark)];
    },
    parameters: DEPTH_TEST,
    pickable: false,
    // Recolour every cell when the sun moves (the terminator advances).
    updateTriggers: { getFillColor: [subsolar[0], subsolar[1]] },
  });
}
