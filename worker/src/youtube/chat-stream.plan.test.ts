/**
 * Plan-level tests for the streamList probe helpers (docs/crossword-mode-plan.md §6.2,
 * WP9): the probe must print each message's delay (now minus publish time), how long a
 * connection lasts, how it resumes, and stop cleanly with a summary. Written from that
 * description, not from the helpers' own test file.
 */
import {
  chatEnded,
  connectionSummary,
  DelayStats,
  fmtConnection,
  fmtDelaySummary,
  fmtMs,
  messageDelayMs,
  percentile,
  ResumeState,
  StreamFrameParser,
  type ConnectionRecord,
  type StreamItem,
  type StreamResponse,
} from "./chat-stream";

const item = (id: string, publishedAt?: string, type = "textMessageEvent"): StreamItem => ({
  id,
  snippet: { type, publishedAt, displayMessage: `msg ${id}` },
  authorDetails: { displayName: `viewer ${id}`, channelId: `UC${id}` },
});

/** Feed `body` to a fresh parser in the given chunk sizes; return every frame. */
function feed(body: string, cuts: number[]): { frames: unknown[]; parser: StreamFrameParser } {
  const parser = new StreamFrameParser();
  const frames: unknown[] = [];
  let at = 0;
  for (const c of [...cuts, body.length]) {
    frames.push(...parser.push(body.slice(at, c)));
    at = c;
  }
  return { frames, parser };
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

describe("framing: JSON array (the REST gateway's default)", () => {
  const tricky: StreamResponse = {
    items: [
      {
        id: "a1",
        snippet: {
          type: "textMessageEvent",
          publishedAt: "2026-10-04T12:00:00.000Z",
          // every escape a chat message can carry, plus brackets/braces inside strings
          displayMessage: 'q "quoted" \\ back } brace ] bracket { [ \n newline \t tab \u00e9 \ud83d\ude00 \\"',
        },
        authorDetails: { displayName: "Zoë \\o/", channelId: "UCx" },
      },
    ],
    nextPageToken: "tok-1",
  };
  const plain: StreamResponse = { items: [item("a2", "2026-10-04T12:00:01.000Z")], nextPageToken: "tok-2" };

  it("recovers every response when split at each pair of positions (mid-escape included)", () => {
    const body = `[\n${JSON.stringify(tricky)},\n${JSON.stringify(plain)}\n]`;
    // Two cuts at every combination would be O(n²) pushes on a ~300-char body: fine.
    for (let i = 0; i <= body.length; i += 1) {
      for (let j = i; j <= body.length; j += 7) {
        const { frames, parser } = feed(body, [i, j]);
        expect(frames).toEqual([tricky, plain]);
        expect(parser.framing).toBe("json-array");
      }
    }
  });

  it("splits right after a backslash inside a string without ending the string early", () => {
    const r: StreamResponse = { items: [item("x")], nextPageToken: 'a\\"b' };
    const body = `[${JSON.stringify(r)}]`;
    const cut = body.indexOf("\\\\") + 1; // between the two backslashes of the escaped one
    const { frames } = feed(body, [cut]);
    expect(frames).toEqual([r]);
    const cut2 = body.indexOf('\\"') + 1; // between backslash and the escaped quote
    expect(feed(body, [cut2]).frames).toEqual([r]);
  });

  it("delivers a response as soon as its closing brace arrives, before the array closes", () => {
    const p = new StreamFrameParser();
    expect(p.push("[")).toEqual([]);
    expect(p.push(JSON.stringify(plain).slice(0, 10))).toEqual([]);
    expect(p.push(JSON.stringify(plain).slice(10))).toEqual([plain]);
    // the array is still open: nothing else should be reported as a frame
    expect(p.push(",\n")).toEqual([]);
  });

  it("accepts pretty-printed responses and leading whitespace", () => {
    const body = `  \n[ ${JSON.stringify(tricky, null, 2)} , ${JSON.stringify(plain, null, 4)} ]`;
    expect(feed(body, [1, 3, 50]).frames).toEqual([tricky, plain]);
  });

  it("passes a mid-stream error element through so the probe can read its reason", () => {
    const err = { error: { code: 403, status: "PERMISSION_DENIED", message: "quota", errors: [{ reason: "quotaExceeded" }] } };
    const { frames } = feed(`[${JSON.stringify(plain)},${JSON.stringify(err)}]`, [5]);
    expect(frames).toEqual([plain, err]);
  });

  it("reports a stream cut off mid-object as pending bytes, not as a frame", () => {
    const body = `[${JSON.stringify(plain)},${JSON.stringify(tricky).slice(0, 40)}`;
    const { frames, parser } = feed(body, [12]);
    expect(frames).toEqual([plain]);
    expect(parser.pending.length).toBeGreaterThan(0);
  });

  it("leaves nothing pending after a complete array", () => {
    const { parser } = feed(`[${JSON.stringify(plain)}]`, [3]);
    expect(["", "]"]).toContain(parser.pending);
  });

  it("handles one byte at a time across several responses", () => {
    const rs = [plain, tricky, plain, { items: [], nextPageToken: "t9", offlineAt: "2026-10-04T13:00:00Z" }];
    const body = `[${rs.map((r) => JSON.stringify(r)).join(",")}]`;
    const cuts = Array.from({ length: body.length }, (_, k) => k);
    expect(feed(body, cuts).frames).toEqual(rs);
  });
});

describe("framing: Server-Sent Events (alt=sse)", () => {
  const r1: StreamResponse = { items: [item("s1", "2026-10-04T12:00:00Z")], nextPageToken: "p1" };
  const r2: StreamResponse = { items: [item("s2", "2026-10-04T12:00:02Z")], nextPageToken: "p2" };

  it("sniffs SSE and yields one response per event (LF)", () => {
    const body = `data: ${JSON.stringify(r1)}\n\ndata: ${JSON.stringify(r2)}\n\n`;
    const { frames, parser } = feed(body, [7, 30]);
    expect(parser.framing).toBe("sse");
    expect(frames).toEqual([r1, r2]);
  });

  it("yields the same with CRLF line endings at every split point", () => {
    const body = `data: ${JSON.stringify(r1)}\r\n\r\ndata: ${JSON.stringify(r2)}\r\n\r\n`;
    for (let i = 0; i <= body.length; i++) {
      expect(feed(body, [i]).frames).toEqual([r1, r2]);
    }
  });

  it("does not treat a CRLF split between chunks inside a multi-line event as an event boundary", () => {
    // One event whose JSON spans two data lines; the chunk boundary falls between \r and \n.
    const json = JSON.stringify(r1);
    const half = json.indexOf(",");
    const body = `data: ${json.slice(0, half + 1)}\r\ndata: ${json.slice(half + 1)}\r\n\r\n`;
    const cut = body.indexOf("\r\n") + 1;
    let frames: unknown[] = [];
    let thrown: unknown = null;
    try {
      frames = feed(body, [cut]).frames;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(frames).toEqual([r1]);
  });

  it("joins multi-line data fields and ignores comments, event names and ids", () => {
    const json = JSON.stringify(r1, null, 2);
    const dataLines = json.split("\n").map((l) => `data: ${l}`).join("\n");
    const body = `: keep-alive\n\nevent: message\nid: 7\n${dataLines}\n\n`;
    expect(feed(body, [3]).frames).toEqual([r1]);
  });

  it("holds an unterminated event as pending", () => {
    const { frames, parser } = feed(`data: ${JSON.stringify(r1)}\n\ndata: {"items":`, [4]);
    expect(frames).toEqual([r1]);
    expect(parser.pending.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Per-message delay and its statistics
// ---------------------------------------------------------------------------

describe("per-message delay: now minus publish time", () => {
  const T = Date.parse("2026-10-04T12:00:00.000Z");

  it("is now − publishedAt in ms", () => {
    expect(messageDelayMs(item("d", "2026-10-04T12:00:00.000Z"), T + 1_250)).toBe(1_250);
  });

  it("reads YouTube's microsecond, offset-carrying timestamps", () => {
    expect(messageDelayMs(item("d", "2026-10-04T12:00:00.500000+00:00"), T + 1_000)).toBe(500);
    expect(messageDelayMs(item("d", "2026-10-04T14:00:00.000+02:00"), T + 2_000)).toBe(2_000);
  });

  it("keeps the sign when the server clock is ahead (a negative delay is information)", () => {
    expect(messageDelayMs(item("d", "2026-10-04T12:00:01.000Z"), T)).toBe(-1_000);
  });

  it("is null without a usable publish time", () => {
    expect(messageDelayMs(item("d"), T)).toBeNull();
    expect(messageDelayMs({ id: "x", snippet: null }, T)).toBeNull();
    expect(messageDelayMs(item("d", "not a date"), T)).toBeNull();
  });
});

describe("delay statistics on known inputs", () => {
  it("percentile: nearest rank on 1..10 and 1..100", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 90)).toBe(9);
    expect(percentile(ten, 100)).toBe(10);
    expect(percentile(ten, 0)).toBe(1);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 90)).toBe(90);
    expect(percentile(hundred, 99)).toBe(99);
  });

  it("percentile of an empty set is 0, of one sample is that sample", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 90)).toBe(42);
  });

  it("summary of a shuffled set: count, p50, p90, max, mean", () => {
    const s = new DelayStats();
    for (const v of [900, 100, 500, 300, 700, 200, 800, 400, 1000, 600]) s.add(v);
    expect(s.summary()).toEqual({ count: 10, p50: 500, p90: 900, max: 1000, mean: 550 });
  });

  it("a long tail moves p90 and max but not p50", () => {
    const s = new DelayStats();
    for (let i = 0; i < 18; i++) s.add(1_000);
    s.add(30_000);
    s.add(85_000);
    const sum = s.summary();
    expect(sum.p50).toBe(1_000);
    expect(sum.p90).toBe(1_000); // rank ceil(0.9·20)=18 → still 1s
    expect(sum.max).toBe(85_000);
  });

  it("updates after more samples arrive (running stats)", () => {
    const s = new DelayStats();
    s.add(10);
    expect(s.summary().max).toBe(10);
    s.add(5);
    s.add(20);
    expect(s.summary()).toMatchObject({ count: 3, p50: 10, max: 20 });
  });

  it("ignores NaN/Infinity and starts empty", () => {
    const s = new DelayStats();
    expect(s.summary()).toEqual({ count: 0, p50: 0, p90: 0, max: 0, mean: 0 });
    s.add(NaN);
    s.add(Infinity);
    s.add(3);
    expect(s.summary().count).toBe(1);
  });

  it("formats the running summary with readable units", () => {
    expect(fmtMs(250)).toBe("250ms");
    expect(fmtMs(1_500)).toBe("1.5s");
    expect(fmtMs(180_000)).toBe("3.0min");
    const line = fmtDelaySummary({ count: 3, p50: 800, p90: 2_400, max: 2_400, mean: 1_000 });
    expect(line).toContain("n=3");
    expect(line).toContain("p50=800ms");
    expect(line).toContain("p90=2.4s");
    expect(line).toContain("max=2.4s");
  });
});

// ---------------------------------------------------------------------------
// Resume and backlog
// ---------------------------------------------------------------------------

describe("resume: a reconnect continues from nextPageToken without double counting", () => {
  it("a fresh connection sends no token; its first response is backlog, later ones are live", () => {
    const r = new ResumeState();
    expect(r.startConnection()).toBeUndefined();
    expect(r.resumed).toBe(false);
    const first = r.accept({ items: [item("1"), item("2")], nextPageToken: "A" });
    expect(first.backlog).toBe(true);
    expect(first.fresh.map((i) => i.id)).toEqual(["1", "2"]);
    const second = r.accept({ items: [item("3")], nextPageToken: "B" });
    expect(second.backlog).toBe(false);
    expect(second.fresh.map((i) => i.id)).toEqual(["3"]);
  });

  it("reconnect sends the last nextPageToken and its first response is not backlog", () => {
    const r = new ResumeState();
    r.startConnection();
    r.accept({ items: [item("1")], nextPageToken: "A" });
    r.accept({ items: [item("2")], nextPageToken: "B" });
    expect(r.startConnection()).toBe("B");
    expect(r.resumed).toBe(true);
    const out = r.accept({ items: [item("3")], nextPageToken: "C" });
    expect(out.backlog).toBe(false);
    expect(out.fresh.map((i) => i.id)).toEqual(["3"]);
  });

  it("skips items the resumed stream repeats, counting them as repeats", () => {
    const r = new ResumeState();
    r.startConnection();
    r.accept({ items: [item("1"), item("2")], nextPageToken: "A" });
    r.accept({ items: [item("3")], nextPageToken: "B" });
    r.startConnection();
    const out = r.accept({ items: [item("2"), item("3"), item("4")], nextPageToken: "C" });
    expect(out.fresh.map((i) => i.id)).toEqual(["4"]);
    expect(out.repeats).toBe(2);
  });

  it("a response without nextPageToken keeps the previous one", () => {
    const r = new ResumeState();
    r.startConnection();
    r.accept({ items: [], nextPageToken: "A" });
    r.accept({ items: [item("9")] });
    r.accept({ items: [], nextPageToken: null });
    expect(r.startConnection()).toBe("A");
  });

  it("a connection that dies before any token reconnects fresh, flags backlog again, and drops repeats", () => {
    const r = new ResumeState();
    r.startConnection();
    r.accept({ items: [item("1")] }); // no token given
    expect(r.startConnection()).toBeUndefined();
    const out = r.accept({ items: [item("1"), item("2")], nextPageToken: "A" });
    expect(out.backlog).toBe(true);
    expect(out.fresh.map((i) => i.id)).toEqual(["2"]);
    expect(out.repeats).toBe(1);
  });

  it("an empty first response on a fresh connection still uses up the backlog flag", () => {
    // The first frame is the backlog even when chat was quiet; the next is live.
    const r = new ResumeState();
    r.startConnection();
    expect(r.accept({ items: [], nextPageToken: "A" }).backlog).toBe(true);
    expect(r.accept({ items: [item("1")], nextPageToken: "B" }).backlog).toBe(false);
  });

  it("items without an id are never treated as repeats", () => {
    const r = new ResumeState();
    r.startConnection();
    const noId: StreamItem = { snippet: { type: "textMessageEvent" } };
    r.accept({ items: [noId] });
    expect(r.accept({ items: [noId, noId] }).fresh).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Stop conditions
// ---------------------------------------------------------------------------

describe("stop conditions: the chat is over", () => {
  it("offlineAt ends the probe", () => {
    expect(chatEnded({ items: [], offlineAt: "2026-10-04T13:00:00Z" })).toBe(true);
  });

  it("a chatEndedEvent item ends the probe, wherever it sits in the batch", () => {
    expect(chatEnded({ items: [item("1"), item("2", undefined, "chatEndedEvent")] })).toBe(true);
  });

  it("ordinary traffic, null offlineAt and no items do not", () => {
    expect(chatEnded({ items: [item("1")], offlineAt: null })).toBe(false);
    expect(chatEnded({})).toBe(false);
    expect(chatEnded({ items: [item("1", undefined, "superChatEvent")] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Connection log and final summary
// ---------------------------------------------------------------------------

describe("connection length and how it resumed", () => {
  const conn = (n: number, lenMs: number, resumed: boolean, endReason: string): ConnectionRecord => ({
    n,
    openedAt: 1_000_000 + n * 10_000_000,
    closedAt: 1_000_000 + n * 10_000_000 + lenMs,
    firstByteMs: 120,
    resumedWithToken: resumed,
    framing: "json-array",
    responses: 4,
    items: 9,
    bytes: 2048,
    endReason,
  });

  it("one connection line says how long it lasted, whether it resumed, and why it ended", () => {
    const line = fmtConnection(conn(2, 95_000, true, "server-closed"));
    expect(line).toContain("#2");
    expect(line).toContain("95.0s");
    expect(line).toMatch(/resumed with pageToken/);
    expect(line).toContain("server-closed");
    const fresh = fmtConnection({ ...conn(1, 500, false, "idle: no bytes"), firstByteMs: null });
    expect(fresh).toMatch(/fresh/);
    expect(fresh).toMatch(/first byte never/);
  });

  it("summary gives count, resumed count, length p50/max and end reasons grouped", () => {
    const s = connectionSummary([
      conn(1, 60_000, false, "server-closed"),
      conn(2, 300_000, true, "server-closed"),
      conn(3, 600_000, true, "error: socket hang up"),
      conn(4, 30_000, true, "error: ECONNRESET"),
      conn(5, 1_000, true, "chat-ended: offlineAt 2026-10-04T13:00:00Z"),
    ]);
    expect(s).toContain("connections: 5 (4 resumed with pageToken)");
    expect(s).toContain("p50=60.0s"); // lengths 1s,30s,60s,300s,600s → p50 = 60s
    expect(s).toContain("max=10.0min");
    expect(s).toContain("server-closed×2");
    expect(s).toContain("error×2");
    expect(s).toContain("chat-ended×1");
  });

  it("no connections at all still summarises", () => {
    expect(connectionSummary([])).toMatch(/none/);
  });
});

// ---------------------------------------------------------------------------
// The probe's pipeline end to end, driven through the helpers only
// ---------------------------------------------------------------------------

describe("pipeline: frames → resume → delays", () => {
  /** Mirrors what the plan asks the probe to do with a connection's body. */
  function runConnection(body: string, cuts: number[], resume: ResumeState, stats: DelayStats, now: number) {
    resume.startConnection();
    const p = new StreamFrameParser();
    let at = 0;
    let backlog = 0;
    let ended = false;
    for (const c of [...cuts, body.length]) {
      for (const f of p.push(body.slice(at, c))) {
        const r = f as StreamResponse;
        if (r.error) continue;
        const out = resume.accept(r);
        if (out.backlog) backlog += out.fresh.length;
        else for (const it of out.fresh) {
          const d = messageDelayMs(it, now);
          if (d != null) stats.add(d);
        }
        if (chatEnded(r)) {
          ended = true;
          break;
        }
      }
      at = c;
      if (ended) break;
    }
    return { backlog, ended };
  }

  it("counts only live messages, once each, across a resume, and stops at offlineAt", () => {
    const T = Date.parse("2026-10-04T12:00:10Z");
    const resume = new ResumeState();
    const stats = new DelayStats();
    const c1 = `[${JSON.stringify({ items: [item("old1", "2026-10-04T11:50:00Z"), item("old2", "2026-10-04T11:55:00Z")], nextPageToken: "A" })},${JSON.stringify({ items: [item("m1", "2026-10-04T12:00:09Z")], nextPageToken: "B" })}]`;
    const one = runConnection(c1, [17, 101], resume, stats, T);
    expect(one).toEqual({ backlog: 2, ended: false });
    const c2 = `data: ${JSON.stringify({ items: [item("m1", "2026-10-04T12:00:09Z"), item("m2", "2026-10-04T12:00:08Z")], nextPageToken: "C" })}\r\n\r\ndata: ${JSON.stringify({ items: [], offlineAt: "2026-10-04T12:00:10Z" })}\r\n\r\ndata: ${JSON.stringify({ items: [item("after", "2026-10-04T12:00:10Z")] })}\r\n\r\n`;
    const two = runConnection(c2, [9, 60], resume, stats, T);
    expect(two.ended).toBe(true);
    expect(two.backlog).toBe(0);
    // m1 (1s) once, m2 (2s); backlog and the post-offline frame not counted
    expect(stats.summary()).toMatchObject({ count: 2, p50: 1_000, max: 2_000 });
  });
});
