import type { CamSource, Cam } from "@photonsurge/shared/cams/types";
import { normaliseCam } from "@photonsurge/shared/cams/normalise";

/**
 * Windy Webcams adapter (spec §5, Phase 1). The broadest source (~70k cams).
 * V3 API, authenticated with the `x-windy-api-key` header. Each webcam gives a
 * refreshed still + an embeddable player (iframe) but no continuous stream, so
 * `media.kind` is effectively still/timelapse. Attribution + linkback are
 * REQUIRED by Windy's ToS, so we always persist them (spec §10).
 *
 * Volume note: the free tier returns low-res stills + short-lived image tokens,
 * so we persist the stable still URL and page through the catalogue on a slow
 * (default daily) cadence rather than per-tick. `WINDY_MAX_WEBCAMS` caps the
 * pull for tighter free-tier request budgets; 0 (default) pulls everything.
 */

const BASE = process.env.WINDY_WEBCAMS_URL || "https://api.windy.com/webcams/api/v3/webcams";
const PAGE = 50; // v3 hard max per request
const POLL_SEC = Number(process.env.WINDY_INGEST_SEC || 24 * 60 * 60); // daily
const MAX = Number(process.env.WINDY_MAX_WEBCAMS || 0); // 0 = all
const PAGE_DELAY_MS = Number(process.env.WINDY_PAGE_DELAY_MS || 250); // respect ~1 req/s
// The free tier rejects any request past offset 1000 with a 400
// ("Offset is over API tier limit 1000!"). Stop paging there rather than
// walking off the ceiling and throwing away the whole batch. The soft-stop on
// the 400 below is the real backstop — this just avoids the wasted request.
const MAX_OFFSET = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface WindyImages {
  current?: { preview?: string; thumbnail?: string; icon?: string };
}
/** v3 `player` values are plain embed-URL strings (day/live/month/year/lifetime). */
interface WindyPlayer {
  day?: string;
  live?: string;
}
interface WindyWebcam {
  webcamId?: number | string;
  title?: string;
  status?: string;
  location?: { city?: string; region?: string; country?: string; latitude?: number; longitude?: number };
  categories?: { id?: string; name?: string }[];
  images?: WindyImages;
  player?: WindyPlayer;
  urls?: { detail?: string; provider?: string };
}
interface WindyResponse {
  total?: number;
  webcams?: WindyWebcam[];
}

/**
 * Map one Windy v3 webcam → canonical Cam (pure — unit tested). Prefers a live
 * player embed for the viewer, falls back to the day-player embed; keeps the
 * still as the marker thumbnail. Returns null without a usable id/coordinates.
 */
export function mapWindyWebcam(w: WindyWebcam): Cam | null {
  const id = w?.webcamId;
  const loc = w?.location;
  if (id === undefined || id === null || !w.title) return null;
  if (typeof loc?.latitude !== "number" || typeof loc?.longitude !== "number") return null;

  const imageUrl = w.images?.current?.preview || w.images?.current?.thumbnail;
  const embed = w.player?.live || w.player?.day;
  const detail = w.urls?.detail || w.urls?.provider;
  const place = [loc.city, loc.country].filter(Boolean).join(", ") || undefined;
  const tags = (w.categories ?? [])
    .map((c) => c?.name)
    .filter((n): n is string => Boolean(n));

  return normaliseCam({
    camId: `windy:${id}`,
    provider: "windy",
    title: w.title,
    lat: loc.latitude,
    lng: loc.longitude,
    status: w.status === "active" ? "active" : w.status === "inactive" ? "inactive" : "unknown",
    place,
    country: loc.country,
    imageUrl,
    playerUrl: embed,
    // The Windy player is an iframe; surfacing it as `live` lets the viewer
    // embed the animated player rather than only the frozen still.
    live: embed ? { kind: "iframe", url: embed } : undefined,
    tags: tags.length ? tags : ["webcam"],
    attribution: {
      provider: "windy.com",
      requiredText: "Webcams provided by windy.com",
      linkUrl: detail || "https://www.windy.com/webcams",
    },
  });
}

export const windySource: CamSource = {
  id: "windy",
  provider: "windy",
  region: "Global (Windy Webcams)",
  pollIntervalSec: POLL_SEC,
  enabled: process.env.CAMS_WINDY_ENABLED !== "false" && Boolean(process.env.WINDY_WEBCAMS_API_KEY),

  async fetchCatalogue(): Promise<Cam[]> {
    const key = process.env.WINDY_WEBCAMS_API_KEY;
    if (!key) throw new Error("WINDY_WEBCAMS_API_KEY is not set");

    const out: Cam[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total && (MAX === 0 || out.length < MAX) && offset <= MAX_OFFSET) {
      const url = new URL(BASE);
      url.searchParams.set("limit", String(PAGE));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("include", "categories,images,location,player,urls");
      url.searchParams.set("lang", "en");

      const res = await fetch(url.toString(), { headers: { "x-windy-api-key": key } });
      // Soft-stop on the tier offset ceiling: keep whatever we've collected
      // rather than discarding the batch if the limit shifts under us.
      if (res.status === 400 && /offset is over api tier limit/i.test(await res.clone().text())) break;
      if (!res.ok) throw new Error(`Windy webcams ${res.status} ${res.statusText}`);
      const body = (await res.json()) as WindyResponse;
      const webcams = body.webcams ?? [];
      total = typeof body.total === "number" ? body.total : offset + webcams.length;
      if (!webcams.length) break;

      for (const w of webcams) {
        const cam = mapWindyWebcam(w);
        if (cam) out.push(cam);
      }
      offset += PAGE;
      if (offset < total && PAGE_DELAY_MS) await sleep(PAGE_DELAY_MS);
    }

    return MAX > 0 ? out.slice(0, MAX) : out;
  },
};
