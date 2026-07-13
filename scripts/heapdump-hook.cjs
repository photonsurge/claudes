/**
 * Bulletproof heap-dump hook — preloaded into the public server with
 *   node --require /app/heapdumps/heapdump-hook.cjs /app/public/server.js
 *
 * Writes snapshots to a KNOWN mounted path ($HEAPDUMP_DIR, default /app/heapdumps),
 * logs every step, and prints a periodic memory breakdown. Triggers, in order of
 * usefulness for this leak (JS heap, ~90MB/s — OOMs in ~30s):
 *
 *   - THRESHOLD (primary): dump when heapUsed first crosses each $HEAPDUMP_HEAP_MB
 *     mark (default "700,1100"). Catches a fast runaway mid-explosion, safely below
 *     the --max-old-space-size ceiling. Writing a snapshot pauses JS (stop-the-world),
 *     so the dump itself can't push it over the limit.
 *   - SIGUSR2 (manual): `docker compose exec public kill -USR2 1`
 *   - TIME (fallback): $HEAPDUMP_AT seconds (default off — set e.g. "45,90").
 *
 * Two dumps -> diff them: analyze-heapsnapshot.mjs <lower> <higher>. The top
 * grower is the leak.
 */
const v8 = require("node:v8");
const path = require("node:path");

const OUT = process.env.HEAPDUMP_DIR || "/app/heapdumps";
const mb = (n) => Math.round(n / 1048576);

function dump(tag) {
  const file = path.join(OUT, `dump-${tag}-${process.pid}-${Date.now()}.heapsnapshot`);
  console.log(`[heapdump] writing ${file}  (rss ~${mb(process.memoryUsage().rss)}MB) …`);
  try {
    v8.writeHeapSnapshot(file); // synchronous, stop-the-world, streamed to disk
    console.log(`[heapdump] wrote ${file}`);
  } catch (err) {
    console.error(`[heapdump] FAILED (${OUT} writable by this uid?): ${err}`);
  }
}

// Heap-size thresholds (MB) — each fires once, when heapUsed first exceeds it.
const THRESH = (process.env.HEAPDUMP_HEAP_MB || "700,1100")
  .split(",").map((s) => Number(s.trim())).filter((n) => n > 0)
  .sort((a, b) => a - b);
const fired = new Set();

// Poll fast (1s) so a ~90MB/s runaway is caught between marks. Log the breakdown
// every 3rd poll so the leak CLASS stays visible without flooding.
let tick = 0;
setInterval(() => {
  const m = process.memoryUsage();
  const heap = mb(m.heapUsed);
  if (tick++ % 3 === 0) {
    console.log(
      `[heapdump] mem MB  rss=${mb(m.rss)}  heapUsed=${heap}  ` +
        `external=${mb(m.external)}  arrayBuffers=${mb(m.arrayBuffers)}`,
    );
  }
  for (const t of THRESH) {
    if (heap >= t && !fired.has(t)) {
      fired.add(t);
      dump(`h${t}`);
    }
  }
}, 250).unref();

// Manual + optional time-based fallback.
process.on("SIGUSR2", () => dump("sig"));
for (const sec of (process.env.HEAPDUMP_AT || "")
  .split(",").map((s) => Number(s.trim())).filter((n) => n > 0)) {
  setTimeout(() => dump(`t${sec}`), sec * 1000).unref();
}

console.log(
  `[heapdump] hook armed -> ${OUT}; dump at heapUsed >= [${THRESH.join(", ")}]MB; or SIGUSR2`,
);
