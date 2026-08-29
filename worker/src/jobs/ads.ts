/**
 * BullMQ entry points for the advertisement domain. Dispatched as:
 *   ads.exposure {}   (repeatable sponsor-exposure sweep)
 *
 * The exposure sweep is the writer behind the admin exposure log: it computes
 * which (ad, scene) pairs each always-on sponsor surface is airing RIGHT NOW —
 * `ticker` (the crawl's "Sponsored by …" mention: ad active + ticker-placed,
 * scene's crawl widget not hidden) and `billboard` (the bottom-left corner
 * rotation: active + billboard-placed IMAGE ads, scene's billboard widget not
 * hidden) — and reconciles the open exposure windows to match (open/close/
 * heartbeat rules in shared/ads/exposure.ts, storage in db.adExposures). A
 * billboard window means "in the corner rotation", the same way a ticker
 * window means "in the crawl loop" — not sole possession of the slot. Ad
 * BREAKS are not logged here — they already land in the as-run log + the
 * per-ad timesShown/totalDisplayMs counters when the director cuts to them.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { Ad } from "@photonsurge/shared/ads/types";
import type { ExposureKey } from "@photonsurge/shared/ads/exposure";
import type { AdExposureSurface } from "@photonsurge/shared/db/ad-exposure-model";

/** Sweep cadence — index.ts registers the repeatable off the same env var. */
const ADS_EXPOSURE_MS = Number(process.env.ADS_EXPOSURE_MS || 60 * 1000);
/** A heartbeat older than this means the worker was down (downtime never counts). */
const STALE_MS = 3 * ADS_EXPOSURE_MS;

/**
 * The (ad, scene) pairs one surface is airing right now. Pure — the cross
 * product of the surface's active placed ads × the scenes showing its widget
 * (each surface's per-channel toggle shares its name, hidden via
 * ControlState.widgetsOff). The billboard renders images only, so a video
 * creative placed there never airs and never logs.
 */
export function exposurePairs(
  scenes: { id: string; widgetsOff?: string[] }[],
  ads: (Pick<Ad, "adId" | "status" | "placements"> & { mediaType?: Ad["mediaType"] })[],
  surface: AdExposureSurface = "ticker",
): ExposureKey[] {
  const airing = ads.filter(
    (a) =>
      a.status === "active" &&
      a.placements.includes(surface) &&
      (surface !== "billboard" || a.mediaType === "image"),
  );
  const pairs: ExposureKey[] = [];
  for (const scene of scenes) {
    if ((scene.widgetsOff ?? []).includes(surface)) continue;
    for (const ad of airing) pairs.push({ adId: ad.adId, sceneId: scene.id });
  }
  return pairs;
}

/** Repeatable sweep keeping the exposure windows honest, per surface. */
export async function exposure(_job: Job) {
  const db = await getAppDb();
  const ads = await db.ads.list({ status: "active" });
  const sceneMeta = await db.listScenes();
  const docs = await Promise.all(sceneMeta.map((s) => db.getScene(s.id)));
  const scenes = docs
    .filter((d): d is NonNullable<typeof d> => d != null)
    .map((d: any) => ({ id: String(d.id), widgetsOff: d.widgetsOff as string[] | undefined }));
  const now = new Date();
  const surfaces: AdExposureSurface[] = ["ticker", "billboard"];
  const results = await Promise.all(
    surfaces.map((s) =>
      db.adExposures.reconcile(s, exposurePairs(scenes, ads, s), now, STALE_MS),
    ),
  );
  return Object.fromEntries(surfaces.map((s, i) => [s, results[i]]));
}
