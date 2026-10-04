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
 * read when this was written) — see ../youtube/chat-stream.ts.
 *
 * Side effects: none on the run. It reads the run, the account and the worker's
 * quota counter; it writes nothing to Mongo (it bypasses `apiCall`, so it neither
 * meters nor blocks on the worker's quota state) and leaves the run's own
 * liveChatMessages.list poller alone — both run side by side, which is the point:
 * compare the delays here with what the poller delivers. Google bills the probe
 * to the same project, so read the quota graph before and after.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

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
  messageDelayMs,
  ResumeState,
  StreamFrameParser,
  type ConnectionRecord,
  type StreamResponse,
} from "../youtube/chat-stream";

const ENDPOINT = "https://youtube.googleapis.com/youtube/v3/liveChat/messages/stream";
const QUOTA_URL = "https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas";
/** No bytes for this long → treat the connection as dead and reconnect. */
const IDLE_MS = 5 * 60_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const SUMMARY_EVERY_MS = 60_000;

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

const hhmmss = (t = Date.now()) => new Date(t).toISOString().slice(11, 19);

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const db = await getAppDb();
  const run = await db.getRun(args.runId);
  if (!run) throw new Error(`no run ${args.runId}`);
  const yt = run.platforms?.youtube;
  if (!yt?.liveChatId) throw new Error(`run ${args.runId} has no YouTube liveChatId (status ${run.status}) — is it live?`);
  const ctx = await getYoutubeClient(yt.accountId);
  const oauth2 = ctx.oauth2!;
  const accountId = ctx.accountId;

  const startedAt = Date.now();
  const quotaAtStart = await quotaSnapshot(accountId);
  console.log(`\nrun ${run.id} (${run.status})  account ${accountId}  liveChatId ${yt.liveChatId}`);
  console.log(`endpoint ${ENDPOINT}${args.sse ? " (alt=sse)" : ""}`);
  console.log(
    `\nQUOTA: note the project's usage NOW at ${QUOTA_URL}\n` +
      `       (the graph lags a few minutes), leave this running for an hour, then read it again.\n` +
      `       The worker's own metered spend today is ${quotaAtStart.spent} units — subtract its change\n` +
      `       (printed at the end) from the graph's change to get what the stream cost.\n` +
      `       For scale: one liveChatMessages.list poll is metered at ${quotaCost("liveChatMessages.list")} units.\n` +
      `Ctrl-C to stop.\n`,
  );

  const stats = new DelayStats();
  const resume = new ResumeState();
  const conns: ConnectionRecord[] = [];
  let backlogItems = 0;
  let repeatItems = 0;
  let stopping = false;
  let current: AbortController | null = null;
  let stopReason = "stopped";
  // Cuts a backoff sleep short on Ctrl-C.
  let wake: (() => void) | null = null;

  const printSummary = (label: string) => {
    console.log(`\n── ${label} after ${fmtMs(Date.now() - startedAt)} ──`);
    console.log(`delay (live messages): ${fmtDelaySummary(stats.summary())}`);
    console.log(`skipped: ${backlogItems} backlog items on fresh connections, ${repeatItems} repeats after resume`);
    console.log(connectionSummary(conns));
    console.log(`resume token: ${resume.pageToken ? resume.pageToken.slice(0, 24) + "…" : "none yet"}\n`);
  };

  const finish = async () => {
    printSummary("final summary");
    try {
      const q = await quotaSnapshot(accountId);
      console.log(
        `worker-metered spend: ${quotaAtStart.spent} → ${q.spent} units (+${q.spent - quotaAtStart.spent} by the run's poller etc.).`,
      );
    } catch {
      /* the counter is a nicety */
    }
    console.log(`Now read the project's quota graph again: ${QUOTA_URL}\n`);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    if (stopping) process.exit(130); // second Ctrl-C: don't wait
    stopping = true;
    console.log("\n(stopping — Ctrl-C again to quit at once)");
    current?.abort();
    wake?.();
  });

  const summaryTimer = setInterval(() => printSummary("running summary"), SUMMARY_EVERY_MS);
  let backoff = BACKOFF_MIN_MS;
  let forceRefresh = false;

  while (!stopping) {
    const pageToken = resume.startConnection();
    const conn: ConnectionRecord = {
      n: conns.length + 1,
      openedAt: Date.now(),
      closedAt: 0,
      firstByteMs: null,
      resumedWithToken: !!pageToken,
      framing: null,
      responses: 0,
      items: 0,
      bytes: 0,
      endReason: "server-closed",
    };
    const ac = new AbortController();
    current = ac;
    let idleTimer: NodeJS.Timeout | undefined;
    let idled = false;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idled = true;
        ac.abort();
      }, IDLE_MS);
    };
    let ended = false;
    let healthy = false;

    try {
      if (forceRefresh) {
        // Drop the cached access token so the next call mints a new one from the refresh token.
        oauth2.setCredentials({ refresh_token: oauth2.credentials.refresh_token });
        forceRefresh = false;
      }
      const { token } = await oauth2.getAccessToken();
      if (!token) throw new Error("no access token minted");

      const url = new URL(ENDPOINT);
      url.searchParams.set("liveChatId", yt.liveChatId);
      url.searchParams.set("part", "id,snippet,authorDetails");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      if (args.sse) url.searchParams.set("alt", "sse");

      console.log(
        `[${hhmmss()}] opening connection #${conn.n} ${pageToken ? `resuming from pageToken ${pageToken.slice(0, 24)}…` : "fresh (no pageToken)"}`,
      );
      armIdle();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: args.sse ? "text/event-stream" : "application/json" },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.text().catch(() => "")).slice(0, 600);
        conn.endReason = `http ${res.status} ${body.replace(/\s+/g, " ")}`;
        if (res.status === 401) forceRefresh = true;
        if (/quotaExceeded|dailyLimitExceeded/.test(body)) {
          stopReason = "quota exhausted";
          stopping = true;
        } else if (/liveChatEnded|liveChatNotFound|liveChatDisabled/.test(body)) {
          stopReason = "chat over";
          stopping = true;
        }
      } else {
        console.log(`[${hhmmss()}]   HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
        const parser = new StreamFrameParser();
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armIdle();
          if (conn.firstByteMs == null) conn.firstByteMs = Date.now() - conn.openedAt;
          conn.bytes += value.byteLength;
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            conn.framing = parser.framing;
            const r = frame as StreamResponse;
            if (r.error) {
              conn.endReason = `error: ${r.error.code ?? ""} ${r.error.status ?? ""} ${r.error.message ?? ""}`.trim();
              const reason = r.error.errors?.[0]?.reason ?? "";
              if (/quotaExceeded|dailyLimitExceeded/.test(reason)) {
                stopReason = "quota exhausted";
                stopping = true;
              }
              continue;
            }
            conn.responses++;
            healthy = true;
            const now = Date.now();
            const { fresh, repeats, backlog } = resume.accept(r);
            repeatItems += repeats;
            conn.items += fresh.length;
            if (backlog) {
              backlogItems += fresh.length;
              console.log(`[${hhmmss(now)}]   backlog: ${fresh.length} recent messages (not counted)`);
            } else {
              for (const it of fresh) {
                const d = messageDelayMs(it, now);
                if (d != null) stats.add(d);
                const who = it.authorDetails?.displayName ?? "?";
                const text = (it.snippet?.displayMessage ?? `<${it.snippet?.type ?? "event"}>`).slice(0, 60);
                console.log(
                  `[${hhmmss(now)}]   +${d == null ? "?" : fmtMs(d)}  ${who}: ${text}   | ${fmtDelaySummary(stats.summary())}`,
                );
              }
            }
            if (chatEnded(r)) {
              ended = true;
              conn.endReason = r.offlineAt ? `chat-ended: offlineAt ${r.offlineAt}` : "chat-ended: chatEndedEvent";
            }
          }
          if (ended) break;
        }
        const left = parser.pending;
        if (left && left !== "]") console.log(`[${hhmmss()}]   (stream closed with ${left.length} unparsed bytes: ${left.slice(0, 80)})`);
        if (!conn.framing) conn.framing = parser.framing;
        if (ended) {
          stopReason = "chat over";
          stopping = true;
          ac.abort();
        }
      }
    } catch (err) {
      if (idled) conn.endReason = `idle: no bytes for ${fmtMs(IDLE_MS)}`;
      else if (stopping && ac.signal.aborted) conn.endReason = conn.endReason === "server-closed" ? "stopped" : conn.endReason;
      else conn.endReason = `error: ${String((err as Error)?.message ?? err)}`;
    } finally {
      clearTimeout(idleTimer);
      current = null;
    }
    conn.closedAt = Date.now();
    conns.push(conn);
    console.log(`[${hhmmss()}] ${fmtConnection(conn)}`);

    if (stopping) break;
    // A connection that delivered something reconnects at once; failures back off.
    if (healthy) backoff = BACKOFF_MIN_MS;
    const wait = healthy ? 0 : backoff;
    if (!healthy) backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
    console.log(
      `[${hhmmss()}] reconnecting ${wait ? `in ${fmtMs(wait)}` : "now"} ${resume.pageToken ? "with nextPageToken" : "without a token"}`,
    );
    if (wait) {
      await new Promise<void>((r) => {
        const t = setTimeout(r, wait);
        wake = () => (clearTimeout(t), r());
      });
      wake = null;
    }
  }

  clearInterval(summaryTimer);
  console.log(`\nstopped: ${stopReason}`);
  await finish();
})().catch((err) => {
  console.error(String((err as Error)?.stack ?? err));
  process.exit(1);
});
