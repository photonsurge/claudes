"use client";

/**
 * Basemap layer builders for the deck.gl GlobeView. Kept out of Globe.tsx so the
 * component stays a thin orchestrator. Assets are served locally from /data (see
 * ./fetch-assets.sh): a 4k plate-carrée image base for raster basemaps, plus
 * Natural Earth land/borders GeoJSON for the dark vector basemap.
 */
import { BitmapLayer, GeoJsonLayer, SolidPolygonLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { DEFAULT_BASEMAP_COLORS, type ControlState } from "@photonsurge/shared/control";
import { TILE_TEMPLATES } from "@photonsurge/shared/basemaps";

export const LAND_URL = "/data/land.geojson";
export const COUNTRIES_URL = "/data/countries.geojson";
export const SATELLITE_IMG = "/data/satellite.jpg";
export const TERRAIN_IMG = "/data/terrain.jpg";

/** View zoom at/above which sharp XYZ tiles overlay the base image. Below this
 *  the tiles would be large flat quads chording the sphere (black artifacts). */
export const TILE_MIN_ZOOM = 4;

// Full-globe background as a GRID of small cells. A single big polygon earcuts
// into a few huge triangles whose flat faces chord THROUGH the sphere — so the
// depth it writes is wrong and far-side overlays (tracks/trails) aren't occluded
// ("see through the globe"). Many small cells drape close to the surface and
// write a correct depth sphere, so the near hemisphere properly hides the far.
const GLOBE_CELLS: number[][][] = (() => {
  const step = 10;
  const cells: number[][][] = [];
  for (let lat = -90; lat < 90; lat += step) {
    for (let lng = -180; lng < 180; lng += step) {
      const e = lng + step;
      const n = lat + step;
      cells.push([
        [lng, lat],
        [e, lat],
        [e, n],
        [lng, n],
        [lng, lat],
      ]);
    }
  }
  return cells;
})();

/** Parse "#rrggbb" → [r,g,b] (0–255). Falls back to mid-grey on bad input. */
export function hexToRgb(hex: string | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A single global equirectangular image wrapped on the sphere (no tiles). */
function globalImageLayer(id: string, image: string) {
  return new BitmapLayer({ id: `basemap-image-${id}`, image, bounds: [-180, -90, 180, 90] });
}

/** Sharp XYZ raster tiles overlaid on the base image (zoomed-in detail). */
function tileBasemapLayer(id: string, template: string) {
  return new TileLayer({
    id: `basemap-tiles-${id}`,
    data: template,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderSubLayers: (props: any) => {
      const { west, south, east, north } = props.tile.bbox;
      return new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [west, south, east, north],
      });
    },
  });
}

/** Bottom basemap layers for the active basemap id. `tilesActive` overlays sharp
 *  XYZ tiles on the raster basemaps once zoomed in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function basemapLayers(state: ControlState, tilesActive: boolean): any[] {
  const colors = state.basemapColors ?? DEFAULT_BASEMAP_COLORS;
  const isRaster = state.basemap === "satellite" || state.basemap === "terrain";
  const background = new SolidPolygonLayer({
    id: "basemap-bg",
    data: GLOBE_CELLS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPolygon: (d: any) => d,
    stroked: false,
    filled: true,
    getFillColor: isRaster ? [0, 3, 8] : hexToRgb(colors.ocean),
    // Write a correct depth sphere so far-side tracks/trails are occluded.
    parameters: { depthTest: true },
  });

  if (state.basemap === "satellite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [background, globalImageLayer("satellite", SATELLITE_IMG)];
    if (tilesActive) layers.push(tileBasemapLayer("satellite", TILE_TEMPLATES.esriImagery));
    return layers;
  }
  if (state.basemap === "terrain") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [background, globalImageLayer("terrain", TERRAIN_IMG)];
    if (tilesActive) layers.push(tileBasemapLayer("terrain", TILE_TEMPLATES.openTopo));
    return layers;
  }

  // dark: ocean sphere + recolourable land fill.
  return [
    background,
    new GeoJsonLayer({
      id: "basemap-land",
      data: LAND_URL,
      stroked: false,
      filled: true,
      getFillColor: hexToRgb(colors.land),
    }),
  ];
}

/** Country borders — stroke only, drawn above the weather, colour from state. */
export function countriesLayer(state: ControlState) {
  const [r, g, b] = hexToRgb(state.basemapColors?.border ?? DEFAULT_BASEMAP_COLORS.border);
  return new GeoJsonLayer({
    id: "country-borders",
    data: COUNTRIES_URL,
    stroked: true,
    filled: false,
    getLineColor: [r, g, b, 170],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    lineWidthMinPixels: 0.6,
    parameters: { depthTest: false },
    updateTriggers: { getLineColor: [r, g, b] },
  });
}
