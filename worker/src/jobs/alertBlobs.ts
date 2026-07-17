import { fork } from "child_process";
import path from "path";
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

export async function refresh(_job: Job): Promise<AlertBlobRebuildResult> {
  const execArgv = HEAP_MB > 0 ? [...CHILD_EXEC_ARGV, `--max-old-space-size=${HEAP_MB}`] : CHILD_EXEC_ARGV;

  return new Promise<AlertBlobRebuildResult>((resolve, reject) => {
    // silent:false (default) lets the child's per-hazard log lines flow to the
    // worker's console, so the rebuild stays as observable as when it ran inline.
    const child = fork(CHILD, [], { execArgv, env: process.env });

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
