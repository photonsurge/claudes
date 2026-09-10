# Plan: blob retention — one frame a day, forever, instead of everything forever

> Status: **SHIPPED 2026-09-10, not yet run on prod.** All six phases are in the
> tree with tests green; nothing has been deleted anywhere yet. Triggered by
> `${BLOB_DIR}` reaching 240 GB on prod. Goal: bound every namespace, keep exactly
> one keepsake per map/view per UTC day for the long tail, and give seismic +
> alerts a durable record that outlives the working set. Companion to
> [[weather-archive-backfill-plan]] and [[world-clock-plan]] — this doc is the
> *retention* side of the same archive, and is written so neither of those loses
> what it needs.
>
> **Deploy order matters. See §15.**

## 1. Where the 240 GB is

From the prod `du` (clipped) plus what the code guarantees:

| Namespace | Prod | Bounded? | By what |
|---|---|---|---|
| `frame` | not in the clip, inferred ~150 GB | **no** | `archiveKeepDays()` defaults to `0` = forever |
| `alert-snapshot` | 74 GB | **no** | `pruneOlderThan` exists, has no caller |
| `tex` | 3.4 GB | yes | run retention (3 published runs) |
| `event-snapshot` | 2.0 GB | **partly** | age-prune covers source `geonet` only |
| `forecast-frame` | 321 MB | yes | 3-hour cutoff in `archiveForecast.ts` |
| `satimg` | 89 MB | yes | small working set |
| `volcano-media` | not in the clip | yes | `volcano-media-prune` repeatable |

The two unbounded namespaces are the entire problem. Textures and forecast
frames prove the machinery works when something calls it.

Run this on the host to fill in the clipped rows before starting:

```
du -sh -- "$BLOB_DIR"/*/ | sort -h
```

`/admin/files` reports the same thing per namespace with disk free.

## 2. Root causes — three separate bugs, not one

**A. The compare job re-stores the same picture every hour.**
`snapshotCompare` ([alerts.ts:317](../worker/src/jobs/alerts.ts#L317)) runs
hourly, takes the earliest and latest satellite still for each of up to
`ALERT_SNAPSHOT_MAX` (50) active alerts, renders a side-by-side and stores it.
It has **no change check**. The satellite path directly above it does have one
and skips a frame whose `observationTime` has not moved. Compare's inputs barely
move either: the earliest still is fixed forever (nothing prunes it) and the
latest changes once a day when the GIBS daily mosaic updates. So it writes a
fresh copy of a byte-identical image every hour, per alert. On the local box,
where that job has run only a handful of hours, **18% of alert-snapshot blobs
are byte-identical to another one**. On prod, running hourly for months, that
ratio is the 74 GB.

**B. Nothing prunes alert snapshots at all.**
`pruneOlderThan` ([alert-snapshot-repo.ts:288](../shared/src/db/alert-snapshot-repo.ts#L288))
is written, tested and correct. It has no caller in the tree, no BullMQ
repeatable, and no `/admin/jobs` entry.

**C. The weather frame archive keeps everything, and MRMS feeds it every two
minutes.** `archiveKeepDays()` ([archive.ts:38](../worker/src/weather/archive.ts#L38))
defaults to `0`, documented as keep forever, and there is no override in `.env`.
`archiveRun` fires on every source publish. The upsert key is
`(model, variable, validTime)`, which dedups the 30-minute pollers because their
`f000` valid time only moves when a new run lands — but MRMS mints a fresh
`validTime` every cycle ([mrms.ts:124](../worker/src/weather/mrms.ts#L124)) and
its cycle is 2 minutes ([sourceSchedule.ts:35](../worker/src/weather/sourceSchedule.ts#L35)).

| | frames/day | at 0.55 MB avg |
|---|---|---|
| MRMS radar alone | 720 | ~390 MB/day, ~12 GB/month |
| every other source combined | ~300–500 | ~200 MB/day |

Nine months of that is the ~150 GB.

## 3. What must not break

Every consumer of the frame archive that touches air, and its window:

| Consumer | Window | Needs |
|---|---|---|
| `runWeatherPanels` (country/region charts) | `HISTORY_WINDOW_HOURS` = **72h** | fine cadence |
| `cityWeather` 24h trend | **24h** | fine cadence |
| `areaWeather` | **6h** | fine cadence |
| `/api/weather/history/point` and `/area` | whole archive | any cadence |
| `/api/weather/history/frames` (replay manifest) | whole archive | any cadence |
| [[world-clock-plan]] past-`T` scrub | whole archive | states **~3h resolution**, daily is a downgrade it should sign off on |

The PAST YEAR panel does **not** read this archive — it reads ERA5 via
`climateYears` ([climate/route.ts](../public/src/app/api/weather/history/climate/route.ts)),
so daily thinning cannot touch it.

So: **nothing on air looks back further than 72 hours.** Everything past that is
exploratory or not built yet. That is the licence to thin.

## 4. The shape of the fix

One rule, applied per namespace, mirroring the volcano cam thinning that already
works (`planCamThinning`, [camFrames.ts:79](../worker/src/volcanoes/camFrames.ts#L79)):

1. **Full-res window** — keep everything captured inside it. Sized to cover the
   widest on-air consumer with headroom.
2. **Daily keeper** — past that, keep exactly one per group per UTC day. This is
   the "one a day of each of the maps / views".
3. **Hard cap** — past that, drop entirely, *except* things flagged as the record.

Selection stays a pure function taking metadata and returning ids to delete, so
it unit-tests without Mongo or disk. Deletion goes through the repo, which owns
both the doc and the bytes.

## 5. Phase 0 — stop the bleed (do this first, alone)

Smallest change, biggest single win, no deletion risk.

- In `snapshotCompare`, before rendering: skip when a `compare` snapshot already
  exists for this alert whose `observationTime` equals the latest satellite's
  **and** whose pair is unchanged. Cheapest correct form: stamp the pair into a
  field (`layer: "satellite"` → `layer: satellite:${earliest.id}:${latest.id}`)
  and skip when a snapshot with that exact layer already exists. That also makes
  the slot key meaningful instead of hour-bucketed noise.
- Ship this on its own and watch `/admin/files` flatten before deleting anything.

Expected: alert-snapshot growth drops from ~50 images/hour to ~50/day.

## 6. Phase 1 — weather frames: one a day of each map, forever

The split already exists in the source registry: `isNestSource(id)` is true
exactly when a source declares `minZoom`, i.e. it is a zoom-gated regional
overlay rather than a globe-wide base.

| Class | Sources | Rule |
|---|---|---|
| **Global bases** (~22 model/variable pairs) | `gfs` (10 vars), `ifs` (3), `rtofs` (3), `rtofs-depth` (4), `gfswave-0p25`, `gfswave-mosaic` | full-res for `WEATHER_ARCHIVE_FULLRES_HOURS` (default **96**), then **one per (model, variable) per UTC day, forever** — the one nearest 12:00Z |
| **Nests** | `mrms`, `hrrr`, `icon-d2`, `icon-eu`, `icon-global`, `hrdps`, `ukv`, the Open-Meteo family, wave nests, RTOFS regional | full-res for `WEATHER_ARCHIVE_NEST_KEEP_DAYS` (default **7**), then dropped |

This is what disarms MRMS without a special case: radar is a nest
(`minZoom: 3`), so the 720-frames-a-day firehose becomes a rolling 7-day window.

Estimated steady state:

| | size |
|---|---|
| daily keepers, 22 pairs, per year | ~4.4 GB |
| rolling nest window (7 days, MRMS-dominated) | ~5 GB |
| full-res working set (96h, all sources) | ~2.5 GB |

So roughly **12 GB standing plus 4.4 GB a year**, against ~150 GB and climbing.

Work:
- New pure `planFrameThinning(metas, opts)` in `worker/src/weather/`, alongside
  `selectArchiveSteps`. Groups by `(model, variable, UTC day)`, keeps the pick
  nearest midday, returns ids to delete.
- New `weatherFrames.deleteMany(ids)` on the repo (mirrors
  `eventSnapshots.deleteMany`), doc plus bytes.
- New job `weather-thin-archive` (+ a `-dry` twin) in `shared/src/jobs.ts`,
  registered as a daily repeatable in `worker/src/index.ts` on the **background**
  tier. It walks `listMeta` per variable, never loading bytes.
- Leave `archiveKeepDays()` alone. It stays `0`; thinning replaces it rather than
  fighting it, so a keep-days value set later still works as a blunt backstop.

Sign-off needed on the [[world-clock-plan]] line: past-`T` scrub gets 96 hours at
3h resolution then daily. If that plan needs 3h for longer, raise
`WEATHER_ARCHIVE_FULLRES_HOURS` — the cost is ~25 MB per extra day.

## 7. Phase 2 — alert snapshots: retention plus a keepsake

- Full-res for `ALERT_SNAPSHOT_FULLRES_HOURS` (default **72**).
- Then one per `(alertId, kind, layer)` per UTC day.
- Then, past `ALERT_SNAPSHOT_KEEP_DAYS` (default **30**), drop — **except** the
  newest `satellite` still for any alert that actually went on air. The as-run
  log already records that: `AirEntry.subjectId` is a stable
  `"<kind>:<id>"` and has no TTL, so the aired set is queryable and permanent.
  That is the "record of alerts" with a picture attached, at roughly one image
  per aired alert rather than one per alert.
- Wire the existing `pruneOlderThan` behind a new `alerts-prune-snapshots` job
  and a daily repeatable, with a `-dry` twin that counts and deletes nothing.

## 8. Phase 3 — event snapshots: close the two gaps

In `pruneCamSnapshots` ([volcanoes.ts:1377](../worker/src/jobs/volcanoes.ts#L1377)):

- Stage 2's age-prune is hard-coded to source `geonet`. Every other cam provider
  is thinned to two frames a day and then kept forever. Widen it to all sources
  that the volcano cam path writes.
- Stage 1's thinning only walks volcanoes with `status: "ACTIVE"`. Frames for an
  event that has since closed are never revisited. Walk closed events too, or
  age-prune by event status.

2 GB today, so this is the small one, but both are one-line-ish and they are
real leaks.

## 9. Phase 4 — the durable record

**Alerts: already permanent, no change needed.** `Alert` has no TTL index, and
neither does `AlertRevision` or the as-run log. Alerts are deactivated, never
deleted. The record exists; Phase 2 gives it a picture.

**Seismic: currently there is no record.** `Quake` carries a TTL index that
deletes every event after 31 days ([quake-model.ts:63](../shared/src/db/quake-model.ts#L63)).
Nothing copies them out first. Any question about last year's earthquakes is
unanswerable today.

Fix, following the pattern `WeatherFrame` already uses against `WeatherRun`
(copy into a collection retention never touches):

- New `QuakeArchive` collection: no TTL, same shape minus the working-set fields,
  indexed on `time` and `loc`.
- New daily `seismic-archive` job copying every quake above
  `QUAKE_ARCHIVE_MIN_MAG` (default **4.5**) that is not already archived, run
  well inside the 31-day TTL so a few missed days never lose data.
- One backfill one-shot for whatever is still inside the current TTL window.

Cost: a quake doc is a few hundred bytes and M4.5+ runs a few thousand a year.
Call it single-digit MB per year, in Mongo, no blobs.

**Optional, cheap, and what makes a day browsable:** a `DayDigest` doc per UTC
day — which frame keepers survived, alerts opened and closed by hazard, quakes
above threshold, what aired. One small doc a day, and it stays correct after the
bytes it describes are gone.

## 10. Phase 5 — reclaim what is already there

Nothing here runs without a dry run first.

1. **Dry-run every new prune job**, read the counts, and only then run the real
   one. Every job above ships with a `-dry` twin.
2. **Dedup pass for alert snapshots** — hash the existing blobs, collapse
   byte-identical ones onto a single blob, repoint the docs. On the local sample
   that is 18%; on prod it should be most of the 74 GB. Run it after Phase 0 so
   the job is not racing new duplicates.
3. **Orphan sweep** — there is no sweeper today. A blob whose doc is gone is
   invisible and permanent. Add one that lists each namespace directory,
   subtracts the ids Mongo still references, and reports; deletion behind a
   second, explicit button.
4. Order matters: Phase 0, then dedup, then thinning, then orphan sweep.

## 11. Phase 6 — see a day

Once the keepers are guaranteed, `/admin/archive?date=YYYY-MM-DD` is mostly a
read: that day's frame keepers per model and variable rendered through the
existing `/api/weather/history/tex/[id].png`, that day's alerts, that day's
archived quakes, that day's as-run entries. This is the thing the whole plan is
for, and it only works because Phase 1 guarantees the keeper exists.

## 12. Knobs

| Env | Default | Effect |
|---|---|---|
| `WEATHER_ARCHIVE_FULLRES_HOURS` | 96 | frames kept at full cadence |
| `WEATHER_ARCHIVE_NEST_KEEP_DAYS` | 7 | zoom-gated nests, incl. MRMS radar |
| `ALERT_SNAPSHOT_FULLRES_HOURS` | 72 | alert stills kept at full cadence |
| `ALERT_SNAPSHOT_KEEP_DAYS` | 30 | hard cap, aired keepsakes exempt |
| `QUAKE_ARCHIVE_MIN_MAG` | 4.5 | magnitude floor for the permanent record |
| `VOLCANO_CAM_RETENTION_DAYS` | 30 | existing, unchanged |

Every one of these must be readable at call time, not module load, so a restart
is not needed to retune.

## 13. Tests

- `planFrameThinning` — pure, table-driven: nest vs base, day boundaries, the
  midday pick, a day holding exactly one frame, an empty window.
- Alert keepsake selection — an aired alert survives the hard cap, an unaired one
  does not.
- `snapshotCompare` — a second call with unchanged inputs stores nothing.
- Repo `deleteMany` — doc and bytes both go, and a missing blob does not throw.
- Every prune job's dry run deletes nothing. Assert on a spy, not on a count.

## 14. Risks

- **Deleting the wrong keeper.** Mitigated by dry runs, pure selection functions,
  and doing Phase 0 before any deletion.
- **[[world-clock-plan]] wants 3h resolution further back than 96h.** Needs a
  decision before Phase 1 ships; it is a knob, not a rewrite.
- **[[weather-archive-backfill-plan]] assumes keep-forever.** Backfilled history
  would arrive at daily resolution anyway, so daily keepers are consistent with
  it, but the thinning job must not eat a backfill mid-import. Gate it on a
  marker or a lock.
- **Prune jobs are heavy.** They belong on the background tier, conc 2, per
  [[three-queue-tiers]] and [[never-block-main-thread]]. Selection is metadata
  only; bytes are never loaded to decide.

## 15. What shipped, and the order to run it

Everything below is in the tree, typechecked, and covered by tests. Nothing has
deleted a single byte yet — every destructive job is opt-in behind a button, and
every one has a dry-run twin.

**The code**

| Phase | Where |
|---|---|
| 0. Compare pair dedup | `worker/src/jobs/alerts.ts` + `pairKey` on the snapshot model |
| 1. Frame archive thinning | `worker/src/weather/thinArchive.ts`, daily `weather.thinArchive` |
| 2. Alert imagery retention | `worker/src/alerts/snapshot-retention.ts`, daily `alerts.pruneSnapshots` |
| 3. Event snapshot gaps | `worker/src/jobs/volcanoes.ts#pruneCamSnapshots`, now event-scoped |
| 4. Seismic record | `shared/src/db/quake-archive-*.ts`, daily `tracks.archiveSeismic` |
| 5. Reclaim | `worker/src/alerts/snapshot-dedup.ts`, `worker/src/blob/orphans.ts` |
| 6. Day browser | `/admin/archive` + `/api/admin/archive` |

**Deploying: there is nothing to configure**

Deploy and restart the worker. That is the whole procedure. No env vars, no
first-run button, no checklist:

- The four daily sweeps register themselves at boot and start bounding the two
  runaway namespaces within a day.
- The seismic record **seeds itself on the first boot** (a one-shot alongside the
  repeatable), because every day it went unseeded would permanently lose whatever
  the 31-day TTL reaped in the meantime. It archives everything the ingested USGS
  feed carries, so nothing has to be tuned to make the record useful.
- Every default is already sized for this deployment. `.env.sample` documents the
  dials so you know they exist, and says plainly that none need setting.

**What the first sweep does to the disk**

Both daily sweeps plan over the ENTIRE existing collection, not just what was
written since deploy — `runThinArchive` reads every frame older than the full-res
window and `runAlertSnapshotRetention` reads the whole snapshot collection. So the
first scheduled run after deploy is also the big reclaim, and it lands within
~24h of the worker starting, unprompted. Expect it to remove:

- the zoom-gated nests older than 7 days, whole. MRMS alone has been adding ~720
  frames a day, so this is most of the `frame` namespace.
- the global bases older than 96h down to one frame per model + variable per day.
  GFS archives f000 and f003 per 6-hourly cycle, so ~8 frames a day per variable
  collapse to 1.
- alert stills older than 72h down to one per alert + kind per day, and
  everything past 30 days bar the aired keepsakes.

That is a large one-off delete on a live box: hundreds of thousands of small
files and Mongo docs, in chunks of 500, on the background tier. It is I/O-heavy
but await-bound, so the BullMQ lock renews normally, and it is crash-safe — bytes
go before the doc, so an interrupted run leaves a doc whose blob is already gone,
which the next run simply finishes off.

**If you want to choose the moment**, set `WEATHER_ARCHIVE_THIN=off` and
`ALERT_SNAPSHOT_RETENTION=off` before the first deploy, read the dry runs, then
clear them. Not required, just the difference between "it happens tonight" and
"it happens when I say".

**The extra reclaim (manual, optional, whenever)**

Two things the daily sweeps can never do for you, both on /admin/jobs:

1. **Duplicate alert imagery.** The daily keeper rule already collapses a day to
   one still, but byte-identical copies that landed on DIFFERENT days survive it.
   This finds them by hash and keeps the newest. Best run after the first
   retention sweep, on the smaller set.
2. **Orphaned blobs.** Files with no metadata doc at all are invisible to every
   sweep by definition, so only this finds them. Run it LAST — an interrupted
   prune is exactly what creates orphans, so sweeping earlier just misses them.

Each has a dry run. **Check /admin/files** between steps; it reports per-namespace
bytes and disk free, and is the honest scoreboard for this whole exercise. Then
**look at /admin/archive** for a day inside the full-res window and a day outside
it. That is the deliverable: the second one is what a thinned day looks like, and
if it is not enough, `WEATHER_ARCHIVE_FULLRES_HOURS` and `ALERT_SNAPSHOT_KEEP_DAYS`
are the two dials.

**Known first-run effects**

- Phase 0 ships a `pairKey` that existing compare snapshots do not carry, so the
  first compare sweep after deploy stores one fresh comparison per alert and then
  goes quiet. Expected, one-off.
- The seismic record starts empty and only ever holds events from the first boot
  onward, plus whatever was still inside the 31-day TTL window at that moment.
  Nothing before that is recoverable. /admin/archive says so rather than showing
  a misleading blank.
- The orphan sweep reports `basemap` as not swept, by design: it has no metadata
  collection, so an unrecognised key there is a live basemap, not garbage.
