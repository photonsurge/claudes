import {
  chatEnded,
  connectionSummary,
  DelayStats,
  isQuotaFailure,
  messageDelayMs,
  percentile,
  ResumeState,
  StreamFrameParser,
  type ConnectionRecord,
} from "./chat-stream";

const resp = (ids: string[], token?: string) => ({
  items: ids.map((id) => ({ id, snippet: { type: "textMessageEvent", displayMessage: `m ${id}` } })),
  ...(token ? { nextPageToken: token } : {}),
});

describe("StreamFrameParser — JSON array framing", () => {
  it("yields each element of a streamed array, split at every possible byte", () => {
    const a = { items: [{ id: "1", snippet: { displayMessage: 'he said "{hi}" \\ ok]' } }], nextPageToken: "t1" };
    const b = { items: [], nextPageToken: "t2" };
    const body = `[${JSON.stringify(a, null, 2)}\n,\n${JSON.stringify(b)}\n]`;
    for (let cut = 0; cut <= body.length; cut++) {
      const p = new StreamFrameParser();
      const out = [...p.push(body.slice(0, cut)), ...p.push(body.slice(cut))];
      expect(out).toEqual([a, b]);
      expect(p.framing).toBe("json-array");
    }
  });

  it("yields one char at a time", () => {
    const body = `[{"a":"x\\"}"},{"b":{"c":[1,{"d":2}]}}]`;
    const p = new StreamFrameParser();
    const out: unknown[] = [];
    for (const ch of body) out.push(...p.push(ch));
    expect(out).toEqual([{ a: 'x"}' }, { b: { c: [1, { d: 2 }] } }]);
    expect(p.pending).toBe("");
  });

  it("holds back an unfinished object and reports it as pending", () => {
    const p = new StreamFrameParser();
    expect(p.push('[{"a":1},{"b":')).toEqual([{ a: 1 }]);
    expect(p.pending).toBe('{"b":');
    expect(p.push("2}")).toEqual([{ b: 2 }]);
  });

  it("passes an error element through", () => {
    const p = new StreamFrameParser();
    expect(p.push('[{"error":{"code":403,"errors":[{"reason":"quotaExceeded"}]}}]')).toEqual([
      { error: { code: 403, errors: [{ reason: "quotaExceeded" }] } },
    ]);
  });

  it("waits for a non-blank character before choosing a framing", () => {
    const p = new StreamFrameParser();
    expect(p.push("  \n")).toEqual([]);
    expect(p.framing).toBeNull();
    expect(p.push('{"a":1}')).toEqual([{ a: 1 }]);
    expect(p.framing).toBe("json-array");
  });
});

describe("StreamFrameParser — SSE framing", () => {
  it("yields each event's data, across chunk splits and CRLF", () => {
    const body = 'data: {"nextPageToken":"t1"}\r\n\r\n: keep-alive\n\ndata: {"items":\ndata: []}\n\n';
    for (let cut = 0; cut <= body.length; cut++) {
      const p = new StreamFrameParser();
      const out = [...p.push(body.slice(0, cut)), ...p.push(body.slice(cut))];
      expect(out).toEqual([{ nextPageToken: "t1" }, { items: [] }]);
      expect(p.framing).toBe("sse");
    }
  });
});

describe("delay stats", () => {
  it("nearest-rank percentiles", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(5);
    expect(percentile(s, 90)).toBe(9);
    expect(percentile(s, 100)).toBe(10);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 90)).toBe(7);
  });

  it("summarises samples added out of order and ignores non-finite ones", () => {
    const d = new DelayStats();
    expect(d.summary()).toEqual({ count: 0, p50: 0, p90: 0, max: 0, mean: 0 });
    for (const ms of [900, 100, 500, NaN, 300, 700]) d.add(ms);
    expect(d.summary()).toEqual({ count: 5, p50: 500, p90: 900, max: 900, mean: 500 });
    d.add(5000);
    expect(d.summary().max).toBe(5000);
  });

  it("messageDelayMs is now minus publishedAt", () => {
    const now = Date.parse("2026-10-04T12:00:03.500Z");
    expect(messageDelayMs({ snippet: { publishedAt: "2026-10-04T12:00:01Z" } }, now)).toBe(2500);
    expect(messageDelayMs({ snippet: { publishedAt: "garbage" } }, now)).toBeNull();
    expect(messageDelayMs({}, now)).toBeNull();
  });
});

describe("ResumeState", () => {
  it("flags only the first response of a fresh connection as backlog", () => {
    const r = new ResumeState();
    expect(r.startConnection()).toBeUndefined();
    expect(r.resumed).toBe(false);
    expect(r.accept(resp(["a", "b"], "t1")).backlog).toBe(true);
    expect(r.accept(resp(["c"], "t2")).backlog).toBe(false);
  });

  it("resumes from the last nextPageToken and keeps it when a response has none", () => {
    const r = new ResumeState();
    r.startConnection();
    r.accept(resp(["a"], "t1"));
    r.accept(resp(["b"]));
    expect(r.pageToken).toBe("t1");
    r.accept(resp([], "t2"));
    expect(r.startConnection()).toBe("t2");
    expect(r.resumed).toBe(true);
    // A resumed connection's first response is live chat, not backlog.
    expect(r.accept(resp(["c"], "t3")).backlog).toBe(false);
  });

  it("drops items a reconnect repeats", () => {
    const r = new ResumeState();
    r.startConnection();
    r.accept(resp(["a", "b"], "t1"));
    r.startConnection();
    const out = r.accept(resp(["b", "c"], "t2"));
    expect(out.fresh.map((i) => i.id)).toEqual(["c"]);
    expect(out.repeats).toBe(1);
  });

  it("forgets the oldest ids past its cap", () => {
    const r = new ResumeState(2);
    r.startConnection();
    r.accept(resp(["a", "b", "c"]));
    expect(r.accept(resp(["a", "c"])).fresh.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("chatEnded", () => {
  it("is true on offlineAt or a chatEndedEvent", () => {
    expect(chatEnded({ items: [] })).toBe(false);
    expect(chatEnded({ offlineAt: "2026-10-04T12:00:00Z" })).toBe(true);
    expect(chatEnded({ items: [{ snippet: { type: "chatEndedEvent" } }] })).toBe(true);
  });
});

describe("connectionSummary", () => {
  it("counts connections, resumes, lengths and end reasons", () => {
    const c = (n: number, len: number, resumed: boolean, endReason: string): ConnectionRecord => ({
      n,
      openedAt: 0,
      closedAt: len,
      firstByteMs: 10,
      resumedWithToken: resumed,
      framing: "json-array",
      responses: 1,
      items: 1,
      bytes: 1,
      endReason,
    });
    expect(connectionSummary([])).toBe("connections: none");
    const s = connectionSummary([c(1, 60_000, false, "server-closed"), c(2, 30_000, true, "error: x"), c(3, 90_000, true, "server-closed")]);
    expect(s).toContain("connections: 3 (2 resumed with pageToken)");
    expect(s).toContain("p50=60.0s");
    expect(s).toContain("max=90.0s");
    expect(s).toContain("server-closed×2");
    expect(s).toContain("error×1");
  });
});

describe("isQuotaFailure", () => {
  it("recognises every quota / rate form and nothing else", () => {
    expect(isQuotaFailure({ httpStatus: 429 })).toBe(true);
    expect(isQuotaFailure({ httpStatus: 403, body: '{"errors":[{"reason":"quotaExceeded"}]}' })).toBe(true);
    expect(isQuotaFailure({ httpStatus: 403, body: "rateLimitExceeded" })).toBe(true);
    expect(isQuotaFailure({ error: { status: "RESOURCE_EXHAUSTED" } })).toBe(true);
    expect(isQuotaFailure({ error: { code: 429 } })).toBe(true);
    expect(isQuotaFailure({ error: { code: 403, errors: [{ reason: "dailyLimitExceeded" }] } })).toBe(true);
    expect(isQuotaFailure({ error: { code: 403, errors: [{ reason: "forbidden" }] } })).toBe(false);
    expect(isQuotaFailure({ httpStatus: 403, body: "insufficientPermissions" })).toBe(false);
    expect(isQuotaFailure({ httpStatus: 500 })).toBe(false);
  });
});
