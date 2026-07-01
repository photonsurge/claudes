// sources/gfswave.ts
// GFS-Wave regional tiles for the finer-than-0.25° mosaic.
//
// NOAA's `global.0p16` wave grid is NOT whole-planet — it is a 52.5°N–15°S band
// (2160×406, verified from the live GRIB2 header). To get a genuinely finer
// GLOBAL wave field we mosaic several regional tiles from the same NOMADS
// `wave/gridded/` directory, each regridded to a common global 1/6° lat-lon grid
// and composited by priority (see worker/src/merge/mosaic.ts). The whole-planet
// `global.0p25` (1440×721, ±90°) remains the base/fallback.

/** Common global target grid the tiles are resampled onto for compositing. */
export const WAVE_MOSAIC_GRID = { width: 2160, height: 1081, res: 1 / 6 } as const;
/** wgrib2 -new_grid spec: `latlon lon0:nx:dlon lat0:ny:dlat` (−180..180, −90..90). */
export const WAVE_MOSAIC_NEWGRID = "latlon -180:2160:0.166667 -90:1081:0.166667";

export interface WaveTile {
  /** NOMADS grid token in the filename, e.g. "global.0p16". */
  grid: string;
  label: string;
  /** [W,S,E,N] the tile actually covers (from live GRIB2 headers). */
  bbox: [number, number, number, number];
  /** Higher wins where tiles overlap (finer/regional beats coarse). */
  priority: number;
}

/**
 * The tiles that, together, cover the whole planet at ≥0.16° in mid-latitudes.
 * `global.0p16` fills the 52.5°N–15°S band; `arctic.9km` and `gsouth.0p25` fill
 * the poles. Basin tiles (atlocn/epacif/wcoast) can be appended as higher-priority
 * overlays later — they're extra-fine but redundant for global coverage.
 */
export const WAVE_TILES: WaveTile[] = [
  { grid: "global.0p16", label: "Global mid-lat 0.16°", bbox: [-180, -15, 180, 52.5], priority: 20 },
  { grid: "arctic.9km", label: "Arctic 9km", bbox: [-180, 50, 180, 90], priority: 15 },
  { grid: "gsouth.0p25", label: "Southern Ocean 0.25°", bbox: [-180, -90, 180, -10], priority: 12 },
];

const NOMADS_PROD = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod";

/** Zero-pad a forecast hour to 3 digits. */
export function padWaveFhr(fhr: number): string {
  return String(fhr).padStart(3, "0");
}

/**
 * Direct NOMADS production URL for a GFS-Wave tile GRIB2 file.
 *
 * Example (global.0p16, 00z, f024):
 *   https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260628/00/
 *     wave/gridded/gfswave.t00z.global.0p16.f024.grib2
 */
export function buildWaveTileUrl(args: {
  date: string;
  cycle: string;
  fhr: number;
  grid: string;
}): string {
  const cyc = String(args.cycle).padStart(2, "0");
  const fff = padWaveFhr(args.fhr);
  return `${NOMADS_PROD}/gfs.${args.date}/${cyc}/wave/gridded/gfswave.t${cyc}z.${args.grid}.f${fff}.grib2`;
}

/** wgrib2 match for significant wave height (same token on every tile). */
export const WAVE_MATCH = ":HTSGW:surface:";
