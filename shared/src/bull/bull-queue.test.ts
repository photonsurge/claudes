/**
 * sendToQueue's dedup default — the guard that stops a fan-out producer (the
 * events watcher, the per-alert snapshot loop) piling the same job on the queue
 * once per tick. The BullMQ Queue is stubbed via the getQueue() global singleton
 * cache, so nothing here touches a real Redis.
 */
import { sendToQueue, dedupIdFor, stableStringify, QUEUE_PRIORITY } from "./bull-queue";

type AddCall = { name: string; payload: any; opts: any };

function stubQueue() {
  const calls: AddCall[] = [];
  const q: any = {
    waitUntilReady: async () => undefined,
    add: async (name: string, payload: any, opts: any) => {
      calls.push({ name, payload, opts });
      return { id: "1" };
    },
  };
  // All three tiers point at one stub — sendToQueue routes by type, but every route
  // lands on the same capture here regardless of which tier the payload's type maps to.
  (global as any).__queues__ = { foreground: q, mid: q, background: q };
  return calls;
}

afterEach(() => {
  delete (global as any).__queues__;
});

describe("stableStringify", () => {
  it("is insensitive to key order, so the same payload built differently hashes alike", () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("keeps array order, which is meaningful", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("treats an explicit undefined as absent", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe("dedupIdFor", () => {
  it("is stable for the same job and readable at a glance", () => {
    const id = dedupIdFor("events", "events", "acquire", { eventId: "e1", source: "gdacs" });
    expect(id).toBe(dedupIdFor("events", "events", "acquire", { source: "gdacs", eventId: "e1" }));
    expect(id).toMatch(/^events:acquire:[0-9a-f]{16}$/);
  });

  it("separates different events, payloads and domains", () => {
    const base = dedupIdFor("events", "events", "acquire", { eventId: "e1" });
    expect(dedupIdFor("events", "events", "acquire", { eventId: "e2" })).not.toBe(base);
    expect(dedupIdFor("events", "events", "watch", { eventId: "e1" })).not.toBe(base);
    expect(dedupIdFor("other", "events", "acquire", { eventId: "e1" })).not.toBe(base);
  });
});

describe("sendToQueue dedup", () => {
  it("dedups by default, and WITHOUT a ttl — a ttl would outlive the job and block the next real run", async () => {
    const calls = stubQueue();
    await sendToQueue("events", "events", "acquire", { eventId: "e1", source: "gdacs" });
    expect(calls[0].opts.deduplication).toEqual({
      id: dedupIdFor("events", "events", "acquire", { eventId: "e1", source: "gdacs" }),
    });
    expect(calls[0].opts.deduplication.ttl).toBeUndefined();
  });

  it("gives two different events their own key, so one never suppresses the other", async () => {
    const calls = stubQueue();
    await sendToQueue("events", "events", "acquire", { eventId: "e1" });
    await sendToQueue("events", "events", "acquire", { eventId: "e2" });
    expect(calls[0].opts.deduplication.id).not.toBe(calls[1].opts.deduplication.id);
  });

  it("dedupe:false opts out entirely — for jobs whose effect isn't a pure function of the payload", async () => {
    const calls = stubQueue();
    await sendToQueue("ping", "ping", "create", { message: "hi" }, undefined, QUEUE_PRIORITY.HIGH, { dedupe: false });
    expect(calls[0].opts.deduplication).toBeUndefined();
  });

  it("accepts an explicit dedup id for payloads carrying a field that shouldn't split the key", async () => {
    const calls = stubQueue();
    await sendToQueue("events", "events", "acquire", { eventId: "e1", at: 123 }, undefined, undefined, {
      dedupe: "events:acquire:e1",
    });
    expect(calls[0].opts.deduplication).toEqual({ id: "events:acquire:e1" });
  });

  it("dedups delayed jobs too, without disturbing the delay", async () => {
    const calls = stubQueue();
    await sendToQueue("events", "events", "acquire", { eventId: "e1" }, new Date(Date.now() + 60_000));
    expect(calls[0].opts.deduplication.id).toBeDefined();
    expect(calls[0].opts.delay).toBeGreaterThan(0);
  });

  it("keeps a self-chaining job's successor enqueueable — the batch counter varies, so the key does too", async () => {
    // cities.enrichWikiAll / climate.backfillClimate enqueue their own successor
    // from INSIDE the active job, while the parent still holds its dedup key. If
    // the payloads collided the chain would silently stop after one batch.
    const calls = stubQueue();
    await sendToQueue("cities", "cities", "enrichWikiAll", { batchSize: 100, batch: 1, maxBatches: 2000 });
    await sendToQueue("cities", "cities", "enrichWikiAll", { batchSize: 100, batch: 2, maxBatches: 2000 });
    expect(calls[0].opts.deduplication.id).not.toBe(calls[1].opts.deduplication.id);
  });
});
