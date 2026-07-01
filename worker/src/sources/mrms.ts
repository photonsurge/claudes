// sources/mrms.ts
// NOAA MRMS (Multi-Radar Multi-Sensor) composite reflectivity — the CONUS radar
// nest. Pure URL/time helpers; all network access is injected so these are
// unit-testable.
//
// MRMS GRIB2 lives on the NCEP MRMS web host (NOT the NOMADS filter service):
//   https://mrms.ncep.noaa.gov/data/2D/MergedReflectivityQCComposite/
// Files are gzip-compressed GRIB2, named by product + UTC timestamp:
//   MRMS_MergedReflectivityQCComposite_00.50_<YYYYMMDD>-<HHMMSS>.grib2.gz
// A new file is published roughly every 2 minutes. The `_00.50` token is the
// product's height-AGL label (0.50 km) that MRMS bakes into the composite name.
//
// The mosaic is native ~0.01° regular lat-lon over CONUS. We download the newest
// file, gunzip, wgrib2-extract reflectivity, and regrid/subset to the descriptor
// grid (3500×1750 @ 0.02° over [-130,20,-60,55]) in the ingest core.
//
// VERIFY (live assumptions — confirm against a real fetch before trusting):
//  - Product dir + filename token `MergedReflectivityQCComposite` and the AGL
//    label `_00.50` in the filename. (Alt product: `SeamlessHSR`.)
//  - wgrib2 reports the record as `:MergedReflectivityQCComposite:` — see
//    MRMS_MATCH below; if wgrib2 names it differently (e.g. a numeric var), swap.
//  - Directory listing HTML shape used by the latest-file resolver.

/** Base host for MRMS 2-D CONUS products (gzip'd GRIB2, no NOMADS filter). */
export const MRMS_BASE = "https://mrms.ncep.noaa.gov/data/2D";

// VERIFY: product directory + filename token + AGL label.
export const MRMS_PRODUCT = "MergedReflectivityQCComposite";
/** Height-AGL label baked into the composite filename (`_00.50` = 0.50 km). */
export const MRMS_AGL = "00.50";

/**
 * wgrib2 `-match` token selecting the reflectivity record.
 * VERIFY: MRMS single-record files usually carry the product name as the GRIB2
 * shortName, so `:MergedReflectivityQCComposite:` matches. If wgrib2's inventory
 * shows a different name (e.g. `:var discipline=...:` or `:16 mb:`), update this.
 */
export const MRMS_MATCH = ":MergedReflectivityQCComposite:";

/** MRMS descriptor grid: 3500×1750 @ 0.02° over the CONUS bbox. */
export const MRMS_TARGET_GRID = { width: 3500, height: 1750, res: 0.02 } as const;
/** [W,S,E,N] — mirrors getSource("mrms").bbox. */
export const MRMS_TARGET_BOUNDS: [number, number, number, number] = [-130, 20, -60, 55];

/**
 * wgrib2 `-new_grid` spec to resample the native 0.01° mosaic onto the 0.02°
 * descriptor grid: `latlon lon0:nx:dlon lat0:ny:dlat`. lon0/lat0 are the
 * SW corner cell centre. VERIFY the exact corner registration against a live
 * header (a half-cell offset is harmless for a radar overlay).
 */
export const MRMS_NEWGRID = "latlon -130:3500:0.02 20:1750:0.02";

/** MRMS reflectivity "no data" / "no coverage" sentinels (dBZ). */
// VERIFY: MRMS uses -999 (no coverage / masked) and -99 (no echo / range-folded)
// as fill values. Both — and anything below the clear-air floor — bake transparent.
export const MRMS_NO_COVERAGE = -999;
export const MRMS_NO_ECHO = -99;
/** Reflectivity below this (dBZ) is clear-air / light drizzle → transparent. */
export const MRMS_MIN_VISIBLE_DBZ = 5;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC YYYYMMDD for a Date. */
export function mrmsYmd(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** UTC HHMMSS for a Date. */
export function mrmsHms(d: Date): string {
  return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
}

/** Build the gzip'd-GRIB2 filename for a given valid time. */
export function mrmsFileName(validTime: Date): string {
  return `MRMS_${MRMS_PRODUCT}_${MRMS_AGL}_${mrmsYmd(validTime)}-${mrmsHms(validTime)}.grib2.gz`;
}

/** Directory URL for the reflectivity product (also the listing endpoint). */
export function mrmsDirUrl(): string {
  return `${MRMS_BASE}/${MRMS_PRODUCT}/`;
}

/**
 * Build the direct URL for an MRMS reflectivity file at a given valid time.
 *
 * Example (2026-06-28 12:34:00 UTC):
 *   https://mrms.ncep.noaa.gov/data/2D/MergedReflectivityQCComposite/
 *     MRMS_MergedReflectivityQCComposite_00.50_20260628-123400.grib2.gz
 */
export function buildMrmsUrl(validTime: Date): string {
  return `${mrmsDirUrl()}${mrmsFileName(validTime)}`;
}

/**
 * Parse the UTC valid time out of an MRMS filename. Tolerates the leading dir
 * and the `.grib2.gz` (or `.grib2`) suffix. Returns null if it doesn't match.
 */
export function parseMrmsTime(name: string): Date | null {
  // ..._<YYYYMMDD>-<HHMMSS>.grib2[.gz]
  const m = name.match(/_(\d{8})-(\d{6})\.grib2(?:\.gz)?$/);
  if (!m) return null;
  const [, ymd, hms] = m;
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const hh = Number(hms.slice(0, 2));
  const mm = Number(hms.slice(2, 4));
  const ss = Number(hms.slice(4, 6));
  return new Date(Date.UTC(y, mo, d, hh, mm, ss));
}

/** Signature for an injected directory-listing fetch (returns raw HTML/text). */
export type FetchText = (url: string) => Promise<string>;
/** Signature for an injected availability probe (HEAD/GET). */
export type FetchHead = (url: string) => Promise<boolean>;

export interface MrmsFile {
  /** The .grib2.gz file name. */
  name: string;
  /** UTC valid time parsed from the name. */
  validTime: Date;
  /** Direct download URL. */
  url: string;
}

/**
 * Resolve the newest available MRMS reflectivity file by listing the product
 * directory and picking the max valid-time entry. The listing is an Apache-style
 * HTML index, so we scrape every MRMS_..._<time>.grib2.gz href.
 *
 * `fetchText` fetches the directory HTML (injected for tests). Returns null when
 * nothing parseable is found so the caller can skip this tick.
 */
export async function mrmsLatestAvailable(fetchText: FetchText): Promise<MrmsFile | null> {
  let html: string;
  try {
    html = await fetchText(mrmsDirUrl());
  } catch {
    return null;
  }
  const re = new RegExp(`MRMS_${MRMS_PRODUCT}_${MRMS_AGL}_\\d{8}-\\d{6}\\.grib2\\.gz`, "g");
  const names = html.match(re) ?? [];
  let best: MrmsFile | null = null;
  for (const name of names) {
    const validTime = parseMrmsTime(name);
    if (!validTime) continue;
    if (!best || validTime.getTime() > best.validTime.getTime()) {
      best = { name, validTime, url: `${mrmsDirUrl()}${name}` };
    }
  }
  return best;
}

/**
 * Fallback resolver when no directory listing is available: HEAD-poll backwards
 * from `now`, snapped to the 2-minute cadence, for the newest existing file.
 * Steps back up to `maxSteps` 2-minute slots (default ~30 min of history).
 */
export async function mrmsLatestByPoll(
  now: Date,
  fetchHead: FetchHead,
  maxSteps = 15,
): Promise<MrmsFile | null> {
  // Snap to the nearest lower even minute, zero seconds (MRMS lands ~every 2 min).
  const base = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    now.getUTCHours(), now.getUTCMinutes() - (now.getUTCMinutes() % 2), 0, 0,
  ));
  for (let i = 0; i < maxSteps; i++) {
    const validTime = new Date(base.getTime() - i * 2 * 60 * 1000);
    const url = buildMrmsUrl(validTime);
    try {
      if (await fetchHead(url)) return { name: mrmsFileName(validTime), validTime, url };
    } catch {
      // try the next-older slot
    }
  }
  return null;
}
