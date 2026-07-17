# DEBUG.md — memory & performance field guide

How to see what the stack is doing, the knobs that bound it, and the failure
modes we have actually hit (with their fixes), so the next incident starts from
evidence instead of guesswork. Born out of the July 2026 worker-OOM hunt.

## Observability — where to look, in order

| Surface | What it tells you |
|---|---|
| `/admin/queue` **Worker memory** card | Worker rss vs JS heap vs the V8 ceiling, rss high-water, uptime |
| `/admin/queue` **BAKE THREADS** strip | `live` (isolates holding rss) · `baked in thread`/`inline` (offload working?) · `spawned`/`recycled` (memory being handed back) · `crashed` (red = check logs) |
| `/admin/queue` **Public memory** card | The SAME split for the public app itself (via `/api/public-stats`) |
| `/admin/queue` **Event memory ledger** | Per-job-type `runs / errors / avg / peak ms / peakHeapDeltaMB / peakRssMB` since worker boot — "which job eats memory" as a sortable table |
| Worker `/status` (internal-only) | Everything above as JSON + per-tier queue counts + `active` running-set |
| `/api/public-stats` | Public's own memory split; admin session OR `?key=$QUEUE_LOG_KEY` (same key as `/api/queue-logs`), so it works through nginx |
| `/api/status` `.memory` | Same numbers, but ONLY for box-local curls (proxy-header guarded) |
| `docker stats` | Per-container rss/CPU — the OS-eye view the OOM killer uses |

Per-job instrumentation: every `job:done` log line carries
`{heapDeltaMB, heapMB, rssMB, rssPeakMB}`. **Caveat:** deltas are process-wide
across the job's runtime — under concurrency they cross-bill whoever finishes
first. Only trust attribution when the box is otherwise quiet (this cost us a
wrong suspect once: 1s "skipped" jobs billed +300MB that belonged to
neighbours).

### Live-process inspection (no restart, no pause)

- Dev: run any service via `yarn dev:inspect` — public router :9230 (the
  `next-server` child auto-increments to :9231 — that's the one you want),
  worker :9240, socket :9250. Or `kill -USR1 <pid>` for the default :9229.
- Probe: `node scripts/inspect-node.mjs <port>` → rss/heap/native-gap split,
  heap spaces, live libuv handles by type (socket pile-ups show here).
- Interpreting the split: **JS heap** is what V8 GCs; **nativeGap**
  (rss − heapTotal − external) is worker threads' isolates, sharp/libvips,
  glibc arenas — invisible to the heap gauge, real to the OOM killer.

## Memory knobs (all env, mostly with sane defaults in compose)

| Knob | Default | What it bounds |
|---|---|---|
| `WORKER_NODE_HEAP_MB` | 4096 | Worker V8 heap. **Without it V8 defaults to ~2GB on an 8-16GB host** — the staging OOMs crashed into that while 5GB sat free |
| `PUBLIC_NODE_HEAP_MB` / `PUBLIC_MEMORY_LIMIT` | 3072 / 4g | Public heap / hard container ceiling |
| `MONGO_CACHE_GB` | 1.5 | WiredTiger cache. Uncapped, Mongo targets ~50% of (RAM−1GB) **by design** — ~3.9GB on an 8GB box. Container rss ≈ cache + 0.5-1GB |
| `MALLOC_ARENA_MAX` | 2 (compose) | glibc arena ratchet — without it the first big Buffer/sharp burst sets a permanent rss floor ("100s of MB, then boom, then flat") |
| `BAKE_POOL_SIZE` | min(4, cores−2) | Bake worker-threads = the biggest native-memory lever. `1` = maximum thrift (measured: same cycle 2.4GB vs 6.2GB at 4); `2` matches the background lane's concurrency |
| `BAKE_POOL_IDLE_MS` | 60000 | Idle bake threads retire and return their isolate to the OS (`recycled` on the strip) |
| `BAKE_WORKER_HEAP_MB` | unset | OPT-IN per-thread heap cap. A cap turns "one huge bake used RAM and finished" into a thread death — only set once the biggest real bake is known |
| `WEATHER_INGEST_ON_BOOT` | true | `false` skips the 12-model boot kick (calmer first minutes on a small box) |
| `ALERT_DISSOLVE_TIMEOUT_MS` | 2100000 (35min, compose) | Kill switch for the alert-blob dissolve child. ~2min on an idle dev box but a loaded 4-core VPS can stretch it past the old 15min code default (staging did — SIGKILLed mid-rebuild). If it times out with `dissolved …` progress lines still flowing, it was slow, not wedged: raise this. Silent-after-one-key = a pathological union — bound it, don't raise this |

Budget that works on an 8-10GB box: worker ≤5GB worst-case + Mongo ~2.2 +
public ≤1 + OS/redis/socket ~1 → bursts peak ~7.5GB, steady ~4-5GB.

## Failure modes we have actually hit

**Wall-clock stampede (top-of-hour OOM).** BullMQ's LEGACY `add({repeat:
{every, offset}})` silently drops the offset when an iteration re-arms (its
persisted config is only `{name,endDate,tz,pattern,every}`) — verified live:
every ≤60min job showed `storedOffset null` and fired at `slot+0` while
never-re-armed 6-hourly jobs kept theirs. Result: ~9 heavy jobs detonating at
:00 sharp into the 2GB default heap. **Fix (in code):** `addJob` registers
repeatables as v5 JOB SCHEDULERS with `startDate` = next slot + deterministic
`staggerOffset` (phase persists across re-arms); cron defaults get hashed
minutes via `staggerMinute` (weather.check `:04/:34`, summaries `:11`/`:10`/`:14`).
Never register a repeatable with raw `queue.add({repeat})` again.

**Repeat replay flood.** A Redis with downtime history (or restored data) holds
iterations an old schedule already promoted; BullMQ replays every missed slot
back-to-back at boot (three ~16-day-old `summaries.generateHourly` inside 70ms
→ 2GB heap in 13s). **Fix:** boot replay guard drops pending `repeat:*` jobs
after clearing schedules (paged, ids-only — a getJobs(0,-1) would itself OOM on
a 50k-job backlog). Log line: `dropped N stale repeat iteration(s)`.

**Immortal bake threads.** Worker threads are separate V8 isolates: their heap
ratchets to the biggest-ever bake, shows ONLY in rss, and (pre-fix) lived
forever. **Fix:** on-demand spawn + idle recycle + crash budget (a dead worker
refunds its task inline and respawns; only after `BAKE_POOL_MAX_CRASHES` does
the pool go inline-forever).

**Whole-feed buffering.** `res.text()` + `JSON.parse` of the WMO 30k-feature
WFS snapshot held body string + full tree + output simultaneously (~300MB per
poll on real data; MeteoAlarm ~237MB). **Fix:** `AlertSource.fetchParsed()` —
WMO streams features off the socket (`alerts/geojson-stream.ts`, zero-dep)
through an incremental capurl accumulator; MeteoAlarm fetches per-country with
bounded concurrency and releases each body. A malformed snapshot now THROWS
(fails the tick) instead of parsing as zero alerts — which, on a reconcile
source, used to be able to deactivate every live alert.

**Hung fetches / unconsumed bodies.** Raw `fetch` waits forever and a non-ok
response's body pins its socket until GC. **Fix:** `timeoutFetch()` injected
into the events.acquire adapter fan-out, `fetchWithTimeout` on all alert feed
pulls, `discardBody()` on every non-ok branch. Rule: any new upstream call
gets a timeout and discards unread bodies.

**Transient-blip tick failures.** Repeatables ran `attempts 1/0`, so one
Docker-DNS hiccup (`EAI_AGAIN mongodb` at stack boot) failed a whole tick.
**Fix:** `addJob` defaults `attempts: 3` + exponential 5s backoff. Related:
`interrupted at shutdown` during a Mongo restart is one in-flight casualty —
`getDb()`/`getAppDb()` rebuild on the next call (a failed connect is never
cached beyond a 1s cooldown), so if the error persists minutes after Mongo is
healthy, THAT is news.

**Public's flat ~1.2GB.** Not a leak: prod Next's first big texture/media burst
sets a glibc arena high-water that never returns (small steady heap under a fat
`nativeGapMB` on the Public memory card). Contained by `mem_limit`, shrunk by
`MALLOC_ARENA_MAX=2`. A *climbing* `heapUsedMB` is the signal that would
actually mean a public leak. (Dev-mode `next dev` numbers are meaningless for
this — ~1.7GB of Turbopack/watcher native memory that doesn't exist in prod.)

## Incident quick-list

1. `docker stats` — who, and is it heap or container-wide?
2. `/admin/queue` memory cards + bake strip + ledger (or `curl :10102/status`).
3. Crash log's `<--- Last few GCs --->` header: heap-limit OOM (exit 134) names
   the ceiling it hit; exit 137 = Docker/kernel OOM-kill (container limit);
   exit 139 = native segfault (a `.node` binary, not JS).
4. Job starts clustered on one timestamp = scheduling collision, not a leak.
5. Still ambiguous → `dev:inspect` / SIGUSR1 + `scripts/inspect-node.mjs`.
6. Deltas only attribute cleanly on a quiet box — never diagnose from a boot.
