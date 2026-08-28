import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import {
  planExposure,
  type ExposureKey,
  type OpenExposure,
} from "../ads/exposure";
import type { AdExposureSurface, iAdExposureModel } from "./ad-exposure-model";

/** One window on the wire (epoch ms; `endedAt` absent = airing right now). */
export interface AdExposureWindow {
  sceneId: string;
  startedAt: number;
  endedAt?: number;
  /** Window length so far — up to `endedAt`, or to `now` while still open. */
  ms: number;
}

/** Per-ad rollup for the admin list. */
export interface AdExposureTotal {
  /** Cumulative on-air milliseconds across every window (open ones to `now`). */
  ms: number;
  /** Scene ids the ad is airing on RIGHT NOW (empty = not currently on air). */
  liveScenes: string[];
}

/**
 * Sponsor-exposure persistence: the worker's reconcile sweep writes windows
 * through `reconcile` (pure decisions in ads/exposure.ts); the admin reads
 * per-ad histories and rollups. Nothing here is latency-critical — the
 * collection stays tiny (windows change when an operator flips something,
 * not per crawl loop).
 */
export function makeAdExposureRepo(model: Model<iAdExposureModel>) {
  return {
    model,

    /** Open windows (endedAt unset) for one surface, as the planner wants them. */
    async openWindows(surface: AdExposureSurface): Promise<OpenExposure[]> {
      const docs = await model
        .find({ surface, endedAt: null })
        .lean()
        .exec();
      return docs.map((d) => ({
        id: d.id,
        adId: d.adId,
        sceneId: d.sceneId,
        startedAt: new Date(d.startedAt).getTime(),
        lastSeenAt: new Date(d.lastSeenAt).getTime(),
      }));
    },

    /**
     * One sweep tick: open/close/heartbeat windows so storage matches the pairs
     * that should be airing right now. `staleMs` is the downtime threshold —
     * pass ~3× the sweep interval.
     */
    async reconcile(
      surface: AdExposureSurface,
      current: ExposureKey[],
      now: Date,
      staleMs: number,
    ): Promise<{ opened: number; closed: number; touched: number }> {
      const plan = planExposure(await this.openWindows(surface), current, now.getTime(), staleMs);
      if (plan.close.length) {
        await Promise.all(
          plan.close.map((c) =>
            model.updateOne({ id: c.id }, { $set: { endedAt: new Date(c.at) } }).exec(),
          ),
        );
      }
      if (plan.touch.length) {
        await model
          .updateMany({ id: { $in: plan.touch } }, { $set: { lastSeenAt: now } })
          .exec();
      }
      if (plan.open.length) {
        await model.insertMany(
          plan.open.map((k) => ({
            id: uuidv4(),
            adId: k.adId,
            sceneId: k.sceneId,
            surface,
            startedAt: now,
            lastSeenAt: now,
          })),
        );
      }
      return { opened: plan.open.length, closed: plan.close.length, touched: plan.touch.length };
    },

    /** One ad's windows, newest first (the admin "ticker log"). No cap by default. */
    async listForAd(
      adId: string,
      surface: AdExposureSurface,
      now: Date = new Date(),
    ): Promise<AdExposureWindow[]> {
      const docs = await model
        .find({ adId, surface })
        .sort({ startedAt: -1 })
        .lean()
        .exec();
      return docs.map((d) => {
        const startedAt = new Date(d.startedAt).getTime();
        const endedAt = d.endedAt ? new Date(d.endedAt).getTime() : undefined;
        return {
          sceneId: d.sceneId,
          startedAt,
          endedAt,
          ms: Math.max(0, (endedAt ?? now.getTime()) - startedAt),
        };
      });
    },

    /** Cumulative time + currently-live scenes per ad (the admin list column). */
    async totalsByAd(
      surface: AdExposureSurface,
      now: Date = new Date(),
    ): Promise<Record<string, AdExposureTotal>> {
      const docs = await model
        .find({ surface })
        .select({ adId: 1, sceneId: 1, startedAt: 1, endedAt: 1 })
        .lean()
        .exec();
      const totals: Record<string, AdExposureTotal> = {};
      for (const d of docs) {
        const t = (totals[d.adId] ??= { ms: 0, liveScenes: [] });
        const end = d.endedAt ? new Date(d.endedAt).getTime() : now.getTime();
        t.ms += Math.max(0, end - new Date(d.startedAt).getTime());
        if (!d.endedAt && !t.liveScenes.includes(d.sceneId)) t.liveScenes.push(d.sceneId);
      }
      return totals;
    },
  };
}

export type AdExposureRepo = ReturnType<typeof makeAdExposureRepo>;
