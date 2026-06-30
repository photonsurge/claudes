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

export type CamProvider = "windy" | "youtube" | "manual" | "other";

/** How a continuous live stream should be embedded by the viewer. */
export type CamStreamKind = "hls" | "youtube" | "mp4" | "iframe";

export interface CamLiveStream {
  kind: CamStreamKind;
  /** HLS manifest URL, YouTube watch/embed URL or id, mp4 URL, or iframe src. */
  url: string;
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
  /** When the catalog entry was last refreshed from the provider (epoch ms). */
  fetchedAt?: number;
}
