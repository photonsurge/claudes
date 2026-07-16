// grib/bakeWorker.ts
// Worker-thread entry for the bake pool. Runs the CPU-bound texture bake
// (unit-convert, longitude roll, nodata mask, RGBA pack, sharp PNG) OFF the main
// event loop so the process stays responsive — signals, health probes and the
// director loop keep running while grids crunch. One task at a time per thread;
// a pool would spin up N of these so several bakes run at once.
//
// !! CURRENTLY UNWIRED. The `bakePool.ts` this file was written for was never
// built — nothing does `new Worker(<this file>)`, so every bakeScalar/bakeVector
// runs INLINE on the main event loop (see the ~12 call sites), which is one of
// the two synchronous CPU paths that starve BullMQ's lock renewal. index.ts's
// raised lockDuration currently absorbs that; building the pool and routing the
// call sites through it is the structural fix. This entry is kept because it's
// correct and ready: a pool need only `new Worker(...)` it and post BakeMessages.
//
// When that pool exists: under ts-node (dev) it must pass
// `-r ts-node/register/transpile-only` so this .ts loads directly; the compiled
// build loads the emitted .js. Kept dependency-light: it only pulls the two pure
// compute modules (which pull sharp + the variable registry).
import { parentPort } from "worker_threads";
import { bakeScalar, type BakeScalarArgs } from "./bakeScalar";
import { bakeVector, type BakeVectorArgs } from "./bakeVector";

if (!parentPort) throw new Error("bakeWorker must be run as a worker thread");
const port = parentPort;

interface BakeMessage {
  id: number;
  kind: "scalar" | "vector";
  args: BakeScalarArgs | BakeVectorArgs;
}

port.on("message", async (msg: BakeMessage) => {
  try {
    const result =
      msg.kind === "scalar"
        ? await bakeScalar(msg.args as BakeScalarArgs)
        : await bakeVector(msg.args as BakeVectorArgs);
    // result.buffer is a Node Buffer; structured clone copies it back to the main
    // thread. Cheap — it's the compressed PNG (tens/hundreds of KB), not the raw
    // multi-MB grid. Not transferred: sharp's buffer provenance is opaque, and the
    // copy cost is noise next to the bake we just offloaded.
    port.postMessage({ id: msg.id, ok: true, result });
  } catch (err) {
    port.postMessage({ id: msg.id, ok: false, error: String((err as Error)?.stack || err) });
  }
});
