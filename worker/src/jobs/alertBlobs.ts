import { fork } from "child_process";
import os from "os";
import path from "path";
import type { Readable } from "stream";
import type { Job } from "bullmq";
import { log } from "@photonsurge/shared/utill/logger";
import type { AlertBlobRebuildResult } from "../alerts/rebuildBlobs";

const TAG = "job:alert-blobs";

/**
 * Dispatched as type "alertBlobs", event "refresh". Dissolves touching warning
 * areas of the same hazard+severity+country into single cached shapes.
 *
 * The rebuild itself runs in a CHILD PROCESS (alerts/dissolveChild.ts). The clip is
 * heavy synchronous CPU — a single polygon-clipping union on the worst hazard held
 * the event loop long enough that the worker stopped answering `/healthz` and
 * BullMQ dropped the locks on its other jobs. A single union can't be yielded
 * mid-flight, so this handler does nothing but fork the work off the main worker,
 * wait, and relay the result. The child does its own Mongo I/O, so no geometry
 * crosses the process boundary.
 *
 * There is deliberately NO inline fallback: running the dissolve in-process is the
 * exact thing this exists to prevent (never block the main thread). If the child
 * can't run, the job fails and BullMQ retries it.
 */

// Under ts-node (dev) this file is .ts and the child is loaded through ts-node; the
// compiled build runs .js. Same trick as grib/bakePool.
const IS_TS = __filename.endsWith(".ts");
const CHILD = path.join(__dirname, "..", "alerts", IS_TS ? "dissolveChild.ts" : "dissolveChild.js");
const CHILD_EXEC_ARGV = IS_TS ? ["-r", "ts-node/register/transpile-only"] : [];
// A rebuild that hasn't reported back by here is wedged — kill it so the job fails
// cleanly and retries rather than leaking a process.
const TIMEOUT_MS = Number(process.env.ALERT_DISSOLVE_TIMEOUT_MS || 15 * 60_000);
// Optional heap cap for the child — an OOM then kills only the child, not the worker.
const HEAP_MB = Number(process.env.ALERT_DISSOLVE_HEAP_MB || 0);

/**
 * Re-emit a child stream line-by-line through the worker's own console.
 *
 * The point is the /admin/queue live log: the per-job capture (jobLog.ts) taps
 * `console.*` inside the handler's async context, and an INHERITED child stdout
 * bypasses that entirely — the rebuild's per-bucket progress reached the
 * container log but the UI showed one line for a 15-minute job. Forking silent
 * and relaying through console keeps the container log identical AND puts every
 * `dissolved <bucket>` line in the ring, so a stalled rebuild shows WHERE it
 * stalled without ssh. Exported for its unit test only.
 */
export function relayChildLines(stream: Readable | null, write: (line: string) => void): void {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) write(line);
    }
  });
  stream.on("end", () => {
    if (buf.trim()) write(buf);
  });
}

export async function refresh(job: Job): Promise<AlertBlobRebuildResult> {
  const execArgv = HEAP_MB > 0 ? [...CHILD_EXEC_ARGV, `--max-old-space-size=${HEAP_MB}`] : CHILD_EXEC_ARGV;
  // The admin "rebuild everything" button; the 15-minute schedule sends no flag
  // and gets the incremental path (unchanged buckets carried, not re-clipped).
  const force = job?.data?.data?.force === true;

  return new Promise<AlertBlobRebuildResult>((resolve, reject) => {
    // silent:true + relayChildLines, NOT inherited stdio — see the relay's note.
    const child = fork(CHILD, [], {
      execArgv,
      env: force ? { ...process.env, ALERT_DISSOLVE_FORCE: "1" } : process.env,
      silent: true,
    });
    relayChildLines(child.stdout, (line) => console.log(line));
    relayChildLines(child.stderr, (line) => console.error(line));

    // Lowest CPU priority: the dissolve is minutes of pure single-threaded CPU
    // on a 4-core box it shares with bakes, ingest and Mongo. Niced, it soaks up
    // idle cycles instead of competing — it was losing that contest anyway (a
    // starved child once hit the kill-switch mid-rebuild); this way everything
    // else stays fast and the child still finishes when the box quietens.
    try {
      if (child.pid) os.setPriority(child.pid, 19);
    } catch {
      /* not fatal — some environments refuse; the child just runs unniced */
    }

    let result: AlertBlobRebuildResult | null = null;
    let failure: string | null = null;

    const timer = setTimeout(() => {
      failure = `dissolve child timed out after ${TIMEOUT_MS}ms`;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.on("message", (msg: any) => {
      if (msg?.ok === true) result = msg.result as AlertBlobRebuildResult;
      else if (msg?.ok === false) failure = msg.error || "dissolve child reported failure";
    });
    child.on("error", (err) => {
      // Spawn/IPC failure (e.g. the child entry is missing). Reject — never fall
      // back to running the dissolve in this process.
      failure = failure || String(err?.message ?? err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (result && !failure) {
        log(TAG, `dissolve child done`, result);
        resolve(result);
        return;
      }
      const why =
        failure || `dissolve child exited ${code}${signal ? ` (${signal})` : ""} without a result`;
      log(TAG, `dissolve child failed`, { why });
      reject(new Error(why));
    });
  });
}
