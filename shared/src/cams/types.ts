/**
 * Live-webcam domain types, shared by the worker (catalog ingest) and the
 * public app (admin list + viewer). Two complementary feed shapes:
 *  - "catalog" providers (e.g. Windy Webcams) give a current still + looping
 *    timelapses + an embed player, but no continuous video;
 *  - a `live` stream is attached only where a cam actually publishes one
 *    (an HLS manifest or a YouTube live id).
 * A single Cam can carry both — the still/timelapse for global coverage, plus a
 * real stream when available.
 */

export type CamStatus = "active" | "inactive" | "unknown";

export type CamProvider =
  | "windy"
  | "tfl"
  | "national_highways"
  | "youtube"
  | "geonet"
  | "usgs_vhp"
  | "avo"
  | "ingv"
  | "phivolcs"
  | "imo"
  | "magma"
  | "volcat"
  | "gvp"
  | "manual"
  | "other";

/** How a continuous live stream should be embedded by the viewer. */
export type CamStreamKind = "hls" | "youtube" | "mp4" | "iframe";

export interface CamLiveStream {
  kind: CamStreamKind;
  /** HLS manifest URL, YouTube watch/embed URL or id, mp4 URL, or iframe src. */
  url: string;
}

/**
 * Provider attribution. Several sources (Windy especially) require the provider
 * name + a linkback to be shown wherever the cam is displayed, so we persist it
 * alongside each row rather than reconstruct it per-provider in the UI.
 */
export interface CamAttribution {
  /** Display name, e.g. "windy.com", "Transport for London". */
  provider: string;
  /** Exact text a provider mandates, e.g. "Webcams provided by windy.com". */
  requiredText?: string;
  /** The URL the attribution must link back to (the cam's provider page). */
  linkUrl?: string;
}

export interface Cam {
  /** Stable provider id — the upsert key. e.g. a Windy webcam id or a slug. */
  camId: string;
  provider: CamProvider;
  title: string;
  /** Degrees, −90..90. */
  lat: number;
  /** Degrees, −180..180. */
  lng: number;
  status: CamStatus;
  /** Human place label, e.g. "Zermatt, Switzerland". */
  place?: string;
  /** Country name or ISO code, for grouping/filters. */
  country?: string;
  /** Current still image (catalog feed). */
  imageUrl?: string;
  /** Looping daylight/lifetime timelapse — the catalog "preview stream". */
  timelapseUrl?: string;
  /** Provider embed player URL. */
  playerUrl?: string;
  /** A true continuous live stream, when the cam publishes one. */
  live?: CamLiveStream;
  tags?: string[];
  /** Provider attribution (required linkback for some sources, e.g. Windy). */
  attribution?: CamAttribution;
  /** When the catalog entry was last refreshed from the provider (epoch ms). */
  fetchedAt?: number;
}

/**
 * Catalog-source adapter (spec §5). Every automatic source implements the same
 * single step — pull/refresh its catalogue into canonical `Cam[]` — so adding a
 * provider is one new file registered in the worker's cam registry. Mirrors the
 * `AlertSource` contract used by the alerts feature: the worker registers one
 * repeatable ingest job per enabled source, keyed on `pollIntervalSec`.
 */
export interface CamSource {
  /** Stable source id, also the `camId` prefix (e.g. "windy" → "windy:1234"). */
  id: string;
  /** The canonical provider these cams are stored under. */
  provider: CamProvider;
  /** Human region/coverage label, for logs. */
  region: string;
  /** How often the worker re-polls this catalogue, in seconds. */
  pollIntervalSec: number;
  /** Off sources are skipped by the registry (e.g. missing API key). */
  enabled: boolean;
  /** Pull/refresh the full catalogue into canonical Cams (already normalised). */
  fetchCatalogue(): Promise<Cam[]>;
}
