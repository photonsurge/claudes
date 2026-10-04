import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { ShortRender, ShortRenderRequest, ShortRenderStatus } from "../short-render";
import type { iShortRenderModel, iShortRenderQueueModel } from "./short-render-model";

const KEYS: (keyof ShortRender)[] = [
  "id",
  "encoderId",
  "what",
  "publishAs",
  "offline",
  "accountId",
  "video",
  "roundup",
  "skipIfQuiet",
  "scheduleId",
  "batchId",
  "status",
  "startBy",
  "queuedAt",
  "startedAt",
  "endedAt",
  "scriptId",
  "runId",
  "videoUrl",
  "note",
  "assignedEncoderId",
  "retryOf",
  "formatId",
];

/** Wire shape from a lean doc: known keys only, unset ones omitted. */
function toRender(doc: iShortRenderModel): ShortRender {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = (doc as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as unknown as ShortRender;
}

/**
 * Render-queue persistence (`db.shortRenders`). Status changes that decide who
 * owns a video go through `transition`, a single conditional update, so two
 * advances can never both take the same render.
 */
export function makeShortRenderRepo(model: Model<iShortRenderModel>, queueModel: Model<iShortRenderQueueModel>) {
  return {
    model,

    /** Queue a video. Returns the stored render. */
    async create(req: ShortRenderRequest & { formatId?: string }, now = Date.now()): Promise<ShortRender> {
      const render: ShortRender = { ...req, id: uuidv4(), status: "queued", queuedAt: now };
      await model.create(render);
      return render;
    },

    async get(id: string): Promise<ShortRender | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? toRender(doc as iShortRenderModel) : null;
    },

    /** The render a run makes, or null. */
    async getByRunId(runId: string): Promise<ShortRender | null> {
      const doc = await model.findOne({ runId }).lean().exec();
      return doc ? toRender(doc as iShortRenderModel) : null;
    },

    /**
     * Renders in queue order (oldest queued first) — pass statuses to filter. With
     * `recent`, newest first and capped (the Renders list).
     */
    async list(filter: { status?: ShortRenderStatus[]; recent?: number } = {}): Promise<ShortRender[]> {
      const q = filter.status ? { status: { $in: filter.status } } : {};
      let cur = model.find(q).sort({ queuedAt: filter.recent ? -1 : 1 });
      if (filter.recent) cur = cur.limit(filter.recent);
      const docs = await cur.lean().exec();
      return docs.map((d) => toRender(d as iShortRenderModel));
    },

    /** Patch a render. Returns the updated render, or null. */
    async update(id: string, patch: Partial<ShortRender>): Promise<ShortRender | null> {
      const doc = await model.findOneAndUpdate({ id }, { $set: patch }, { new: true }).lean().exec();
      return doc ? toRender(doc as iShortRenderModel) : null;
    },

    /**
     * Move a render on only while it is still in one of `from` — the queue's
     * claim (queued → preparing) and every settle use it. Null when another
     * writer moved it first.
     */
    async transition(id: string, from: ShortRenderStatus[], patch: Partial<ShortRender>): Promise<ShortRender | null> {
      const doc = await model
        .findOneAndUpdate({ id, status: { $in: from } }, { $set: patch }, { new: true })
        .lean()
        .exec();
      return doc ? toRender(doc as iShortRenderModel) : null;
    },

    /**
     * Renders in `formatId` in one of `statuses` — default every unfinished one
     * (the format delete guard). Pass ["preparing", "live"] for the renders that
     * own the format's scene right now (the preview refusal, §5.3).
     */
    async countByFormat(
      formatId: string,
      statuses: ShortRenderStatus[] = ["queued", "preparing", "live"],
    ): Promise<number> {
      return model.countDocuments({ formatId, status: { $in: statuses } }).exec();
    },

    /** Encoders whose render queue is paused. */
    async pausedEncoders(): Promise<string[]> {
      const docs = await queueModel.find({ paused: true }).lean().exec();
      return docs.map((d) => (d as iShortRenderQueueModel).encoderId);
    },

    async setPaused(encoderId: string, paused: boolean): Promise<void> {
      await queueModel.updateOne({ encoderId }, { $set: { paused } }, { upsert: true }).exec();
    },
  };
}

export type ShortRenderRepo = ReturnType<typeof makeShortRenderRepo>;
