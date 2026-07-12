/**
 * Worker-side libvips (sharp) tuning — a SIDE-EFFECT module. Import it once
 * before any archived frame is decoded (see frameDecode.ts).
 *
 * Scope: MAIN-THREAD ONLY. This caps the libvips operation cache so a burst of
 * frame decodes doesn't leave decoded grids resident in RSS. It deliberately
 * does NOT touch sharp.concurrency — the CPU-bound live BAKE runs on the
 * grib/bakeWorker.ts worker-thread pool (its own sharp instance) and wants the
 * default per-op thread count. Decode fan-out is bounded separately by
 * decodeGate.ts, so the main thread doesn't need a concurrency cap here.
 *
 * The other half of the RSS fix (MALLOC_ARENA_MAX) is a process env var, not a
 * sharp call — it must be set before node starts, in the process manager.
 */
import sharp from "sharp";

// Bound the op cache: default is 50MB / 100 items; a decoded global grid is
// ~4MB, so a few resident is plenty. items caps entry count independently.
sharp.cache({
  memory: Math.max(0, Number(process.env.SHARP_CACHE_MB) || 64),
  items: 32,
});

// Referenced export so bundlers never treat the import as dead code.
export const SHARP_TUNED = true;
