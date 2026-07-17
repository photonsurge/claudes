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
// Fail-safe: if a worker can't start or dies mid-task, that task falls back to an
// INLINE bake. The pool is a performance change that can never produce a wrong or
// missing texture, and never does worse than the pre-pool behaviour.
//
// LIFECYCLE (the memory half of the design): a worker thread is a whole V8
// isolate whose heap ratchets up to its biggest-ever bake and, being a separate
// isolate, never shows in the main thread's heapUsed — only in process RSS. So
// threads are spawned ON DEMAND (not eagerly), and an idle thread is RETIRED
// after BAKE_POOL_IDLE_MS, returning its memory to the OS; the next bake simply
// spawns a fresh one. A crashing worker no longer bricks the pool permanently
// either: each crash refunds its task inline and the pool respawns on demand,
// until BAKE_POOL_MAX_CRASHES in one process life — THEN it goes inline-forever
// (a repeatedly crashing worker must not become a spawn loop).

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

/** Retire a worker idle this long, so its isolate's memory goes back to the OS. */
const IDLE_MS = Number(process.env.BAKE_POOL_IDLE_MS || 60_000);
const SWEEP_MS = Math.max(5_000, Math.min(IDLE_MS, 30_000));

/** Crashes tolerated (each respawned through) before the pool goes inline-forever. */
const MAX_CRASHES = Number(process.env.BAKE_POOL_MAX_CRASHES || 3);

/**
 * OPT-IN per-thread V8 heap cap (MB). Unset = no limit, exactly as before — a
 * cap turns "one huge bake used a lot of RAM and finished" into a thread OOM
 * (refunded inline, counted against the crash budget), so only set it once the
 * biggest real bake's headroom is known.
 */
const WORKER_HEAP_MB = Number(process.env.BAKE_WORKER_HEAP_MB) || 0;

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
  /** When the slot last became idle — the recycle clock. */
  idleSince: number;
  /** Set when the sweeper terminates it on purpose, so exit≠crash. */
  retiring: boolean;
}

interface Task {
  kind: "scalar" | "vector";
  args: BakeScalarArgs | BakeVectorArgs;
  pending: Pending;
}

let slots: Slot[] = [];
let poolBroken = false;
let shuttingDown = false;
let crashes = 0;
let sweeper: NodeJS.Timeout | null = null;
let nextId = 1;
const inFlight = new Map<number, { slot: Slot; pending: Pending }>();
const queue: Task[] = [];

/** Where bakes ran (`worker` proves the offload) + thread lifecycle counters,
 *  plus the live picture: threads alive right now and tasks waiting for one. */
const stats = { worker: 0, inline: 0, spawned: 0, recycled: 0, crashed: 0 };
export const bakePoolStats = () => ({ ...stats, threads: slots.length, queued: queue.length });

/**
 * `worker_threads` structured-clone downgrades the result's `Buffer` to a plain
 * `Uint8Array`. Restore the Buffer (a zero-copy view over the same bytes) so the
 * pooled path returns exactly what the inline bake does — the DB layer casts a
 * Buffer, not a Uint8Array.
 */
function asBufferResult(result: BakeResult): BakeResult {
  const b = result.buffer as unknown as Uint8Array;
  if (Buffer.isBuffer(b)) return result;
  return { ...result, buffer: Buffer.from(b.buffer, b.byteOffset, b.byteLength) };
}

function spawn(): Slot {
  const worker = new Worker(workerFile, {
    execArgv: workerExecArgv,
    ...(WORKER_HEAP_MB > 0 ? { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } } : {}),
  });
  const slot: Slot = { worker, busy: false, idleSince: Date.now(), retiring: false };
  stats.spawned++;

  worker.on("message", (msg: { id: number; ok: boolean; result?: BakeResult; error?: string }) => {
    const entry = inFlight.get(msg.id);
    if (!entry) return;
    inFlight.delete(msg.id);
    slot.busy = false;
    slot.idleSince = Date.now();
    if (msg.ok && msg.result) {
      stats.worker++;
      // Crossing the worker-thread boundary strips the Buffer subclass: the PNG
      // comes back as a plain Uint8Array, which Mongoose's SchemaBuffer.cast
      // rejects at texture-write time. Re-wrap it as a Buffer (zero-copy view)
      // so a pooled bake is byte-for-byte interchangeable with the inline one.
      entry.pending.resolve(asBufferResult(msg.result));
    } else entry.pending.reject(new Error(msg.error || "bake worker error"));
    pump();
  });

  // A worker that errors or exits takes its in-flight task down with it: re-run
  // that ONE task inline so nothing is lost, drop the slot, and count the crash.
  // The pool keeps respawning on demand until the crash budget is spent — only
  // THEN does it go inline-forever (no spawn loop). A terminate() during
  // shutdown or an idle-retire is not a crash (a terminated worker always exits
  // 1), so those are ignored via the flags.
  const die = (why: string) => (err?: Error) => {
    if (shuttingDown || slot.retiring) return;
    slot.retiring = true; // one crash = one budget hit, even if error AND exit both fire
    const at = slots.indexOf(slot);
    if (at >= 0) slots.splice(at, 1);
    for (const [id, entry] of [...inFlight]) {
      if (entry.slot !== slot) continue;
      inFlight.delete(id);
      entry.pending.fallback().then(entry.pending.resolve, entry.pending.reject);
    }
    crashes++;
    stats.crashed++;
    if (crashes >= MAX_CRASHES && !poolBroken) {
      poolBroken = true;
      log(TAG, `bake worker ${why} — crash budget spent (${crashes}), falling back to inline bakes`, {
        error: err ? String(err?.message ?? err) : undefined,
      });
      drainQueueInline();
      return;
    }
    log(TAG, `bake worker ${why} — task refunded inline, will respawn on demand`, {
      error: err ? String(err?.message ?? err) : undefined,
      crashes,
    });
    pump(); // queued work may need a fresh worker right away
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

/** Retire workers that have sat idle past IDLE_MS — their isolate's memory
 *  (ratcheted to the biggest bake they ever served) goes back to the OS. */
function sweep() {
  const now = Date.now();
  for (const slot of [...slots]) {
    if (slot.busy || now - slot.idleSince < IDLE_MS) continue;
    slot.retiring = true;
    const at = slots.indexOf(slot);
    if (at >= 0) slots.splice(at, 1);
    stats.recycled++;
    slot.worker.terminate().catch(() => {});
  }
}

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(sweep, SWEEP_MS);
  sweeper.unref?.(); // never the reason the process stays alive
}

/** Hand queued tasks to idle workers, spawning up to POOL_SIZE on demand. */
function pump() {
  if (poolBroken || shuttingDown) return;
  while (queue.length) {
    let slot = slots.find((s) => !s.busy);
    if (!slot) {
      if (slots.length >= POOL_SIZE) return; // all busy — a completion will re-pump
      try {
        slot = spawn();
        slots.push(slot);
        ensureSweeper();
      } catch (err) {
        // Can't host a worker at all (module runtime, file missing) — permanent.
        poolBroken = true;
        log(TAG, `bake pool failed to start — inline bakes`, { error: String((err as Error)?.message ?? err) });
        drainQueueInline();
        return;
      }
    }
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
  if (DISABLED || poolBroken) {
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
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  const s = slots;
  slots = [];
  await Promise.all(s.map((slot) => slot.worker.terminate()));
}
