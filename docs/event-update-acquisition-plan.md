# Unified WatchedEvent + External-Source Acquisition

## Context

The "easy wins" alert-timeline feature already shipped a full per-**alert** acquisition
pipeline (revisions, field/geometry diff, derived timeline, GDACS metric series, resource
links, satellite/camera/compare snapshots on disk) — all keyed `(source, identifier)`.

The new goal is broader: stop treating detection as one-shot ingest, and instead let **every
event type** (weather alert, cyclone, flood, wildfire, drought, earthquake) become a
**WatchedEvent** with a continuously-growing, cross-source **timeline** — where a single
physical disaster gathers a GDACS alert *and* deep-GDACS episode data *and* ReliefWeb situation
reports *and* Copernicus EMS maps *and* an EONET geometry cross-ref, all appending to one shared
dossier. Per the steer: **one unified system / the same collections and the same rich-timeline
machinery for all event types** (not alert-only silos), and **start the build on Phase 4 —
external multi-source acquisition**. Phase 4 is inherently multi-source, so it forces the unified
`WatchedEvent` layer to land first (or alongside).

This is additive and migration-free: the shipped alert pipeline keeps working untouched; the new
event layer sits *over* it via a nullable `eventId` back-ref + a promotion bridge, all gated behind
`EVENTS_UNIFIED_ENABLED` so it can land dark. See also `docs/alert-update-timeline-plan.md` (the
predecessor easy-wins feature this builds on).

### Carry-forward hard rules (from the easy-wins work)
- All `/watch` data flows through the **one focus call** (FocusBundle) — no per-cut fetches.
- All captured bytes stored **on disk** via `${BLOB_DIR}` (`makeInlineBlobStore`), referenced from
  Mongo — never inline `Buffer`s.
- All `sharp`/image processing is **worker-only**; public only `<img>`s a media route + inline SVG.
- Reusable image modules (`satimg/{frame,compare,phash}.ts`) stay feature-agnostic.
- Every new shared model ships a **strict-mode parity test** (mirror `broadcast-state-model.test.ts`);
  every package stays green under `./test`; keep files small; run `./update-shared` after `shared/src` edits.

---

## Architecture (the resolved branch points)

- **Storage:** introduce generic **event-keyed** collections for all new cross-source data
  (`watched_events`, `event_sources`, `event_source_revisions`, `event_timeline_updates`,
  `event_external_links`, `event_resources`, `event_series`, `event_snapshots`) **and** add a
  nullable `eventId?` + sparse index to the four existing `alert_*` collections. The event view then
  *unions* alert-native media (already on disk) with cross-source media **without copying bytes**.
  A full re-key of `alert_*` → `event_*` is rejected (destructive, re-indexes hundreds of thousands
  of docs, breaks green tests).
- **Timeline = STORED rows** (`event_timeline_updates`), because many contributors feed one timeline
  (source diffs, satellite captures, resource additions, reports) — you cannot re-derive them from a
  single alert. The promotion bridge converts the `AlertChange[]` that `ingestSource` **already
  computes** into stored rows (no second diff); adapters append their own rows; a read-time builder
  synthesizes head (`ISSUED`) + tail (`ENDED`) — reusing `buildTimeline`'s synth/label logic by
  exporting `labelFor` from `shared/src/alerts/timeline.ts`.
- **Scheduler = durable collection + one sweeper.** `event_watch_schedules` holds per-`(eventId,source)`
  cadence; a single repeatable `events.watch` tick sweeps due rows and dispatches `events.acquire` via
  `sendToQueue(..., delayUntil, priority)` (the delayed-one-shot primitive already exists but is unused
  in prod). Per-event cadence lives in Mongo, so an event burst does **not** spawn a repeatable each.
  `ingestSource` stays **bull-free** — it only writes schedule rows; the job wrapper does all enqueue.
- **Queues:** there is ONE physical BullMQ queue. Realize the spec's four lanes as logical `type.event`
  routing + `QUEUE_PRIORITY`: `events.watch`/`events.acquire` = NORMAL, `events.snapshotEvent`/
  `events.render` = LOW. "Never render in the poller" is structural — `acquire` never runs `sharp`; it
  enqueues a LOW render job (exactly like `jobs/alerts.ts` enqueues `snapshotSatellite`). (Four *physical*
  queues would be a separable `shared/src/bull/bull.ts` change — deferred.)
- **Matching:** only `EXPLICIT_ID`/`GLIDE` auto-link; `DERIVED` (country+hazard+date) below a score
  threshold stays a candidate for `MANUAL` confirm in admin. `event_external_links` unique on
  `(eventId,source)` and `(source,externalId)` → **never re-fuzzy-match**.

---

## Phase 0 — Unified foundation (shared)

New pure logic `shared/src/events/` (each with `.test.ts`):
- `types.ts` — `WatchedEventType`, `WatchedEventStatus`, `EventTimelineUpdateType`
  (`ISSUED|UPDATED|ENDED|<AlertChangeType…>|SOURCE_LINKED|REPORT_ADDED|PRODUCT_ADDED|MAP_ADDED|
  GEOMETRY_REFINED|SNAPSHOT_CAPTURED|CLOSED`), `MatchMethod`.
- `promote.ts` — pure `alertToWatchedEvent(a): NewWatchedEvent` (GDACS `gdacsEventType`/CAP `event` →
  type; geometry via `unionBboxOfAlert`/`alertRepPoint`; `primarySource/Id=(source,identifier)`) +
  `timelineUpdatesFromChanges(eventId, changes, at)` (reuses exported `labelFor`).
- `event-timeline.ts` — `buildEventTimeline(event, updates)` (sort stored rows + synth head/tail).

New models/repos/tests `shared/src/db/` (parity test each, mirror `alert-revision-model.test.ts`;
clone the repo idioms of `alert-{revision,series,resource,snapshot}-*`):
- `watched-event-*` — unique `(primarySource,primarySourceId)` (idempotency key), `2dsphere` repPoint,
  `(status,watchUntil)` sweep index. Repo `promoteFromAlert(alert,changes,now)→{eventId,created}`,
  `byPrimary`, `getById`, `list({bbox,status})`.
- `event-source-*` (latest normalized per `(eventId,source)`, `payloadHash`) ·
  `event-source-revision-*` (append-only `seq` per `(eventId,source)`, `diff{changedFields,before,after}`) ·
  `event-timeline-update-*` (stored beats, dedup `(eventId,type,payloadHash)`, `appendMany`/`listForEvent`) ·
  `event-external-link-*` (unique `(eventId,source)`+`(source,externalId)`) ·
  `event-resource-*` (clone of `alert-resource-*` + `attribution`/`license`/`rebroadcastSafe=false`) ·
  `event-series-*` (clone of `alert-series-*`, key `${eventId}:${source}:${metric}`) ·
  `event-snapshot-*` (clone of `alert-snapshot-*`, bytes on disk via new `blobs.eventSnapshot`,
  `slotKey=${eventId}:${kind}:${layer}:${hourSlot}`) ·
  `event-watch-schedule-*` (`nextCheckAt`,`intervalSeconds`,`failureCount`; `due(now,limit)`,
  `reschedule(eventId,source,{intervalSeconds,ok})`, `upsert`).

Modify shared:
- `alert-{revision,series,resource,snapshot}-model.ts` — add nullable `eventId?` + sparse index; extend
  each parity sample.
- `alerts/timeline.ts` — `export labelFor` (no behavior change).
- `db/index.ts` — `blobs.eventSnapshot = makeInlineBlobStore("event-snapshot", blobFs)`; wire the nine new
  repos into the facade. Then `./update-shared`.

## Phase 1 — Alert→Event promotion bridge (worker, migration-free)

`worker/src/alerts/ingest.ts` — after the existing revision `append` (where `events`, `prev`, `a`, `now`
are already in scope), behind `EVENTS_UNIFIED_ENABLED`: `promoteFromAlert(a, events, now)` →
`eventTimeline.appendMany(timelineUpdatesFromChanges(...))` → back-fill `eventId` onto this alert's
revision/series/resource/snapshot rows (`updateMany` on `(source,identifier)`) →
`eventWatch.upsert({eventId, source, intervalSeconds: cadenceForRank(maxSeverityRank)})`. On first insert
emit `ISSUED`/`SOURCE_LINKED`. Stays **bull-free**; new `eventId`s returned in `IngestResult` (mirrors
`newlyInteresting[]`) so the job can fire an onset acquire. Reuses `promote.ts` + the already-computed
`diffAlert` output (no extra HTTP, no second diff). Same `promoteFromAlert` shape later serves quakes.

## Phase 2 — Per-event watch scheduler (worker)

`worker/src/jobs/events.ts` (auto-discovered type `events`):
- `watch(job)` — sweep `eventWatch.due(now, BATCH)` → `sendToQueue("events","events","acquire",{eventId,
  source},undefined,NORMAL)`; cadence RED 2m / ORANGE 5m / GREEN 15m via `cadenceForRank`, decayed by event
  age.
- `acquire(job)` — dispatch by `data.source` to the adapter (`fetch→normalize→persist`
  EventSource/Revision + EventResource + EventTimelineUpdate, conditional on `payloadHash`), then
  `eventWatch.reschedule(...,{ok})`. Never renders — enqueues LOW `events.render`/`snapshotEvent` when a
  preview is warranted.
`worker/src/index.ts` — one repeatable `events.watch` (`every EVENTS_WATCH_TICK_MS`,
`staggerOffset("events-watch",…)`), gated `EVENTS_UNIFIED_ENABLED !== "false"`.

## Phase 3 — External-source adapters (the starting deliverable)

New `worker/src/events/`; each adapter `{fetch, matcher, normalize}`, env-gated, `payloadHash`-conditioned;
`registry.ts` mirrors `alerts/registry.ts` (dispatched by `events.acquire` on `data.source`). Build order:
1. **deep-GDACS** (`gdacs-detail.ts`) FIRST — we already hit GDACS; `eventtype`+`eventid` are on the
   alert `identifier`/`raw.properties` → `geteventdata`/episode endpoints; matcher = `EXPLICIT_ID` link.
   Extends `alerts/gdacs-extras.ts` promote-from-raw; writes EventSource + EventResource (maps/reports,
   attribution) + EventTimelineUpdate; cadence off `alertlevel`.
2. **ReliefWeb** (`reliefweb.ts` + `reliefwebMatcher.ts`) — match by GDACS/GLIDE id → country+hazard+date
   window → `EventExternalLink{matchMethod,matchScore}`; poll reports → `REPORT_ADDED` + EventResource with
   `attribution`/`license` stored, `rebroadcastSafe=false`. Needs `RELIEFWEB_APPNAME`; self-disables without it.
3. **Copernicus EMS** (`copernicus.ts` + `copernicusMatcher.ts`) — activation match → poll AOIs/products →
   EventResource map links + optional LOW `events.render` preview (reuse `satimg/frame.ts`/`compare.ts`,
   bytes → `blobs.eventSnapshot`) where licensing permits.
4. **EONET** (`eonet.ts`) — cheap cross-ref: source discovery, geometry history, closure, GIBS-layer hint →
   `EventExternalLink(DERIVED)` + EventSource + `GEOMETRY_REFINED`/`CLOSED` beats.

## Phase 4 — Surfacing (public + admin)

- `focus/getFocusBundle.ts` — for a storm target, resolve `eventId` (`watchedEvents.byPrimary`), then
  `Promise.all` `eventTimeline/eventResources/eventSeries/eventSnapshots/eventSources` +
  `buildEventTimeline`; union with existing alert reads (nothing regresses). Still the ONE focus call.
- `focus/types.ts` — add `watchedEvent|null` + `eventTimeline/eventResources/eventSnapshots/eventSeries/
  eventSources` (empty when N/A). `focus-client.tsx` — `useEvent*` selectors beside `useAlert*`.
- `broadcast/{mode-slides,AlertTimelinePanel,AlertMediaPanel}.tsx` — feed panels from event fields (fall
  back to alert fields); panels stay presentational.
- `api/events/snapshot/[snapId]/route.ts` (new) — clone of the alert snapshot route (`eventSnapshots.getPng`,
  FS-first).
- Admin `admin/events/page.tsx` + `admin/events/[id]/page.tsx` (new) — list + detail mirroring
  `/admin/alerts/[id]` (timeline, sources & revisions, external links w/ matchMethod+score, resources w/
  attribution/license, snapshots grid).

---

## Reuse map
WatchedEvent idempotency ← `alerts-repo.upsert` dedup key · `event_source_revisions.append` ←
`alert-revision-repo` · `event_series` ← `alert-series-repo` · `event_resources` ←
`alert-resource-repo.upsertMany` · `event_snapshots`+media route ← `alert-snapshot-repo` +
`api/alerts/snapshot` + `blobs.*` + `satimg/{frame,compare,phash}.ts` · timeline gen ← `diffAlert` output +
exported `labelFor`; read builder ← `buildTimeline` · geometry ← `unionBboxOfAlert`/`padBbox`/
`polygonAreaKm2`/`alertRepPoint` · scheduler ← `sendToQueue(delayUntil)` + `staggerOffset` · deep-GDACS ←
`gdacs.ts` + `gdacs-extras.ts` · parity tests ← `alert-revision-model.test.ts`.

## Risks & mitigations
- **Idempotency / double-fire** — unique keys on WatchedEvent `(primarySource,primarySourceId)`,
  ExternalLink, WatchSchedule; timeline dedup `(eventId,type,payloadHash)`; promotion is an upsert
  (safe under concurrency 10).
- **Timeline noise / write volume** — adapters write a revision/beat only when `payloadHash` changes
  (the `alert-series` dedup discipline); series/snapshots carry TTLs.
- **Matcher false positives** — never auto-merge on fuzzy; store `matchMethod`+`matchScore`; only
  explicit/GLIDE auto-link; DERIVED needs MANUAL confirm.
- **Attribution / licensing** — `event_resources` default `rebroadcastSafe=false`; on-air gates rendering
  on it (ReliefWeb/Copernicus are reference links, not auto-rebroadcast-safe).
- **BSON / disk** — all bytes via `blobs.eventSnapshot`; keep the `SNAP_MAX_BYTES` inline-fallback guard.
- **Migration-free** — additive `eventId?` + new collections only; everything gated `EVENTS_UNIFIED_ENABLED`
  so it lands dark; the alert pipeline + storm focus branch + all tests stay green.

## Build order (thin end-to-end slice first)
1. Foundation models/repos/tests + `events/{types,promote,event-timeline}.ts` + `db/index.ts` wiring +
   `./update-shared`.
2. Promotion bridge in `ingest.ts` (behind flag) → WatchedEvents exist for every interesting alert; verify
   on a new `/admin/events`.
3. deep-GDACS adapter + `events/registry.ts` + `jobs/events.ts` (`watch`+`acquire`) + the `events.watch`
   repeatable → **first full slice** (promote → schedule → acquire GDACS detail → timeline/resources on a
   WatchedEvent → surfaced on `/watch` + `/admin/events/[id]`).
4. ReliefWeb → 5. Copernicus EMS → 6. EONET.
7. (Follow-up) Quake promotion reusing `promoteFromAlert` in `snapshotSeismic` — proves "all types, one system"
   and sets up the later Phase-3 seismic-detail work (USGS ComCat products, waveform windows, revision graphs).

## Verification
- **Unit (`./test`, must stay green):** parity tests for all nine new models; `promote.test.ts`
  (alert→event mapping, changes→beats), `event-timeline.test.ts` (synth head/tail + sort), matcher tests
  (explicit/GLIDE/derived + no re-match), an `ingest` test asserting idempotent promotion (one WatchedEvent
  on re-poll, `eventId` back-filled, bridge no-ops when flag off). Confirm the shipped alert suites + storm
  focus/mode-slides tests still pass (non-regression).
- **End-to-end (local, no Docker; user runs the one-shots):** after `shared/src` edits `./update-shared`;
  set `EVENTS_UNIFIED_ENABLED=true`; `yarn ingest:alerts` twice → `/admin/events` shows promoted WatchedEvents
  with mirrored timelines. Run the deep-GDACS acquire (a `refresh:events` one-shot script mirroring
  `refreshAlertSnapshots`) → `/admin/events/[id]` shows GDACS detail sources/resources/beats. Put a GDACS storm
  on air → the timeline/media slides render from the event fields via the focus call. Then ReliefWeb (needs
  `RELIEFWEB_APPNAME`) / Copernicus / EONET behind their env gates.
