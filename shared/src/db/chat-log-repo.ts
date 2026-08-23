import type { Model } from "mongoose";
import type { ChatMessage } from "../runs";
import type { iChatLogMessage } from "./chat-log-model";

const strip = (doc: Record<string, unknown>): ChatMessage => {
  const { __v, _id, created, updated, ...rest } = doc;
  return rest as unknown as ChatMessage;
};

/** Shape of the driver's bulk-write error, as far as `append` cares. */
type BulkErr = {
  code?: number;
  writeErrors?: Array<{ code?: number; err?: { code?: number } }>;
  insertedDocs?: unknown[];
};

const DUP_KEY = 11000;

/**
 * The chat-log persistence. One writer (the worker's per-run chat poller), read
 * by the /api/streams/:id/chat history route. Append is idempotent: the model's
 * unique `id` index drops re-polled duplicates, so the poller can blind-write
 * every page (including the backlog page) without tracking what it already saved.
 */
export function makeChatLogRepo(model: Model<iChatLogMessage>) {
  return {
    model,

    /** Insert messages, silently skipping ones already logged. Returns the number actually inserted. */
    async append(msgs: ChatMessage[]): Promise<number> {
      if (!msgs.length) return 0;
      try {
        const docs = await model.insertMany(msgs, { ordered: false });
        return docs.length;
      } catch (err) {
        const e = err as BulkErr;
        const writeErrors = e.writeErrors ?? [];
        const allDup =
          writeErrors.length > 0
            ? writeErrors.every((w) => (w.code ?? w.err?.code) === DUP_KEY)
            : e.code === DUP_KEY;
        if (allDup) return e.insertedDocs?.length ?? 0;
        throw err;
      }
    },

    /** A run's logged chat in air order. No default cap — the whole log by default. */
    async listForRun(runId: string, opts: { since?: number; limit?: number } = {}): Promise<ChatMessage[]> {
      const query: Record<string, unknown> = { runId };
      if (opts.since && opts.since > 0) query.ts = { $gt: opts.since };
      let q = model.find(query).sort({ ts: 1, id: 1 });
      if (opts.limit && opts.limit > 0) q = q.limit(opts.limit);
      const docs = await q.lean().exec();
      return (docs as Record<string, unknown>[]).map(strip);
    },
  };
}

export type ChatLogRepo = ReturnType<typeof makeChatLogRepo>;
