# Queue job logs — retained ring + pull endpoint

Each worker job's own `console.*` output is captured per-job (see
[`worker/src/jobLog.ts`](../worker/src/jobLog.ts)) and streamed to the browser
live as a `queue:log` socket event. That stream only reaches browsers that were
connected **while the job ran** — you couldn't open a job on `/admin/queue`
afterwards and see what it did.

This adds a **retained ring buffer** on the worker plus a **pull endpoint**, so a
job's log can be fetched on demand — from the `/admin/queue` card (backfill on
expand) or over `curl` with a key.

## How it fits together

```
worker handler console.*  ──►  jobLog.ts
                                 ├─ emit  queue:log (socket, live)   ──►  browser (QueueLogCollector → store)
                                 └─ retain in ring (per jobId)
                                        ▲
                                        │  GET /internal/job-log/:jobId   (internal-only)
                                        │  GET /internal/job-logs         (internal-only, index)
                                        │
public  GET /api/queue-logs[?jobId=]  ──┘  (session- or key-authed, proxies worker)
```

Every retained line carries a process-global `seq`, sent on **both** the socket
event and the pull response, so the browser store merges live + backfilled lines
with no duplicates.

### Worker ring — `worker/src/jobLog.ts`

- Bounded: `RING_MAX_LINES = 100` per job, `RING_MAX_JOBS = 200` (oldest job
  evicted first — the ring is a `Map`, which keeps insertion order). Purely
  in-memory, same as `eventStats` / `activeJobLabels`; nothing is persisted to
  Mongo. Lines age out — this is a recent-activity window, not an archive.
- `getJobLog(jobId)` → `JobLogEntry[]` (`{ seq, ts, level, line }`, oldest first).
- `listJobLogs()` → `JobLogSummary[]` (`{ jobId, label, count, lastTs, lastLine }`,
  most-recently-active first).

### Worker endpoints (internal-only)

Both reject any request that arrived via a proxy (the `x-forwarded-*` guard), so
they're only reachable inside the compose `internal` network — same as `/status`.

| Method & path                    | Returns                                            |
| -------------------------------- | -------------------------------------------------- |
| `GET /internal/job-log/:jobId`   | `{ jobId, lines: JobLogEntry[] }`                  |
| `GET /internal/job-logs`         | `{ jobs: JobLogSummary[] }`                        |

### Public endpoint — `GET /api/queue-logs`

Proxies the worker over `WORKER_INTERNAL_URL`. Sits **outside** the
`/api/admin/*` matcher in [`proxy.ts`](../public/src/proxy.ts), so it self-guards
rather than being force-gated to a session — that's what lets a keyed `curl`
through.

| Query                          | Returns                             |
| ------------------------------ | ----------------------------------- |
| `GET /api/queue-logs`          | index — `{ jobs: JobLogSummary[] }` |
| `GET /api/queue-logs?jobId=…`  | one job — `{ jobId, lines: […] }`   |

**Auth — either is sufficient:**

1. **Admin session cookie** — how the browser card authenticates (the operator's
   existing login; no key in the browser).
2. **`QUEUE_LOG_KEY`** — for `curl` / tooling. Provide it as `?key=…`, header
   `x-queue-log-key: …`, or `Authorization: Bearer …`.

If `QUEUE_LOG_KEY` is **unset**, the key path is disabled and the endpoint is
admin-session-only. Fail-soft: worker errors return `{ lines: [] }` /
`{ jobs: [] }` with HTTP 200.

## `/admin/queue` card

Expanding a job card shows a **live log** section:

- Live lines arrive over the socket via
  [`QueueLogCollector`](../public/src/components/admin/QueueLogCollector.tsx) →
  the per-job store ([`queue-log-store.ts`](../public/src/lib/queue-log-store.ts)),
  which uses `useSyncExternalStore` so only the one card whose job got a line
  re-renders.
- On expand, the card also fetches `/api/queue-logs?jobId=…` to **backfill** the
  worker's retained ring (lines emitted before the page was open, or after the
  run finished). Merged by `seq`, so no duplicates.

## Config

`QUEUE_LOG_KEY` (public service). Set it to enable keyed external access:

```yaml
# docker-compose.yml → public.environment
QUEUE_LOG_KEY: ${QUEUE_LOG_KEY:-}
```

```bash
# .env
QUEUE_LOG_KEY=some-long-random-string
```

## curl examples

```bash
KEY=some-long-random-string
BASE=https://your-domain

# Which jobs currently have retained logs
curl -s "$BASE/api/queue-logs?key=$KEY" | jq

# One job's lines (jobId from the index, or the #id on an /admin/queue card)
curl -s "$BASE/api/queue-logs?key=$KEY&jobId=1784292833596" | jq '.lines[].line'

# Header form instead of the query param
curl -s -H "x-queue-log-key: $KEY" "$BASE/api/queue-logs?jobId=1784292833596" | jq
```
