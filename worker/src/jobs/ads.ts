/**
 * BullMQ entry points for the advertisement domain. Dispatched as:
 *   ads.exposure {}   (repeatable sponsor-exposure sweep)
 *
 * The exposure sweep is the writer behind the admin "ticker log": it computes
 * which (ad, scene) pairs the crawl's "Sponsored by …" mention is airing for
 * RIGHT NOW — ad active + ticker-placed, scene's crawl widget not hidden —
 * and reconciles the open exposure windows to match (open/close/heartbeat
 * rules in shared/ads/exposure.ts, storage in db.adExposures). Ad BREAKS are
 * not logged here — they already land in the as-run log + the per-ad
 * timesShown/totalDisplayMs counters when the director cuts to them.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import type { Ad } from "@photonsurge/shared/ads/types";
import type { ExposureKey } from "@photonsurge/shared/ads/exposure";

/** Sweep cadence — index.ts registers the repeatable off the same env var. */
const ADS_EXPOSURE_MS = Number(process.env.ADS_EXPOSURE_MS || 60 * 1000);
/** A heartbeat older than this means the worker was down (downtime never counts). */
const STALE_MS = 3 * ADS_EXPOSURE_MS;

/**
 * The (ad, scene) pairs whose ticker mention is airing right now. Pure — the
 * cross product of active ticker-placed ads × scenes showing the crawl (the
 * per-channel `ticker` widget toggle, hidden via ControlState.widgetsOff).
 */
export function exposurePairs(
  scenes: { id: string; widgetsOff?: string[] }[],
  ads: Pick<Ad, "adId" | "status" | "placements">[],
): ExposureKey[] {
  const mentioned = ads.filter(
    (a) => a.status === "active" && a.placements.includes("ticker"),
  );
  const pairs: ExposureKey[] = [];
  for (const scene of scenes) {
    if ((scene.widgetsOff ?? []).includes("ticker")) continue;
    for (const ad of mentioned) pairs.push({ adId: ad.adId, sceneId: scene.id });
  }
  return pairs;
}

/** Repeatable sweep keeping the exposure windows honest. */
export async function exposure(_job: Job) {
  const db = await getAppDb();
  const ads = await db.ads.list({ status: "active" });
  const sceneMeta = await db.listScenes();
  const docs = await Promise.all(sceneMeta.map((s) => db.getScene(s.id)));
  const scenes = docs
    .filter((d): d is NonNullable<typeof d> => d != null)
    .map((d: any) => ({ id: String(d.id), widgetsOff: d.widgetsOff as string[] | undefined }));
  return db.adExposures.reconcile("ticker", exposurePairs(scenes, ads), new Date(), STALE_MS);
}
