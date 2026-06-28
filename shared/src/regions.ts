/**
 * Named region/country bboxes for camera framing (`fitBounds`). bbox is
 * [west, south, east, north] in −180..180 / −90..90.
 */
export interface iRegionPreset {
  id: string;
  label: string;
  bbox: [number, number, number, number];
}

export const REGION_PRESETS: iRegionPreset[] = [
  { id: "world", label: "World", bbox: [-180, -85, 180, 85] },
  { id: "western_europe", label: "Western Europe", bbox: [-11, 36, 20, 60] },
  { id: "north_atlantic", label: "North Atlantic", bbox: [-70, 25, 5, 65] },
  { id: "mediterranean", label: "Mediterranean", bbox: [-6, 30, 37, 47] },
  { id: "uk", label: "United Kingdom", bbox: [-11, 49.5, 2.5, 61] },
  { id: "conus", label: "Continental US", bbox: [-125, 24, -66, 50] },
  { id: "east_asia", label: "East Asia", bbox: [100, 20, 146, 47] },
  { id: "south_asia", label: "South Asia", bbox: [66, 6, 97, 36] },
  { id: "australia", label: "Australia", bbox: [112, -44, 154, -10] },
  { id: "south_america", label: "South America", bbox: [-82, -56, -34, 13] },
  { id: "africa", label: "Africa", bbox: [-18, -35, 52, 38] },
];

export const getRegion = (id: string): iRegionPreset | undefined =>
  REGION_PRESETS.find((r) => r.id === id);
