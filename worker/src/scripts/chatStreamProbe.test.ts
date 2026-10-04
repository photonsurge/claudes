import {
  BACKOFF_MIN_MS,
  FAILURE_WINDOW_MS,
  IDLE_MS,
  MAX_CONNS_PER_MINUTE,
  MAX_CONSECUTIVE_FAILURES,
  RECONNECT_FLOOR_MS,
  runProbe,
  type ProbeOptions,
} from "./chatStreamProbe";

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

const page = (token: string, ids: string[] = [], pollingIntervalMillis?: number) =>
  JSON.stringify({
    nextPageToken: token,
    ...(pollingIntervalMillis != null ? { pollingIntervalMillis } : {}),
    items: ids.map((id) => ({ id, snippet: { type: "textMessageEvent", displayMessage: id, publishedAt: "2026-10-04T12:00:08Z" } })),
  });

/**
 * Wires a probe whose fetch replays `responses` in order and aborts once they run
 * out. The clock is fake: it moves only when the probe sleeps or a response
 * factory calls `advance`.
 */
function harness(responses: Array<Response | ((advance: (ms: number) => void) => Response)>, extra: Partial<ProbeOptions> = {}) {
  let clock = NOW;
  const advance = (ms: number) => void (clock += ms);
  const ctrl = new AbortController();
  const lines: string[] = [];
  const urls: string[] = [];
  const sleeps: number[] = [];
  const forced: boolean[] = [];
  let i = 0;
  const opts: ProbeOptions = {
    liveChatId: "chat-1",
    now: () => clock,
    log: (l) => lines.push(l),
    signal: ctrl.signal,
    summaryEveryMs: 1e9,
    getToken: async (force) => {
      forced.push(force);
      return "tok";
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      advance(ms);
    },
    fetch: async (url) => {
      urls.push(url);
      if (i >= responses.length) {
        ctrl.abort();
        throw new Error("aborted");
      }
      const r = responses[i++];
      return typeof r === "function" ? r(advance) : r;
    },
    ...extra,
  };
  return { opts, ctrl, lines, urls, sleeps, forced };
}

describe("runProbe", () => {
  it("measures delays, skips the fresh backlog and resumes with nextPageToken after the floor wait", async () => {
    const h = harness([streamed([`[${page("t1", ["old"])},`, `${page("t2", ["a", "b"])}]`]), streamed([`[${page("t3", ["b", "c"])}]`])]);
    const r = await runProbe(h.opts);
    expect(r.stopReason).toBe("stopped");
    expect(r.backlogItems).toBe(1);
    expect(r.repeatItems).toBe(1);
    // a, b on the first connection (2 s old); c after the 5 s reconnect wait (7 s old).
    expect(r.stats.summary()).toMatchObject({ count: 3, p50: 2000, max: 7000 });
    expect(h.sleeps[0]).toBe(RECONNECT_FLOOR_MS); // healthy still waits the floor
    expect(new URL(h.urls[0]).searchParams.get("pageToken")).toBeNull();
    expect(new URL(h.urls[1]).searchParams.get("pageToken")).toBe("t2");
    expect(new URL(h.urls[0]).searchParams.get("liveChatId")).toBe("chat-1");
    expect(r.conns[1].resumedWithToken).toBe(true);
    expect(r.pageToken).toBe("t3");
  });

  it("backs off after failures, doubling, and resets after a healthy connection", async () => {
    const h = harness([status(500), status(503), streamed([`[${page("t1")}]`]), status(500)]);
    await runProbe(h.opts);
    expect(BACKOFF_MIN_MS).toBeGreaterThanOrEqual(RECONNECT_FLOOR_MS);
    expect(h.sleeps).toEqual([BACKOFF_MIN_MS, BACKOFF_MIN_MS * 2, RECONNECT_FLOOR_MS, BACKOFF_MIN_MS]);
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
    expect(h.sleeps[0]).toBe(RECONNECT_FLOOR_MS); // it had delivered: the plain floor, no backoff
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

  it("waits the server's pollingIntervalMillis when it is longer than the floor", async () => {
    const h = harness([streamed([`[${page("t1", [], 8_000)}]`]), streamed([`[${page("t2", [], 1_000)}]`]), streamed([`[${page("t3")}]`])]);
    await runProbe(h.opts);
    // 8 s hint honoured; a 1 s hint is held to the floor; no hint keeps the last one seen (1 s → floor).
    expect(h.sleeps).toEqual([8_000, RECONNECT_FLOOR_MS, RECONNECT_FLOOR_MS]);
    expect(h.lines.join("\n")).toMatch(/pollingIntervalMillis/);
  });

  it("caps connections per minute and calls out list-like behaviour", async () => {
    const single = () => streamed([`[${page("t")}]`]);
    const h = harness(Array.from({ length: 8 }, single));
    const r = await runProbe(h.opts);
    // Six opens at 0, 5, …, 25 s fill the minute; the seventh waits until 60 s.
    expect(h.sleeps.slice(0, 6)).toEqual(Array(6).fill(RECONNECT_FLOOR_MS));
    expect(h.sleeps[6]).toBe(60_000 - MAX_CONNS_PER_MINUTE * RECONNECT_FLOOR_MS);
    const out = h.lines.join("\n");
    expect(out).toMatch(/pacing: 6 connections in the last minute/);
    expect(r.pollingLike).toBe(true);
    expect(out).toMatch(/behaves like polling, not streaming/);
    expect(out).toMatch(/verdict: the endpoint behaved like polling/);
  });

  it("does not call a long-lived multi-response stream polling", async () => {
    const h = harness([streamed([`[${page("a")},${page("b")}]`]), streamed([`[${page("c")},${page("d")}]`]), streamed([`[${page("e")},${page("f")}]`]), streamed([`[${page("g")},${page("h")}]`]), streamed([`[${page("i")},${page("j")}]`])]);
    const r = await runProbe(h.opts);
    expect(r.pollingLike).toBe(false);
  });

  it.each([
    ["HTTP 400", () => status(400, "badRequest")],
    ["HTTP 403 forbidden", () => status(403, '{"error":{"errors":[{"reason":"forbidden"}]}}')],
  ])("gives up after repeated %s", async (_label, mk) => {
    const h = harness(Array.from({ length: 20 }, mk));
    const r = await runProbe(h.opts);
    expect(r.stopReason).toMatch(new RegExp(`giving up: ${MAX_CONSECUTIVE_FAILURES} connections in a row failed`));
    expect(h.urls).toHaveLength(MAX_CONSECUTIVE_FAILURES);
  });

  it("gives up when the token cannot be refreshed", async () => {
    const h = harness([streamed([`[${page("never")}]`])]);
    h.opts.getToken = async () => {
      throw new Error("invalid_grant");
    };
    const r = await runProbe(h.opts);
    expect(r.stopReason).toMatch(/giving up: 8 connections in a row failed \(last: error: invalid_grant\)/);
    expect(h.urls).toHaveLength(0);
  });

  it("gives up after the failure window with no healthy connection", async () => {
    const slowFail = (advance: (ms: number) => void) => {
      advance(4 * 60_000); // each failure takes 4 min (e.g. a hung gateway)
      return status(502, "bad gateway");
    };
    const h = harness(Array.from({ length: 20 }, () => slowFail));
    const r = await runProbe(h.opts);
    expect(r.stopReason).toMatch(/giving up: no healthy connection for/);
    expect(h.urls.length).toBeLessThan(MAX_CONSECUTIVE_FAILURES);
    expect(h.urls.length * 4 * 60_000).toBeGreaterThanOrEqual(FAILURE_WINDOW_MS - 60_000);
  });

  it("notes that delays depend on this machine's clock", async () => {
    const h = harness([]);
    await runProbe(h.opts);
    expect(h.lines.join("\n")).toMatch(/THIS machine's clock/);
  });

  it("Ctrl-C during a backoff sleep stops without another connection", async () => {
    const h = harness([status(500), streamed([`[${page("never")}]`])]);
    h.opts.sleep = async () => h.ctrl.abort();
    const r = await runProbe(h.opts);
    expect(r.stopReason).toBe("stopped");
    expect(h.urls).toHaveLength(1);
  });
});
