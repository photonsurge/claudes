import { BACKOFF_MIN_MS, IDLE_MS, runProbe, type ProbeOptions } from "./chatStreamProbe";

const NOW = Date.parse("2026-10-04T12:00:10Z");

/** A 200 whose body streams `chunks` then closes — or stays open when `hold`. */
function streamed(chunks: string[], hold = false): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!hold) c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}
const status = (code: number, body = "") => new Response(body, { status: code });

const page = (token: string, ids: string[] = []) =>
  JSON.stringify({
    nextPageToken: token,
    items: ids.map((id) => ({ id, snippet: { type: "textMessageEvent", displayMessage: id, publishedAt: "2026-10-04T12:00:08Z" } })),
  });

/** Wires a probe whose fetch replays `responses` in order; aborts once they run out. */
function harness(responses: Array<Response | (() => Response)>, extra: Partial<ProbeOptions> = {}) {
  const ctrl = new AbortController();
  const lines: string[] = [];
  const urls: string[] = [];
  const sleeps: number[] = [];
  const forced: boolean[] = [];
  let i = 0;
  const opts: ProbeOptions = {
    liveChatId: "chat-1",
    now: () => NOW,
    log: (l) => lines.push(l),
    signal: ctrl.signal,
    summaryEveryMs: 1e9,
    getToken: async (force) => {
      forced.push(force);
      return "tok";
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetch: async (url) => {
      urls.push(url);
      if (i >= responses.length) {
        ctrl.abort();
        throw new Error("aborted");
      }
      const r = responses[i++];
      return typeof r === "function" ? r() : r;
    },
    ...extra,
  };
  return { opts, ctrl, lines, urls, sleeps, forced };
}

describe("runProbe", () => {
  it("measures delays, skips the fresh backlog and resumes with nextPageToken at once after a healthy connection", async () => {
    const h = harness([streamed([`[${page("t1", ["old"])},`, `${page("t2", ["a", "b"])}]`]), streamed([`[${page("t3", ["b", "c"])}]`])]);
    const r = await runProbe(h.opts);
    expect(r.stopReason).toBe("stopped");
    expect(r.backlogItems).toBe(1);
    expect(r.repeatItems).toBe(1);
    expect(r.stats.summary()).toMatchObject({ count: 3, p50: 2000, max: 2000 });
    expect(h.sleeps).toEqual([]); // healthy → immediate reconnect
    expect(new URL(h.urls[0]).searchParams.get("pageToken")).toBeNull();
    expect(new URL(h.urls[1]).searchParams.get("pageToken")).toBe("t2");
    expect(new URL(h.urls[0]).searchParams.get("liveChatId")).toBe("chat-1");
    expect(r.conns[1].resumedWithToken).toBe(true);
    expect(r.pageToken).toBe("t3");
  });

  it("backs off after failures, doubling, and resets after a healthy connection", async () => {
    const h = harness([status(500), status(503), streamed([`[${page("t1")}]`]), status(500)]);
    await runProbe(h.opts);
    expect(h.sleeps).toEqual([BACKOFF_MIN_MS, BACKOFF_MIN_MS * 2, BACKOFF_MIN_MS]);
  });

  it("asks for a fresh token after a 401", async () => {
    const h = harness([status(401, "unauthorized"), streamed([`[${page("t1")}]`])]);
    await runProbe(h.opts);
    expect(h.forced.slice(0, 2)).toEqual([false, true]);
  });

  it.each([
    ["HTTP 403 quotaExceeded", status(403, '{"error":{"code":403,"errors":[{"reason":"quotaExceeded"}]}}')],
    ["HTTP 403 rateLimitExceeded", status(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')],
    ["HTTP 429", status(429)],
    ["streamed RESOURCE_EXHAUSTED", streamed(['[{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"spent"}}'], true)],
    ["streamed quotaExceeded reason", streamed(['[{"error":{"code":403,"errors":[{"reason":"quotaExceeded"}]}}]'])],
  ])("stops on quota exhaustion: %s", async (_label, res) => {
    const h = harness([res, streamed([`[${page("never")}]`])]);
    const r = await runProbe(h.opts);
    expect(r.stopReason).toMatch(/^quota exhausted/);
    expect(h.urls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it.each([404, 405, 501])("stops on HTTP %i and points at the gRPC fallback", async (code) => {
    const h = harness([status(code, "Not Found"), streamed([`[${page("never")}]`])]);
    const r = await runProbe(h.opts);
    expect(r.stopReason).toMatch(new RegExp(`http ${code}`));
    expect(r.stopReason).toMatch(/gRPC/);
    expect(h.urls).toHaveLength(1);
    expect(h.lines.join("\n")).toMatch(/final summary/);
  });

  it("stops when the chat says it ended", async () => {
    const h = harness([streamed(['[{"offlineAt":"2026-10-04T12:00:00Z","items":[]}'], true)]);
    const r = await runProbe(h.opts);
    expect(r.stopReason).toBe("chat over");
    expect(r.conns[0].endReason).toMatch(/^chat-ended/);
  });

  it("drops a connection that sends no bytes for the idle window, then reconnects", async () => {
    expect(IDLE_MS).toBe(5 * 60_000);
    const h = harness([streamed([`[${page("t1")},`], true), streamed([`[${page("t2")}]`])], { idleMs: 30 });
    const r = await runProbe(h.opts);
    expect(r.conns[0].endReason).toMatch(/^idle/);
    expect(new URL(h.urls[1]).searchParams.get("pageToken")).toBe("t1");
    expect(h.sleeps).toEqual([]); // it had delivered, so the reconnect is immediate
  });

  it("Ctrl-C (abort) cuts the open connection and prints the final summary", async () => {
    const h = harness([streamed([`[${page("t1")},`, `${page("t2", ["a"])},`], true)]);
    const done = runProbe(h.opts);
    setTimeout(() => h.ctrl.abort(), 20);
    const r = await done;
    expect(r.stopReason).toBe("stopped");
    expect(r.conns).toHaveLength(1);
    expect(r.conns[0].endReason).toBe("stopped");
    expect(r.stats.summary().count).toBe(1);
    const out = h.lines.join("\n");
    expect(out).toMatch(/final summary/);
    expect(out).toMatch(/n=1 p50=2.0s/);
    expect(out).toMatch(/connections: 1/);
  });

  it("Ctrl-C during a backoff sleep stops without another connection", async () => {
    const h = harness([status(500), streamed([`[${page("never")}]`])]);
    h.opts.sleep = async () => h.ctrl.abort();
    const r = await runProbe(h.opts);
    expect(r.stopReason).toBe("stopped");
    expect(h.urls).toHaveLength(1);
  });
});
