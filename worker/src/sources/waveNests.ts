// sources/waveNests.ts
// Pure helpers for the GFS-Wave regional-basin NEST sources (Phase 2a):
// atlocn / epacif / wcoast / ecg at 0.16°, published as zoom-gated overlays on
// top of the global `gfswave-mosaic` base. Network access is always injected so
// these functions are unit-testable.
//
// Unlike the mosaic (which regrids several tiles onto ONE common global grid),
// each basin nest stays on its OWN native regional 0.16° grid + bbox. The basin
// GRIB2 is a regular lat-lon grid already, so the ingest subsets it to the
// descriptor bbox/dims with `wgrib2 -new_grid latlon` (reusing regridTileToGlobal
// with a per-basin -new_grid spec) before the regional scalar bake — NO
// regrid-to-global.
//
// The descriptors (shared/src/sources.waveNests.ts → getSource("gfswave-<basin>"))
// are the source of truth for bbox/dims/resolution; the -new_grid spec here is
// derived from each so the subset grid EXACTLY matches the descriptor dims.

import { getSource } from "@photonsurge/shared/sources";
import { GFS_S3_BASE } from "./gfs";
import { WAVE_MATCH, padWaveFhr } from "./gfswave";

// Re-export the shared HTSGW match + fhr padder so the ingest imports from one place.
export { WAVE_MATCH, padWaveFhr };

/**
 * The `.idx` var/level pair naming the significant-wave-height message — the
 * byte-range equivalent of {@link WAVE_MATCH} (`:HTSGW:surface:`), which still
 * selects the field inside the downloaded subset. Keep the two in step.
 */
export const WAVE_NEST_VARS = ["HTSGW"];
export const WAVE_NEST_LEVELS = ["surface"];

/** Per-basin ingest spec: descriptor id → NOMADS grid token → bbox/dims/newgrid. */
export interface WaveNestTile {
  /** Source/descriptor id, e.g. "gfswave-atlocn". */
  sourceId: string;
  /**
   * NOMADS grid token in the filename, e.g. "atlocn.0p16"
   * (`gfswave.tCCz.<token>.fNNN.grib2`).
   */
  grid: string;
  /** [W,S,E,N] the tile covers — from the descriptor bbox. */
  bbox: [number, number, number, number];
  /** Target dims for the subset/bake — from the descriptor dims. */
  dims: { width: number; height: number };
  /** Native resolution in degrees (0.16 for these basins). */
  res: number;
  /** wgrib2 `-new_grid latlon lon0:nx:dlon lat0:ny:dlat` subset spec. */
  newgrid: string;
}

/**
 * Descriptor id → the NOMADS basin token in the GRIB2 filename.
 *
 * VERIFY (against a live `wave/gridded/` listing): the 0.16° regional basins are
 * served as `gfswave.tCCz.<basin>.0p16.fNNN.grib2`, where <basin> is the grid
 * token below. If NOAA renames a basin (e.g. `wc10m` instead of `wcoast`), fix
 * the token here — the descriptor id stays stable.
 */
export const WAVE_NEST_TOKENS: Record<string, string> = {
  "gfswave-atlocn": "atlocn.0p16",
  "gfswave-epacif": "epacif.0p16",
  "gfswave-wcoast": "wcoast.0p16",
  "gfswave-ecg": "ecg.0p16",
};

/**
 * Build the wgrib2 `-new_grid latlon lon0:nx:dlon lat0:ny:dlat` spec that subsets
 * a basin's regular-lat-lon grid to the descriptor bbox/dims. lon0/lat0 are the SW
 * corner (row 0 = south; extractField reorders to we:ns). dlon/dlat come out to
 * ~0.16° so `width`/`height` points span the bbox edge-to-edge.
 *
 * VERIFY: wgrib2 accepts a negative lon0 directly for a bounded (non-wrapping)
 * regional latlon grid. The basins are bounded windows, so the negative form is
 * standard; if a build insists on 0..360, shift lon0 by +360.
 */
export function buildWaveNestNewGrid(
  bbox: [number, number, number, number],
  dims: { width: number; height: number },
): string {
  const [w, s, e, n] = bbox;
  const dlon = ((e - w) / (dims.width - 1)).toFixed(6);
  const dlat = ((n - s) / (dims.height - 1)).toFixed(6);
  return `latlon ${w}:${dims.width}:${dlon} ${s}:${dims.height}:${dlat}`;
}

/** Resolve the ingest tile spec for one nest descriptor (from the registry). */
export function waveNestTile(sourceId: string): WaveNestTile {
  const source = getSource(sourceId);
  if (!source) throw new Error(`waveNestTile: unknown source ${sourceId}`);
  const grid = WAVE_NEST_TOKENS[sourceId];
  if (!grid) throw new Error(`waveNestTile: no NOMADS token for ${sourceId}`);
  const bbox = source.bbox as [number, number, number, number];
  const dims = source.dims ?? {
    width: Math.round((bbox[2] - bbox[0]) / source.resolutionDeg) + 1,
    height: Math.round((bbox[3] - bbox[1]) / source.resolutionDeg) + 1,
  };
  return {
    sourceId,
    grid,
    bbox,
    dims,
    res: source.resolutionDeg,
    newgrid: buildWaveNestNewGrid(bbox, dims),
  };
}

/** All wave-nest ingest tiles, derived from the descriptors in the registry. */
export function waveNestTiles(): WaveNestTile[] {
  return Object.keys(WAVE_NEST_TOKENS).map(waveNestTile);
}

/** A basin GRIB2 on S3 plus its `.idx` sidecar (byte offsets of every message). */
export interface WaveNestS3Paths {
  /** Full basin GRIB2 URL (Range-requested per message). */
  gribUrl: string;
  /** Its `.idx` index sidecar URL. */
  idxUrl: string;
}

/**
 * S3 grib + `.idx` URLs for one GFS-Wave regional basin forecast hour.
 *
 * The basins live in the same `wave/gridded/` dir, under the same filename shape,
 * as the global wave product `buildGfsS3Paths` already reads — only the grid token
 * differs (`atlocn.0p16` vs `global.0p25`). NOMADS is deliberately NOT used here:
 * it soft-bans server IPs that fetch faster than ~10s apart (see politeness.ts),
 * which surfaced as connection-level `TypeError: fetch failed` on every basin hour.
 * The same data sits in the public bucket with no rate limit, and the `.idx` lets
 * us pull only the HTSGW message (~28 KB of a ~670 KB basin file).
 *
 * Example (atlocn.0p16, 00z, f024):
 *   https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260628/00/
 *     wave/gridded/gfswave.t00z.atlocn.0p16.f024.grib2
 */
export function buildWaveNestS3Paths(args: {
  date: string;
  cycle: string;
  fhr: number;
  grid: string;
}): WaveNestS3Paths {
  const cyc = String(args.cycle).padStart(2, "0");
  const fff = padWaveFhr(args.fhr);
  const gribUrl = `${GFS_S3_BASE}/gfs.${args.date}/${cyc}/wave/gridded/gfswave.t${cyc}z.${args.grid}.f${fff}.grib2`;
  return { gribUrl, idxUrl: `${gribUrl}.idx` };
}
