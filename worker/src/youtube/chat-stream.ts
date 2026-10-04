/**
 * Pure helpers for the `liveChatMessages.streamList` probe
 * (scripts/chatStreamProbe.ts, docs/crossword-mode-plan.md §6.2). No network, no
 * Mongo — the script owns both.
 *
 * Transport, as far as it could be checked from here: the Streaming Live Chat
 * guide describes a gRPC server-streaming RPC (`V3DataLiveChatMessageService.
 * StreamList` on youtube.googleapis.com:443), and the YouTube discovery document
 * (the one googleapis is generated from) also exposes it over REST as
 *   GET https://youtube.googleapis.com/youtube/v3/liveChat/messages/stream
 *       ?liveChatId=…&part=id,snippet,authorDetails[&pageToken=…]
 * with OAuth scope youtube / youtube.force-ssl / youtube.readonly. Google's REST
 * gateway serves a server-streaming method as one long HTTP response whose body
 * is a JSON array written one `LiveChatMessageListResponse` at a time, or, with
 * `alt=sse`, as Server-Sent Events (`data: {…}` per response). The guide page
 * itself was not reachable from the build sandbox, so the framing is UNVERIFIED:
 * the parser below accepts both, and the probe prints which one it saw.
 */

/** The parts of a streamed `LiveChatMessageListResponse` the probe reads. */
export interface StreamResponse {
  items?: StreamItem[];
  nextPageToken?: string | null;
  offlineAt?: string | null;
  pollingIntervalMillis?: number | null;
  /** A REST gateway reports a mid-stream failure as one more array element. */
  error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[] };
}

export interface StreamItem {
  id?: string | null;
  snippet?: {
    type?: string | null;
    publishedAt?: string | null;
    displayMessage?: string | null;
  } | null;
  authorDetails?: { displayName?: string | null; channelId?: string | null } | null;
}

export type StreamFraming = "json-array" | "sse";

/**
 * Incremental parser for a streamed body: feed it text chunks as they arrive
 * (split anywhere — mid-object, mid-string, mid-escape) and it returns every
 * complete top-level JSON object so far. The framing is sniffed from the first
 * non-blank character: `[` or `{` is a JSON array (or bare objects), anything
 * else is SSE.
 */
export class StreamFrameParser {
  framing: StreamFraming | null = null;
  private buf = "";
  // json-array scanner state, carried across chunks
  private depth = 0;
  private inString = false;
  private escaped = false;
  private objStart = -1;
  private scanPos = 0;

  push(chunk: string): unknown[] {
    this.buf += chunk;
    if (!this.framing) {
      const first = this.buf.match(/\S/);
      if (!first) return [];
      this.framing = first[0] === "[" || first[0] === "{" ? "json-array" : "sse";
    }
    return this.framing === "sse" ? this.drainSse() : this.drainJson();
  }

  /** Bytes held back waiting for the rest of an object (non-blank → a cut-off frame). */
  get pending(): string {
    return this.buf.trim();
  }

  private drainJson(): unknown[] {
    const out: unknown[] = [];
    const s = this.buf;
    let i = this.scanPos;
    for (; i < s.length; i++) {
      const c = s[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') {
        // A string outside any object is not part of this framing; skip it the same way.
        this.inString = true;
      } else if (c === "{") {
        if (this.depth === 0) this.objStart = i;
        this.depth++;
      } else if (c === "}") {
        if (this.depth === 0) continue;
        this.depth--;
        if (this.depth === 0) {
          out.push(JSON.parse(s.slice(this.objStart, i + 1)));
          this.objStart = -1;
        }
      }
    }
    // Keep only the unfinished object (or nothing) so the buffer stays small.
    if (this.depth > 0 && this.objStart >= 0) {
      this.buf = s.slice(this.objStart);
      this.scanPos = i - this.objStart;
      this.objStart = 0;
    } else {
      this.buf = "";
      this.scanPos = 0;
    }
    return out;
  }

  private drainSse(): unknown[] {
    const out: unknown[] = [];
    // A trailing "\r" may be the first half of a CRLF split across chunks: hold it
    // back until the next chunk says whether a "\n" follows, or a lone "\r" and
    // the "\n" opening the next chunk would read as a blank line (an event boundary).
    const held = this.buf.endsWith("\r") ? "\r" : "";
    const norm = (held ? this.buf.slice(0, -1) : this.buf).replace(/\r\n?/g, "\n");
    const events = norm.split("\n\n");
    this.buf = (events.pop() ?? "") + held;
    for (const ev of events) {
      const data = ev
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data.trim()) out.push(JSON.parse(data));
    }
    return out;
  }
}

// ---- Delay statistics ----

export interface DelaySummary {
  count: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile of an ascending array (0 for an empty one). */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Running delay samples (ms). Keeps every sample — an hour of chat is a few thousand numbers. */
export class DelayStats {
  private samples: number[] = [];
  private sorted: number[] | null = [];

  add(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.samples.push(ms);
    this.sorted = null;
  }

  summary(): DelaySummary {
    if (!this.sorted) this.sorted = [...this.samples].sort((a, b) => a - b);
    const s = this.sorted;
    const sum = s.reduce((a, b) => a + b, 0);
    return {
      count: s.length,
      p50: percentile(s, 50),
      p90: percentile(s, 90),
      max: s.length ? s[s.length - 1] : 0,
      mean: s.length ? sum / s.length : 0,
    };
  }
}

/** now − publishedAt in ms, or null when the item carries no usable time. */
export function messageDelayMs(item: StreamItem, now: number): number | null {
  const at = item.snippet?.publishedAt;
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? now - t : null;
}

// ---- Resume handling ----

/**
 * What a reconnect resumes from. A fresh connection (no page token) starts with
 * a backlog of recent chat, whose delays say nothing about push latency — those
 * items are flagged so the stats skip them. A reconnect resumes from the last
 * `nextPageToken`; items it repeats are dropped by id.
 */
export class ResumeState {
  pageToken: string | undefined;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private connResponses = 0;
  private connResumed = false;

  constructor(private readonly seenCap = 5_000) {}

  /** Call when a connection opens; returns the token it should send (if any). */
  startConnection(): string | undefined {
    this.connResponses = 0;
    this.connResumed = !!this.pageToken;
    return this.pageToken;
  }

  /** Whether the current connection was opened with a page token. */
  get resumed(): boolean {
    return this.connResumed;
  }

  /**
   * Take one streamed response: advance the token and return its items split
   * into new ones and repeats, with `backlog` set for the first response of a
   * token-less connection.
   */
  accept(res: StreamResponse): { fresh: StreamItem[]; repeats: number; backlog: boolean } {
    const backlog = this.connResponses === 0 && !this.connResumed;
    this.connResponses++;
    if (res.nextPageToken) this.pageToken = res.nextPageToken;
    const fresh: StreamItem[] = [];
    let repeats = 0;
    for (const it of res.items ?? []) {
      const id = it.id ?? "";
      if (id && this.seen.has(id)) {
        repeats++;
        continue;
      }
      if (id) this.remember(id);
      fresh.push(it);
    }
    return { fresh, repeats, backlog };
  }

  private remember(id: string): void {
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > this.seenCap) this.seen.delete(this.seenOrder.shift()!);
  }
}

/**
 * Whether a failure means the project's quota (or rate limit) is spent, so the
 * probe should stop rather than hammer. Reads every form Google uses: HTTP 429,
 * a 403 with reason quotaExceeded / dailyLimitExceeded / rateLimitExceeded /
 * userRateLimitExceeded (in `errors[]` or anywhere in a raw body), and the gRPC
 * status RESOURCE_EXHAUSTED a streamed error element carries.
 */
export function isQuotaFailure(f: { httpStatus?: number; error?: StreamResponse["error"]; body?: string }): boolean {
  const reasons = /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/;
  if (f.httpStatus === 429) return true;
  const e = f.error;
  if (e) {
    if (e.code === 429 || e.status === "RESOURCE_EXHAUSTED") return true;
    if ((e.errors ?? []).some((x) => reasons.test(x.reason ?? ""))) return true;
  }
  return !!f.body && reasons.test(f.body);
}

/** True when a response says the chat is over (stream offline or a chatEndedEvent). */
export function chatEnded(res: StreamResponse): boolean {
  if (res.offlineAt) return true;
  return (res.items ?? []).some((it) => it.snippet?.type === "chatEndedEvent");
}

// ---- Connection log ----

export interface ConnectionRecord {
  n: number;
  openedAt: number;
  closedAt: number;
  /** Time from request to the first body byte (null if none came). */
  firstByteMs: number | null;
  resumedWithToken: boolean;
  framing: StreamFraming | null;
  responses: number;
  items: number;
  bytes: number;
  /** "server-closed", "idle", "error: …", "http 403 …", "chat-ended", "stopped". */
  endReason: string;
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (Math.abs(ms) < 1_000) return `${Math.round(ms)}ms`;
  if (Math.abs(ms) < 120_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function fmtDelaySummary(s: DelaySummary): string {
  return `n=${s.count} p50=${fmtMs(s.p50)} p90=${fmtMs(s.p90)} max=${fmtMs(s.max)}`;
}

export function fmtConnection(c: ConnectionRecord): string {
  return (
    `connection #${c.n}: lasted ${fmtMs(c.closedAt - c.openedAt)}` +
    `, first byte ${c.firstByteMs == null ? "never" : fmtMs(c.firstByteMs)}` +
    `, ${c.resumedWithToken ? "resumed with pageToken" : "fresh (no pageToken)"}` +
    `, framing ${c.framing ?? "?"}, ${c.responses} responses, ${c.items} items, ${c.bytes} bytes` +
    ` — ended: ${c.endReason}`
  );
}

/** Connection-length summary across the run of the probe. */
export function connectionSummary(conns: ConnectionRecord[]): string {
  if (!conns.length) return "connections: none";
  const lens = conns.map((c) => c.closedAt - c.openedAt).sort((a, b) => a - b);
  const reasons = new Map<string, number>();
  for (const c of conns) {
    const key = c.endReason.split(":")[0];
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const resumed = conns.filter((c) => c.resumedWithToken).length;
  return (
    `connections: ${conns.length} (${resumed} resumed with pageToken)` +
    `, length p50=${fmtMs(percentile(lens, 50))} max=${fmtMs(lens[lens.length - 1])}` +
    `, ended: ${[...reasons].map(([k, v]) => `${k}×${v}`).join(", ")}`
  );
}
