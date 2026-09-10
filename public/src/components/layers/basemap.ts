"use client";

/**
 * Basemap layer builders for the deck.gl GlobeView. Kept out of Globe.tsx so the
 * component stays a thin orchestrator. The full-globe raster base images come from
 * /api/basemap/<id> (the shared blob store, refreshable from /admin/jobs, with a
 * static /data fallback); Natural Earth land/borders GeoJSON for the dark vector
 * basemap is still served locally from /data (see ./fetch-assets.sh).
 */
import { BitmapLayer, GeoJsonLayer, PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import { countryBorderRings, type CountryFeature } from "./country-features";
import type { OutlineRing } from "./outline-rings";
import { TileLayer } from "@deck.gl/geo-layers";
import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { DEFAULT_BASEMAP_COLORS, type ControlState } from "@photonsurge/shared/control";
import { TILE_TEMPLATES, NIGHT_TILE_MAX_ZOOM } from "@photonsurge/shared/basemaps";
import { DEPTH_OCCLUDE, DEPTH_TEST, DEPTH_PAINT } from "./depth";

import { LAND_URL, COUNTRIES_URL } from "./data-urls";
export { LAND_URL, COUNTRIES_URL };
// Full-globe base images served from the shared blob store, refreshable from
// /admin/jobs (worker `basemap.refresh`). The route falls back to the static
// /data/<id>.jpg deploy-time file until the first bake — see
// public/src/app/api/basemap/[id]/route.ts and shared/src/basemaps.ts.
export const SATELLITE_IMG = "/api/basemap/satellite";
export const TERRAIN_IMG = "/api/basemap/terrain";
export const NIGHT_IMG = "/api/basemap/night";

/** View zoom at/above which sharp XYZ tiles overlay the base image. Below this
 *  the tiles would be large flat quads chording the sphere (black artifacts). */
export const TILE_MIN_ZOOM = 4;

// Full-globe background as a GRID of small cells. A single big polygon earcuts
// into a few huge triangles whose flat faces chord THROUGH the sphere — so the
// depth it writes is wrong and far-side overlays (tracks/trails) aren't occluded
// ("see through the globe"). Many small cells drape close to the surface and
// write a correct depth sphere, so the near hemisphere properly hides the far.
// The finer the grid, the less each flat cell chords inward, so the depth sphere
// hugs the true limb and nothing peeks past the silhouette over open ocean.
const GLOBE_CELLS: number[][][] = (() => {
  const step = 6;
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

/** A single global equirectangular image wrapped on the sphere (no tiles).
 *  DEPTH_PAINT + back-face cull (mirrors satimg.ts): a full-globe BitmapLayer is
 *  only a few flat quads that bow slightly inside the true sphere, so depth-
 *  TESTING it against the finely-tessellated `background` grid below z-fights —
 *  a lattice of diamond artifacts that gets worse further from the camera and
 *  clears up zoomed in. Painting (no depth test/write) over the already-correct
 *  depth sphere `background` wrote, with the far hemisphere culled geometrically
 *  instead of numerically, sidesteps the z-fight entirely. */
function globalImageLayer(id: string, image: string, visible: boolean) {
  return new BitmapLayer({
    id: `basemap-image-${id}`,
    image,
    visible,
    bounds: [-180, -90, 180, 90],
    parameters: { ...DEPTH_PAINT, cullMode: "back" },
  });
}

/** Sharp XYZ raster tiles overlaid on the base image (zoomed-in detail).
 *  `maxZoom` caps tile FETCHING (deeper views stretch the deepest tiles) for
 *  sets that stop early, like GIBS Black Marble's zoom-8 pyramid. */
function tileBasemapLayer(id: string, template: string, maxZoom = 19) {
  return new TileLayer({
    id: `basemap-tiles-${id}`,
    data: template,
    minZoom: 0,
    maxZoom,
    tileSize: 256,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderSubLayers: (props: any) => {
      const { west, south, east, north } = props.tile.bbox;
      return new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [west, south, east, north],
        // XYZ tiles are Web-Mercator-encoded: their pixels are linear in Mercator
        // Y, NOT in latitude. Draping them across a lng/lat quad (the BitmapLayer
        // default) stretches each tile nonuniformly, so on the _GlobeView the tiles
        // warp and slide off the equirect base image + coastlines (visible seams).
        // CARTESIAN tells deck.gl the image is Mercator-encoded and to reproject it
        // into the globe's lnglat space (bitmap-layer's "Mercator in LNGLAT" path).
        _imageCoordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        // PAINT, not OCCLUDE: the tiles must NOT write depth. Exactly one mesh seals
        // the depth sphere — the background grid (no weather) or the weather raster
        // (hasGlobalRaster). These per-tile quads are a THIRD tessellation of the same
        // sphere; letting them write depth too makes them z-fight whichever sealer is
        // active — the background grid (basemap looks "sketchy") or, worse, the global
        // weather raster (a radial lattice of wedges where alternate triangles win the
        // depth test). Paint over the base image instead, far side culled by cullMode
        // back, mirroring globalImageLayer above. See ./depth.ts.
        parameters: { ...DEPTH_PAINT, cullMode: "back" },
      });
    },
  });
}

/** Bottom basemap layers for the active basemap id. `tilesActive` overlays sharp
 *  XYZ tiles on the raster basemaps once zoomed in. `hasGlobalRaster` is true only
 *  when a full-globe weather raster is actually drawn on top (NOT for a nest-only
 *  variable like radar, which paints clipped patches and seals no depth). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function basemapLayers(
  state: ControlState,
  tilesActive: boolean,
  hasGlobalRaster: boolean,
): any[] {
  const colors = state.basemapColors ?? DEFAULT_BASEMAP_COLORS;
  const isRaster =
    state.basemap === "satellite" || state.basemap === "terrain" || state.basemap === "night";
  // `background` (the finely-subdivided GLOBE_CELLS grid) is always the depth
  // occluder EXCEPT when a full-globe weather raster is also drawn on top — that
  // raster writes its own depth (DEPTH_OCCLUDE, in layers/index.ts), and letting
  // both write would z-fight two different meshes approximating the same sphere.
  // The raster/terrain/night IMAGE never writes depth itself (see
  // globalImageLayer) — it paints over whatever `background` already sealed.
  const background = new SolidPolygonLayer({
    id: "basemap-bg",
    data: GLOBE_CELLS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPolygon: (d: any) => d,
    stroked: false,
    filled: true,
    getFillColor: isRaster ? [0, 3, 8] : hexToRgb(colors.ocean),
    parameters: hasGlobalRaster ? DEPTH_TEST : DEPTH_OCCLUDE,
  });

  // Every basemap's heavy layer stays in the list, toggled by `visible`, rather
  // than being built when its basemap is on and thrown away when it is off. A
  // global spin CYCLES map types, and each visit used to rebuild from scratch:
  // the 8192×4096 base image re-created as a GPU texture (`texSubImage2D`
  // 360–375 ms in one frame, every visit) and the 2.2 MB land GeoJSON
  // re-fetched and re-tessellated on the main thread (~420 ms, plus the GC it
  // leaves behind). deck keeps an invisible layer's state — the texture, the
  // tessellation — and only skips its draw, so each is paid once per page
  // load, behind the cold-start cover, and a map-type step is a flag flip
  // (docs/watch-perf-plan.md, round 51). GPU memory for three base images is
  // the price; the OBS box has it, and the worker now bakes them at 4096 wide.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [
    background,
    globalImageLayer("satellite", SATELLITE_IMG, state.basemap === "satellite"),
    globalImageLayer("terrain", TERRAIN_IMG, state.basemap === "terrain"),
    globalImageLayer("night", NIGHT_IMG, state.basemap === "night"),
  ];
  // Sharp XYZ tiles over the active raster basemap once zoomed in — cheap to
  // rebuild (the tile bounding-volume cache is page-lifetime), so not kept.
  if (tilesActive && state.basemap === "satellite") layers.push(tileBasemapLayer("satellite", TILE_TEMPLATES.esriImagery));
  if (tilesActive && state.basemap === "terrain") layers.push(tileBasemapLayer("terrain", TILE_TEMPLATES.openTopo));
  if (tilesActive && state.basemap === "night") layers.push(tileBasemapLayer("night", TILE_TEMPLATES.gibsNight, NIGHT_TILE_MAX_ZOOM));
  // dark: recolourable land fill over the ocean sphere. Hidden under the raster
  // basemaps, and under relief too — that shaded hypsometric raster is added by
  // Globe (it needs the Mongo elevation texture, unavailable here) and paints
  // land and sea itself.
  layers.push(
    new GeoJsonLayer({
      id: "basemap-land",
      data: LAND_URL,
      visible: state.basemap === "dark",
      stroked: false,
      filled: true,
      getFillColor: hexToRgb(colors.land),
      // Paint-only, no depth test/write: the draped land fill just paints over
      // the ocean background. Its far hemisphere is culled by GlobeView's
      // cullMode:'back', and NOT depth-testing stops it z-fighting the ocean
      // background grid (the green "spiky fill"). See DEPTH_PAINT.
      parameters: DEPTH_PAINT,
      updateTriggers: { getFillColor: colors.land },
    }),
  );
  return layers;
}

/**
 * Country borders — stroke only, drawn above the weather, colour from state.
 *
 * A PathLayer over every country ring (one shared, page-lifetime promise from
 * country-features.ts), not a stroke-only GeoJsonLayer over the URL: GeoJsonLayer
 * always builds a polygons-fill sublayer that earcuts every polygon in the
 * 4 MB file on each cold start (one per OBS hard reset) and then draws a no-op
 * each frame. The stroke is the same PathLayer GeoJsonLayer would have used.
 */
export function countriesLayer(state: ControlState) {
  const [r, g, b] = hexToRgb(state.basemapColors?.border ?? DEFAULT_BASEMAP_COLORS.border);
  return new PathLayer<OutlineRing<CountryFeature>>({
    id: "country-borders",
    data: countryBorderRings(),
    getPath: (d) => d.path as [number, number][],
    getColor: [r, g, b, 170],
    widthUnits: "pixels",
    getWidth: 1,
    widthMinPixels: 0.6,
    // Depth-tested (less-equal) so borders draw over the basemap at the surface
    // but the far hemisphere's borders are hidden instead of bleeding through.
    parameters: DEPTH_TEST,
    updateTriggers: { getColor: [r, g, b] },
  });
}
