import type { CamSource, Cam } from "@photonsurge/shared/cams/types";
import { normaliseCam } from "@photonsurge/shared/cams/normalise";

/**
 * TfL JamCams adapter (spec §5). London's traffic CCTV, published as free open
 * data via the TfL Unified API with native coordinates — no key required (an
 * optional app key just raises the rate limit). Each JamCam Place carries a
 * still JPEG plus a short looping MP4 clip; we store the still as the marker
 * thumbnail and the clip as the watchable `live` video.
 */

const FEED = process.env.TFL_JAMCAMS_URL || "https://api.tfl.gov.uk/Place/Type/JamCam";
const POLL_SEC = Number(process.env.TFL_INGEST_SEC || 10 * 60); // clips refresh ~every few min

interface TflAdditionalProperty {
  key?: string;
  value?: string;
}
interface TflPlace {
  id?: string;
  url?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: TflAdditionalProperty[];
}

/** First `additionalProperties` value for a key (case-insensitive), if any. */
function prop(place: TflPlace, key: string): string | undefined {
  const hit = place.additionalProperties?.find(
    (p) => p.key?.toLowerCase() === key.toLowerCase(),
  );
  const v = hit?.value?.trim();
  return v ? v : undefined;
}

/**
 * Map one TfL JamCam Place → canonical Cam (pure — unit tested). Returns null
 * for a record missing an id/name or usable coordinates.
 */
export function mapTflPlace(place: TflPlace): Cam | null {
  if (!place?.id || !place.commonName) return null;
  if (typeof place.lat !== "number" || typeof place.lon !== "number") return null;

  const videoUrl = prop(place, "videoUrl");
  const imageUrl = prop(place, "imageUrl");
  const available = prop(place, "available");
  const status =
    available === "true" ? "active" : available === "false" ? "inactive" : "unknown";

  return normaliseCam({
    camId: `tfl:${place.id}`,
    provider: "tfl",
    title: place.commonName,
    lat: place.lat,
    lng: place.lon,
    status,
    place: "London, UK",
    country: "GB",
    imageUrl,
    // Short MP4 clip → `.mp4` is inferred as kind "mp4" by normaliseLive.
    live: videoUrl ? { url: videoUrl } : undefined,
    tags: ["traffic", "london", "jamcam"],
    attribution: {
      provider: "Transport for London",
      requiredText: "Powered by TfL Open Data",
      linkUrl: "https://tfl.gov.uk",
    },
  });
}

export const tflSource: CamSource = {
  id: "tfl",
  provider: "tfl",
  region: "London (TfL JamCams)",
  pollIntervalSec: POLL_SEC,
  enabled: process.env.CAMS_TFL_ENABLED !== "false",

  async fetchCatalogue(): Promise<Cam[]> {
    const url = new URL(FEED);
    if (process.env.TFL_APP_KEY) url.searchParams.set("app_key", process.env.TFL_APP_KEY);

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`TfL JamCams ${res.status} ${res.statusText}`);
    const places = (await res.json()) as TflPlace[];
    if (!Array.isArray(places)) throw new Error("TfL JamCams: unexpected payload (not an array)");

    return places.map(mapTflPlace).filter((c): c is Cam => c !== null);
  },
};
