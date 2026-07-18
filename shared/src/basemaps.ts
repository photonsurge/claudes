/**
 * Switchable basemaps under the weather layers. Each entry is a self-contained
 * MapLibre style (raster sources, no API key) so the globe works offline-ish and
 * without provider tokens. `style` is typed loosely here to avoid pulling
 * maplibre types into the shared package; the web casts it to StyleSpecification.
 *
 * Attribution is REQUIRED by these providers — keep it on the map.
 */
export interface iBasemap {
  id: string;
  label: string;
  /** MapLibre StyleSpecification (raster). */
  style: Record<string, unknown>;
}

/**
 * Raw XYZ tile templates, shared between the MapLibre BASEMAPS styles (below)
 * and the deck.gl GlobeView (which renders them via a TileLayer onto the
 * sphere). Single source of truth so the flat map and the globe show the same
 * imagery. `{z}/{y}/{x}` for Esri and GIBS (row-before-column order), `{z}/{x}/{y}`
 * for the rest.
 */
export const TILE_TEMPLATES = {
  cartoDark: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  esriImagery:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  openTopo: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  // NASA Black Marble (VIIRS city lights) via keyless GIBS WMTS. Static composite
  // ("default" time); tiles exist only to zoom 8 — cap maxzoom wherever it's used.
  gibsNight:
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
} as const;

/** Deepest zoom the GIBS Black Marble tile set provides (GoogleMapsCompatible_Level8). */
export const NIGHT_TILE_MAX_ZOOM = 8;

const rasterStyle = (
  id: string,
  tiles: string[],
  attribution: string,
  background = "#0a0e16",
  maxzoom = 19,
): Record<string, unknown> => ({
  version: 8,
  // Glyphs are needed for any future text layers (city labels are drawn via deck.gl).
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    [id]: {
      type: "raster",
      tiles,
      tileSize: 256,
      attribution,
      maxzoom,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": background } },
    { id, type: "raster", source: id, paint: { "raster-opacity": 1 } },
  ],
});

export const BASEMAPS: iBasemap[] = [
  {
    id: "dark",
    label: "Dark",
    style: rasterStyle(
      "carto-dark",
      [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      "© OpenStreetMap contributors © CARTO",
    ),
  },
  {
    id: "satellite",
    label: "Satellite",
    style: rasterStyle(
      "esri-imagery",
      [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      "Imagery © Esri, Maxar, Earthstar Geographics",
      "#000308",
    ),
  },
  {
    id: "terrain",
    label: "Terrain",
    style: rasterStyle(
      "opentopo",
      [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
      "#0b1410",
    ),
  },
  {
    // NASA "Black Marble" — the VIIRS Earth-at-night city-lights composite, served
    // keyless by GIBS. The globe draws /data/night.jpg (fetch-assets.sh) as the base
    // image with these WMTS tiles overlaid once zoomed in (they stop at zoom 8).
    id: "night",
    label: "Night",
    style: rasterStyle(
      "gibs-night",
      [TILE_TEMPLATES.gibsNight],
      "Imagery © NASA EOSDIS GIBS (VIIRS Black Marble)",
      "#000308",
      NIGHT_TILE_MAX_ZOOM,
    ),
  },
  {
    // Shaded hypsometric relief baked from ETOPO 2022 (worker `refresh:elevation`).
    // Rendered on the globe by deck from the Mongo elevation texture (NOT tiles),
    // so the MapLibre `style` here is just a dark background fallback for the flat
    // map — the deck GlobeView paints the actual relief raster.
    id: "relief",
    label: "Relief",
    style: rasterStyle(
      "carto-dark",
      [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      "Relief: NOAA NCEI ETOPO 2022 | © OpenStreetMap contributors © CARTO",
    ),
  },
];

export const DEFAULT_BASEMAP_ID = "dark";

export const getBasemap = (id: string): iBasemap =>
  BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];

/**
 * The full-globe base IMAGES the raster basemaps drape on the sphere (under the
 * zoom-gated XYZ tiles). Historically these were fetched ONCE by ./fetch-assets.sh
 * into the read-only /data mount and could only be refreshed by a redeploy — so a
 * truncated download (the corrupt satellite.jpg bug) left the zoomed-out globe
 * black with no runtime fix. This registry is the single source of truth for those
 * downloads, shared by the worker `basemap.refresh` job (which fetches + validates
 * + writes them to the shared ${BLOB_DIR} store) and the public `/api/basemap/[id]`
 * serve route. Keep the URLs in step with ./fetch-assets.sh (the deploy bootstrap).
 */
export interface BasemapTexture {
  /** Stable id — the blob key, the /api/basemap/<id> path, and the /data/<id>.jpg fallback. */
  id: string;
  /** Human label for the admin Jobs button. */
  label: string;
  /** Keyless upstream to fetch. */
  url: string;
  contentType: string;
  /** Static file the serve route redirects to until the first bake (in /data). */
  fallback: string;
  /** Extra request headers some hosts need (solarsystemscope 403s without a UA). */
  headers?: Record<string, string>;
  /** One-line provenance, surfaced in the admin button description. */
  source: string;
}

const UA = { "User-Agent": "Mozilla/5.0" };

export const BASEMAP_TEXTURES: readonly BasemapTexture[] = [
  {
    id: "satellite",
    label: "Satellite (Blue Marble 8k)",
    url: "https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg",
    contentType: "image/jpeg",
    fallback: "/data/satellite.jpg",
    headers: UA,
    source: "Solar System Scope 8k Earth daymap",
  },
  {
    id: "terrain",
    label: "Terrain (topo + bathymetry)",
    url: "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg",
    contentType: "image/jpeg",
    fallback: "/data/terrain.jpg",
    headers: UA,
    source: "NASA Blue Marble topography + bathymetry (5400×2700)",
  },
  {
    id: "night",
    label: "Night lights (Black Marble)",
    url: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?version=1.3.0&service=WMS&request=GetMap&format=image/jpeg&STYLE=default&CRS=EPSG:4326&bbox=-90,-180,90,180&WIDTH=8192&HEIGHT=4096&layers=VIIRS_Black_Marble",
    contentType: "image/jpeg",
    fallback: "/data/night.jpg",
    source: "NASA VIIRS Black Marble city lights via keyless GIBS WMS",
  },
];

export const BASEMAP_TEXTURE_IDS = BASEMAP_TEXTURES.map((t) => t.id);

export const getBasemapTexture = (id: string): BasemapTexture | undefined =>
  BASEMAP_TEXTURES.find((t) => t.id === id);
