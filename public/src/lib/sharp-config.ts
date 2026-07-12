/**
 * Global libvips (sharp) tuning for the public server — a SIDE-EFFECT module:
 * import it once before anything decodes a frame (see weather-history.ts).
 *
 * Why this exists: the history/forecast panels decode weather-grid PNGs back to
 * raw RGBA to sample pixel values. libvips defaults to one worker thread PER CPU
 * CORE per operation, so a burst of concurrent decodes fans a single Node process
 * across every core (the observed ~5.5-core / 554% peg on `public`). It also keeps
 * an operation cache that, with musl's allocator, inflates RSS.
 *
 * We don't need multi-threaded decode here — the work is decode-bound across MANY
 * concurrent requests, not one big image — so one thread per op keeps total
 * throughput while capping the fan-out. Tunable via env for headroom.
 *
 * NB: this is public-only. The worker keeps sharp's defaults so the live frame
 * BAKE pipeline stays fast (it isn't the process pegging cores).
 */
import sharp from "sharp";

// 1 libvips thread per operation (0 would mean "num cores" — the default we're
// escaping). Cap the op cache so libvips doesn't hold decoded frames resident.
sharp.concurrency(Math.max(1, Number(process.env.SHARP_CONCURRENCY) || 1));
sharp.cache({
  memory: Math.max(0, Number(process.env.SHARP_CACHE_MB) || 64),
  items: 32,
});

// A referenced export so bundlers never treat the import as dead code.
export const SHARP_TUNED = true;
