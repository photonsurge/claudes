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

const rasterStyle = (
  id: string,
  tiles: string[],
  attribution: string,
  background = "#0a0e16",
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
      maxzoom: 19,
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
];

export const DEFAULT_BASEMAP_ID = "dark";

export const getBasemap = (id: string): iBasemap =>
  BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
