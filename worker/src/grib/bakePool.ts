// grib/bakePool.ts
//
// The worker-thread pool grib/bakeWorker.ts was written for and never got. It
// runs the CPU-bound texture bake (unit-convert, longitude roll, nodata mask,
// RGBA pack, sharp PNG) OFF the main event loop, so a global-grid bake no longer
// starves BullMQ's lock-renewal timer — the second of the two synchronous CPU
// paths behind the "could not renew lock" fan-out (the first, the alert dissolve
// union, is deliberately NOT offloaded — its 240MB input would have to be copied
// across the thread boundary and that trades a lock miss for an OOM).
//
// Drop-in: `bakeScalar`/`bakeVector` here have the SAME signatures as the inline
// ones, so a call site only changes its import path. Every result is identical to
// the inline bake — this moves WHERE the CPU runs, not WHAT it computes.
//
// Fail-safe: if the pool can't start (worker file missing, ts-node hiccup) or a
// worker dies mid-task, that task falls back to an INLINE bake. The pool is a
// performance change that can never produce a wrong or missing texture, and never
// does worse than the pre-pool behaviour.

import { Worker } from "worker_threads";
import os from "os";
import path from "path";
import { bakeScalar as bakeScalarInline, type BakeScalarArgs } from "./bakeScalar";
import { bakeVector as bakeVectorInline, type BakeVectorArgs } from "./bakeVector";
import type { BakeResult } from "./bake";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "grib:bake-pool";

/** Leave the loop + a core or two headroom; the pool is for the heavy bakes. */
const POOL_SIZE = Math.max(
  1,
  Number(process.env.BAKE_POOL_SIZE) || Math.min(4, Math.max(1, (os.cpus().length || 4) - 2)),
);

/** Escape hatch: BAKE_POOL=off bakes inline everywhere (the pre-pool behaviour). */
const DISABLED = process.env.BAKE_POOL === "off";

/** Under ts-node (dev) this file is .ts; the compiled build runs .js. */
const IS_TS = __filename.endsWith(".ts");
const workerFile = path.join(__dirname, IS_TS ? "bakeWorker.ts" : "bakeWorker.js");
// Dev loads the .ts worker through ts-node; the build loads the emitted .js as-is.
const workerExecArgv = IS_TS ? ["-r", "ts-node/register/transpile-only"] : [];

interface Pending {
  resolve: (r: BakeResult) => void;
  reject: (e: Error) => void;
  /** The inline bake for THIS task — used if its worker dies before answering. */
  fallback: () => Promise<BakeResult>;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

interface Task {
  kind: "scalar" | "vector";
  args: BakeScalarArgs | BakeVectorArgs;
  pending: Pending;
}

let slots: Slot[] | null = null;
let poolBroken = false;
let shuttingDown = false;
let nextId = 1;
const inFlight = new Map<number, { slot: Slot; pending: Pending }>();
const queue: Task[] = [];

/** Where bakes actually ran. `worker` proves the offload; `inline` is the fallback. */
const stats = { worker: 0, inline: 0 };
export const bakePoolStats = () => ({ ...stats });

function spawn(): Slot {
  const worker = new Worker(workerFile, { execArgv: workerExecArgv });
  const slot: Slot = { worker, busy: false };

  worker.on("message", (msg: { id: number; ok: boolean; result?: BakeResult; error?: string }) => {
    const entry = inFlight.get(msg.id);
    if (!entry) return;
    inFlight.delete(msg.id);
    slot.busy = false;
    if (msg.ok && msg.result) {
      stats.worker++;
      entry.pending.resolve(msg.result);
    } else entry.pending.reject(new Error(msg.error || "bake worker error"));
    pump();
  });

  // A worker that errors or exits takes its in-flight task down with it. Re-run
  // that ONE task inline so nothing is lost, mark the pool broken so subsequent
  // bakes go straight inline, and don't respawn — a repeatedly crashing worker
  // must not become a spawn loop. A terminate() during shutdown is not a crash
  // (a terminated worker always exits 1), so ignore exits once we're tearing down.
  const die = (why: string) => (err?: Error) => {
    if (shuttingDown) return;
    for (const [id, entry] of [...inFlight]) {
      if (entry.slot !== slot) continue;
      inFlight.delete(id);
      entry.pending.fallback().then(entry.pending.resolve, entry.pending.reject);
    }
    if (!poolBroken) {
      poolBroken = true;
      log(TAG, `bake worker ${why} — falling back to inline bakes`, {
        error: err ? String(err?.message ?? err) : undefined,
      });
      drainQueueInline();
    }
  };
  worker.on("error", die("errored"));
  worker.on("exit", (code) => {
    if (code !== 0) die("exited")(new Error(`exit ${code}`));
  });

  return slot;
}

/** Everything still queued when the pool breaks is run inline, in order. */
function drainQueueInline() {
  while (queue.length) {
    const t = queue.shift()!;
    t.pending.fallback().then(t.pending.resolve, t.pending.reject);
  }
}

function ensurePool(): Slot[] | null {
  if (DISABLED || poolBroken) return null;
  if (slots) return slots;
  try {
    slots = Array.from({ length: POOL_SIZE }, spawn);
    log(TAG, `bake pool started`, { size: POOL_SIZE, worker: path.basename(workerFile) });
    return slots;
  } catch (err) {
    poolBroken = true;
    log(TAG, `bake pool failed to start — inline bakes`, { error: String((err as Error)?.message ?? err) });
    return null;
  }
}

/** Hand queued tasks to idle workers. */
function pump() {
  if (!slots) return;
  for (const slot of slots) {
    if (slot.busy || !queue.length) continue;
    const task = queue.shift()!;
    const id = nextId++;
    slot.busy = true;
    inFlight.set(id, { slot, pending: task.pending });
    slot.worker.postMessage({ id, kind: task.kind, args: task.args });
  }
}

function run(
  kind: "scalar" | "vector",
  args: BakeScalarArgs | BakeVectorArgs,
  fallback: () => Promise<BakeResult>,
): Promise<BakeResult> {
  const pool = ensurePool();
  if (!pool) {
    stats.inline++;
    return fallback();
  }
  const counted = () => {
    stats.inline++;
    return fallback();
  };
  return new Promise<BakeResult>((resolve, reject) => {
    queue.push({ kind, args, pending: { resolve, reject, fallback: counted } });
    pump();
  });
}

/** Bake a scalar texture off the main loop. Identical result to the inline bake. */
export function bakeScalar(args: BakeScalarArgs): Promise<BakeResult> {
  return run("scalar", args, () => bakeScalarInline(args));
}

/** Bake a vector (wind/current) texture off the main loop. Identical result. */
export function bakeVector(args: BakeVectorArgs): Promise<BakeResult> {
  return run("vector", args, () => bakeVectorInline(args));
}

/** Tear the pool down (tests, shutdown). Safe to call when it never started. */
export async function shutdownBakePool(): Promise<void> {
  shuttingDown = true;
  const s = slots;
  slots = null;
  if (s) await Promise.all(s.map((slot) => slot.worker.terminate()));
}
