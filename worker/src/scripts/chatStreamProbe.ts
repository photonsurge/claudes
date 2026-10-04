/**
 * Probe: does YouTube's push chat (`liveChatMessages.streamList`) beat polling,
 * and what does it cost? (docs/crossword-mode-plan.md §6.2, WP9.)
 *
 *   yarn youtube:chat-stream <runId>           (JSON-array framing, the REST default)
 *   yarn youtube:chat-stream <runId> --sse     (ask for Server-Sent Events instead)
 *
 * Opens the stream on the run's live chat with the run's YouTube account and
 * prints, per message, its delay (now − publishedAt) with a running p50/p90/max;
 * per connection, how long it lasted, how it ended and whether the reconnect
 * resumed from `nextPageToken`. Ctrl-C prints the final summary and exits.
 *
 * Endpoint: GET https://youtube.googleapis.com/youtube/v3/liveChat/messages/stream
 * over plain fetch (HTTP/1.1), the REST form of the gRPC StreamList RPC as the
 * discovery document lists it. The framing is UNVERIFIED (the guide could not be
 * read when this was written) — see ../youtube/chat-stream.ts. If Google does not
 * serve it over REST (404/405/501), the probe stops and says so; the fallback is
 * the gRPC endpoint (@grpc/grpc-js + the guide's proto), not built here.
 *
 * Side effects: none on the run. It reads the run, the account and the worker's
 * quota counter; it writes nothing to Mongo (it bypasses `apiCall`, so it neither
 * meters nor blocks on the worker's quota state) and leaves the run's own
 * liveChatMessages.list poller alone — both run side by side, which is the point:
 * compare the delays here with what the poller delivers. Google bills the probe
 * to the same project, so read the quota graph before and after.
 *
 * `runProbe` is the loop with its dependencies injected (fetch, token, clock,
 * sleep, log, stop signal); the bottom of the file wires the real ones.
 */
import { loadWorkerEnv } from "../loadEnv";
if (require.main === module) loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { getYoutubeClient } from "../youtube/client";
import { quotaCost, quotaSnapshot } from "../youtube/quota";
import {
  chatEnded,
  connectionSummary,
  DelayStats,
  fmtConnection,
  fmtDelaySummary,
  fmtMs,
  isQuotaFailure,
  messageDelayMs,
  ResumeState,
  StreamFrameParser,
  type ConnectionRecord,
  type StreamResponse,
} from "../youtube/chat-stream";

export const STREAM_ENDPOINT = "https://youtube.googleapis.com/youtube/v3/liveChat/messages/stream";
const QUOTA_URL = "https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas";
/** No bytes for this long → treat the connection as dead and reconnect. */
export const IDLE_MS = 5 * 60_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
const SUMMARY_EVERY_MS = 60_000;
/** Statuses meaning the REST form is not served at all — retrying will not help. */
const NOT_SERVED = new Set([404, 405, 501]);

export interface ProbeOptions {
  liveChatId: string;
  sse?: boolean;
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  /** An access token; `force` asks for a freshly minted one (after a 401). */
  getToken: (force: boolean) => Promise<string>;
  now?: () => number;
  /** Backoff sleep; must resolve early when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
  /** Abort to stop (Ctrl-C): the open connection is cut and the final summary printed. */
  signal?: AbortSignal;
  idleMs?: number;
  summaryEveryMs?: number;
}

export interface ProbeResult {
  stopReason: string;
  conns: ConnectionRecord[];
  stats: DelayStats;
  backlogItems: number;
  repeatItems: number;
  pageToken?: string;
}

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

const errMsg = (err: unknown) => String((err as Error)?.message ?? err);

export async function runProbe(opts: ProbeOptions): Promise<ProbeResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const log = opts.log ?? ((l: string) => console.log(l));
  const idleMs = opts.idleMs ?? IDLE_MS;
  const outer = opts.signal ?? new AbortController().signal;
  const hhmmss = (t = now()) => new Date(t).toISOString().slice(11, 19);

  const startedAt = now();
  const stats = new DelayStats();
  const resume = new ResumeState();
  const conns: ConnectionRecord[] = [];
  let backlogItems = 0;
  let repeatItems = 0;
  let stopReason: string | null = null;
  const stop = (reason: string) => {
    stopReason ??= reason;
  };

  const printSummary = (label: string) => {
    log(`\n── ${label} after ${fmtMs(now() - startedAt)} ──`);
    log(`delay (live messages): ${fmtDelaySummary(stats.summary())}`);
    log(`skipped: ${backlogItems} backlog items on fresh connections, ${repeatItems} repeats after resume`);
    log(connectionSummary(conns));
    log(`resume token: ${resume.pageToken ? resume.pageToken.slice(0, 24) + "…" : "none yet"}\n`);
  };
  const summaryTimer = setInterval(() => printSummary("running summary"), opts.summaryEveryMs ?? SUMMARY_EVERY_MS);

  let backoff = BACKOFF_MIN_MS;
  let forceToken = false;

  while (!stopReason && !outer.aborted) {
    const pageToken = resume.startConnection();
    const conn: ConnectionRecord = {
      n: conns.length + 1,
      openedAt: now(),
      closedAt: 0,
      firstByteMs: null,
      resumedWithToken: !!pageToken,
      framing: null,
      responses: 0,
      items: 0,
      bytes: 0,
      endReason: "server-closed",
    };
    // One controller per connection, cut by the outer stop signal or the watchdog.
    const ac = new AbortController();
    const onOuter = () => ac.abort();
    outer.addEventListener("abort", onOuter);
    let idleTimer: NodeJS.Timeout | undefined;
    let idled = false;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idled = true;
        ac.abort();
      }, idleMs);
    };
    // Reads race the abort, so a cut lands even when the body stream ignores the signal.
    const aborted = new Promise<never>((_, reject) => {
      if (ac.signal.aborted) reject(new Error("aborted"));
      ac.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    aborted.catch(() => {});
    let healthy = false;

    try {
      const token = await opts.getToken(forceToken);
      forceToken = false;

      const url = new URL(STREAM_ENDPOINT);
      url.searchParams.set("liveChatId", opts.liveChatId);
      url.searchParams.set("part", "id,snippet,authorDetails");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      if (opts.sse) url.searchParams.set("alt", "sse");

      log(`[${hhmmss()}] opening connection #${conn.n} ${pageToken ? `resuming from pageToken ${pageToken.slice(0, 24)}…` : "fresh (no pageToken)"}`);
      armIdle();
      const res = await Promise.race([
        opts.fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}`, Accept: opts.sse ? "text/event-stream" : "application/json" },
          signal: ac.signal,
        }),
        aborted,
      ]);
      if (!res.ok || !res.body) {
        const body = (await Promise.race([res.text().catch(() => ""), aborted])).slice(0, 600);
        conn.endReason = `http ${res.status} ${body.replace(/\s+/g, " ")}`.trim();
        if (res.status === 401) forceToken = true;
        if (isQuotaFailure({ httpStatus: res.status, body })) stop(`quota exhausted (http ${res.status})`);
        else if (/liveChatEnded|liveChatNotFound|liveChatDisabled/.test(body)) stop("chat over");
        else if (NOT_SERVED.has(res.status)) {
          stop(
            `http ${res.status}: the REST stream endpoint is not served for this request — ` +
              `the fallback is gRPC (V3DataLiveChatMessageService.StreamList on youtube.googleapis.com:443 with @grpc/grpc-js and the guide's proto)`,
          );
        }
      } else {
        log(`[${hhmmss()}]   HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
        const parser = new StreamFrameParser();
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        ac.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));
        let ended = false;
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          armIdle();
          if (conn.firstByteMs == null) conn.firstByteMs = now() - conn.openedAt;
          conn.bytes += value.byteLength;
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            conn.framing = parser.framing;
            const r = frame as StreamResponse;
            if (r.error) {
              conn.endReason = `error: ${r.error.code ?? ""} ${r.error.status ?? ""} ${r.error.message ?? ""}`.replace(/\s+/g, " ").trim();
              if (isQuotaFailure({ error: r.error })) stop(`quota exhausted (${r.error.status ?? r.error.code ?? "stream error"})`);
              continue;
            }
            conn.responses++;
            healthy = true;
            const t = now();
            const { fresh, repeats, backlog } = resume.accept(r);
            repeatItems += repeats;
            conn.items += fresh.length;
            if (backlog) {
              backlogItems += fresh.length;
              log(`[${hhmmss(t)}]   backlog: ${fresh.length} recent messages (not counted)`);
            } else {
              for (const it of fresh) {
                const d = messageDelayMs(it, t);
                if (d != null) stats.add(d);
                const who = it.authorDetails?.displayName ?? "?";
                const text = (it.snippet?.displayMessage ?? `<${it.snippet?.type ?? "event"}>`).slice(0, 60);
                log(`[${hhmmss(t)}]   +${d == null ? "?" : fmtMs(d)}  ${who}: ${text}   | ${fmtDelaySummary(stats.summary())}`);
              }
            }
            if (chatEnded(r)) {
              ended = true;
              conn.endReason = r.offlineAt ? `chat-ended: offlineAt ${r.offlineAt}` : "chat-ended: chatEndedEvent";
            }
          }
          if (ended || stopReason) break;
        }
        const left = parser.pending;
        if (left && left !== "]") log(`[${hhmmss()}]   (stream closed with ${left.length} unparsed bytes: ${left.slice(0, 80)})`);
        conn.framing ??= parser.framing;
        if (ended) stop("chat over");
        ac.abort(); // release the body
      }
    } catch (err) {
      if (idled) conn.endReason = `idle: no bytes for ${fmtMs(idleMs)}`;
      else if (outer.aborted) conn.endReason = "stopped";
      else conn.endReason = `error: ${errMsg(err)}`;
    } finally {
      clearTimeout(idleTimer);
      outer.removeEventListener("abort", onOuter);
    }
    conn.closedAt = now();
    conns.push(conn);
    log(`[${hhmmss()}] ${fmtConnection(conn)}`);

    if (stopReason || outer.aborted) break;
    // A connection that delivered something reconnects at once; failures back off.
    const wait = healthy ? 0 : backoff;
    backoff = healthy ? BACKOFF_MIN_MS : Math.min(BACKOFF_MAX_MS, backoff * 2);
    log(`[${hhmmss()}] reconnecting ${wait ? `in ${fmtMs(wait)}` : "now"} ${resume.pageToken ? "with nextPageToken" : "without a token"}`);
    if (wait) await sleep(wait, outer);
  }

  clearInterval(summaryTimer);
  const reason = stopReason ?? "stopped";
  log(`\nstopped: ${reason}`);
  printSummary("final summary");
  return { stopReason: reason, conns, stats, backlogItems, repeatItems, pageToken: resume.pageToken };
}

// ---- CLI ----

function parseArgs(argv: string[]): { runId: string; sse: boolean } {
  let runId: string | undefined;
  let sse = false;
  for (const a of argv) {
    if (a === "--sse") sse = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else if (!runId) runId = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!runId) throw new Error("usage: yarn youtube:chat-stream <runId> [--sse]");
  return { runId, sse };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = await getAppDb();
  const run = await db.getRun(args.runId);
  if (!run) throw new Error(`no run ${args.runId}`);
  const yt = run.platforms?.youtube;
  if (!yt?.liveChatId) throw new Error(`run ${args.runId} has no YouTube liveChatId (status ${run.status}) — is it live?`);
  const ctx = await getYoutubeClient(yt.accountId);
  const oauth2 = ctx.oauth2!;
  const accountId = ctx.accountId;

  const quotaAtStart = await quotaSnapshot(accountId);
  console.log(`\nrun ${run.id} (${run.status})  account ${accountId}  liveChatId ${yt.liveChatId}`);
  console.log(`endpoint ${STREAM_ENDPOINT}${args.sse ? " (alt=sse)" : ""}`);
  console.log(
    `\nQUOTA: note the project's usage NOW at ${QUOTA_URL}\n` +
      `       (the graph lags a few minutes), leave this running for an hour, then read it again.\n` +
      `       The worker's own metered spend today is ${quotaAtStart.spent} units — subtract its change\n` +
      `       (printed at the end) from the graph's change to get what the stream cost.\n` +
      `       For scale: one liveChatMessages.list poll is metered at ${quotaCost("liveChatMessages.list")} units.\n` +
      `Ctrl-C to stop.\n`,
  );

  const ctrl = new AbortController();
  process.on("SIGINT", () => {
    if (ctrl.signal.aborted) process.exit(130); // second Ctrl-C: don't wait
    console.log("\n(stopping — Ctrl-C again to quit at once)");
    ctrl.abort();
  });

  await runProbe({
    liveChatId: yt.liveChatId,
    sse: args.sse,
    fetch: (url, init) => fetch(url, init),
    getToken: async (force) => {
      // Dropping the cached access token makes the next call mint a new one from the refresh token.
      if (force) oauth2.setCredentials({ refresh_token: oauth2.credentials.refresh_token });
      const { token } = await oauth2.getAccessToken();
      if (!token) throw new Error("no access token minted");
      return token;
    },
    signal: ctrl.signal,
  });

  try {
    const q = await quotaSnapshot(accountId);
    console.log(`worker-metered spend: ${quotaAtStart.spent} → ${q.spent} units (+${q.spent - quotaAtStart.spent} by the run's poller etc.).`);
  } catch {
    /* the counter is a nicety */
  }
  console.log(`Now read the project's quota graph again: ${QUOTA_URL}\n`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(String((err as Error)?.stack ?? err));
      process.exit(1);
    });
}
