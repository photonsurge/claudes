# Volcano Observation, Status & Media Ingest

## Context

Volcanoes already have a full ingest + cache: the Smithsonian/USGS Weekly Volcanic Activity
Report is upserted into one materialized Mongo doc per volcano, keyed on the stable VOTW number
`volcanoId = gvp:<vnum>` ([volcano-model.ts](../shared/src/db/volcano-model.ts),
[volcano-repo.ts](../shared/src/db/volcano-repo.ts), snapshot job
[jobs/volcanoes.ts:23](../worker/src/jobs/volcanoes.ts#L23)). A secondary USGS VONA "elevated"
feed patches near-real-time alert levels for US-monitored volcanoes
([usgs-vona.ts](../shared/src/volcanoes/usgs-vona.ts)); Wikipedia/Wikidata + an LLM bulletin
parse enrich each doc. The `Volcano` doc already carries `status`, a
change-only `statusChangedAt`, `usgsAlertLevel/usgsColorCode`, `reportVei/reportPlumeHeightM`.

**What's missing** (the R&D spec's ask): a volcano is a *continuously-maintained observation
object* — not just "current bulletin row." It should answer *what changed recently, what has the
observatory published this week, what does it look like now / earlier today / this week, what are
nearby instruments recording, is ash being reported* — with a **long-lived timeline** of official
status changes, **official notices**, **monitoring imagery + scientific plots** retained for
broadcast/timelapse, and **seismic context** — all surfaced on `/watch` and in admin.

Goal: give each volcano a **status timeline + snapshots**, exactly the way alerts already do it,
by **plugging into the existing unified `WatchedEvent` layer** rather than building a parallel
`volcano_*` stack. The pasted spec describes ~12 fresh PostgreSQL tables; this repo is
Mongo/Mongoose and *already has* the type-agnostic machinery those tables would duplicate.

### Deviations from the pasted spec (deliberate — read first)

- **Mongo, not PostgreSQL/PostGIS.** All "tables" become Mongoose models; geometry is GeoJSON +
  2dsphere; there is no PostGIS.
- **Reuse `WatchedEvent`, do not create a second volcano registry.** The spec's
  `volcano_observation_state / _status_snapshots / _notices / _timeline_items / _artifacts /
  _series` map onto the existing `Volcano` doc (current-state) + `watched_events` +
  `event_timeline_updates` + `event_snapshots` + `event_series` + `event_resources`. Both
  `docs/*-plan.md` set the explicit intent: **one system for all event types**. The
  [event acquisition plan](./event-update-acquisition-plan.md) build order step 7 already earmarks
  "quake promotion reusing `promoteFromAlert`" to prove *all types, one system* — volcanoes are
  the same move.
- **No FDSN `dataselect` path exists here.** Bounded waveform windows come from the SeedLink
  open/collect/close pattern in [seismo/snapshot.ts](../worker/src/seismo/snapshot.ts) +
  [miniseed.ts](../worker/src/seismo/miniseed.ts) (STEIM2), not `service.earthscope.org/.../dataselect`.
  The spec's dataselect URLs are for backfill only and are out of near-real-time scope.
- **USGS VSC endpoints are application-support APIs** with no support guarantee → every adapter
  ships timeouts + fixtures + schema guards + a raw-payload archive; UI never couples to a USGS
  payload shape.
- **Official-first source priority is a hard rule.** A third-party/news source **never overrides
  an official observatory status**; GODS never derives "eruption imminent / magma rising" from
  waveform metrics — only neutral statistics.

## Guiding decisions

- **The `Volcano` doc IS the materialized current-state** (like the `Alert` doc). It is refreshed
  in place by the existing `upsertMany`; history lives in `event_timeline_updates`, never on the
  doc. No `volcano_observation_state` collection.
- **Promotion is gated + significant-only.** A volcano becomes a `WatchedEvent` (type `VOLCANO`)
  only when it's actually interesting (`shouldPromoteVolcano`: erupting/unrest, USGS
  WATCH/WARNING, or aviation ORANGE/RED). Promoting every dormant bulletin entry would spawn
  thousands of dead watch schedules. Mirrors `shouldPromoteAlert`
  ([events/config.ts:17](../worker/src/events/config.ts#L17)).
- **Store-on-change, not store-on-poll.** A timeline beat is written **iff `diffVolcanoStatus`
  returns a non-empty change list.** No beat on first insert; `ISSUED`/`ENDED` synthesized on read
  by `buildEventTimeline`. The weekly GVP re-poll (unchanged for most volcanoes) therefore writes
  **zero** rows — the same discipline as the alert diff hook.
- **Preserve raw + normalized status.** Never pretend national alert schemes are equivalent. Keep
  `alertScheme` + `alertLevelRaw` verbatim (UI shows the official raw value); a normalized value
  (`normal|advisory|watch|warning|unrest|eruption|unknown`) is for scoring/filtering only.
- **All captured bytes on disk, reusing `event_snapshots` + `blobs.eventSnapshot`.** Camera
  frames, official plots, GODS-rendered waveforms and compare/timelapse frames are
  `event_snapshots` with a `kind` discriminator — one blob route
  ([api/events/snapshot/[snapId]](../public/src/app/api/events/snapshot/%5BsnapId%5D/route.ts)),
  one repo, one namespace. No new media route, no inline `Buffer`s.
- **On-air = the existing declarative slides.** Volcano cuts reuse `EventTimelinePanel` /
  `EventMediaPanel` via `modeSlides` — feed them from the FocusBundle event fields (already on the
  contract). No new broadcast component for Phase 0.

## Cross-cutting rules (apply throughout)

- Every `shared/src` edit → run `./update-shared` before worker/public see it.
- Every new/extended model ships a **strict-mode parity test** (mirror
  [broadcast-state-model.test.ts](../shared/src/db/broadcast-state-model.test.ts)) — Mongoose
  `strict:true` silently drops any interface field missing from the Schema literal.
- Any new writer of a `Volcano` doc **must bump `fetchedAt`** or the 14-day TTL
  ([volcano-model.ts:105](../shared/src/db/volcano-model.ts#L105)) silently expires it — see how
  `updateUsgsAlert` does it ([volcano-repo.ts:197](../shared/src/db/volcano-repo.ts#L197)).
- `sharp`/all image processing is **worker-only**; public only `<img>`s a media route + inline SVG.
- Reusable image modules (`satimg/{frame,compare,phash}.ts`) stay feature-agnostic; reuse, don't fork.
- Every package stays green under `./test`; keep files small; the pure modules below are the densest test targets.
- Whole feature lands **dark behind `EVENTS_UNIFIED_ENABLED`** (plus a volcano-specific
  `VOLCANO_OBSERVATION_ENABLED` for the media/source jobs) — the current volcano cache + overlay
  keep working untouched.

---

## PHASE 0 (P0) — Volcano status timeline (the shippable slice)

The "feels live" slice: significant volcanoes get a `WatchedEvent`, status changes become stored
timeline beats, and the timeline renders in admin + on-air — with **zero** new media/plot/source
infrastructure. Everything here is additive and flag-gated.

### 0.1 Vocabulary (modify shared, pure)
**Modified:** [events/types.ts](../shared/src/events/types.ts) — add `"VOLCANO"` to
`WatchedEventType`; add the volcano change beats to the `EventTimelineUpdateType` union:
`"ALERT_LEVEL_CHANGED" | "AVIATION_COLOR_CHANGED" | "ACTIVITY_CHANGED" | "VEI_CHANGED" |
"PLUME_CHANGED"`. (Reuses the existing `ISSUED|UPDATED|ENDED|SOURCE_LINKED|IMAGE_ADDED|
GRAPH_ADDED|SNAPSHOT_CAPTURED|SEISMIC_REVISION|CLOSED` beats for the later phases.)

### 0.2 Pure diff + normalization (new — the heart of P0)
**New:** `shared/src/volcanoes/diff.ts` (+ `.test.ts`), beside
[gvp.ts](../shared/src/volcanoes/gvp.ts).
- `VolcanoChange = { type: VolcanoChangeType; from?; to? }`;
  `VolcanoChangeType = "ALERT_LEVEL_CHANGED" | "AVIATION_COLOR_CHANGED" | "ACTIVITY_CHANGED" |
  "VEI_CHANGED" | "PLUME_CHANGED"`.
- `diffVolcanoStatus(prev, next) → VolcanoChange[]` over the fields the doc already holds:
  - **ALERT_LEVEL_CHANGED** — `status` (erupting/unrest/dormant) *or* `usgsAlertLevel`
    (NORMAL/ADVISORY/WATCH/WARNING) moved.
  - **AVIATION_COLOR_CHANGED** — `usgsColorCode` (GREEN/YELLOW/ORANGE/RED) moved.
  - **ACTIVITY_CHANGED** — `latestReport` text moved (content hash, so a re-published identical
    bulletin doesn't register). Reuse a small hash like
    [alertContentHash](../shared/src/alerts/content-hash.ts).
  - **VEI_CHANGED** / **PLUME_CHANGED** — `reportVei` / `reportPlumeHeightM` moved.
- `normalizeVolcanoStatus({ scheme, raw }) → "normal"|"advisory"|"watch"|"warning"|"unrest"|
  "eruption"|"unknown"` — a per-scheme lookup (`USGS_VOLCANO_ALERT_LEVEL`, `GEONET_VAL`, `GVP`);
  unknown schemes fall through to `unknown`, **never** guessed.
- Test matrix: one test per change type, `no-op re-poll → []`, `identical re-published bulletin →
  []`, USGS-scheme vs GVP-scheme normalization.

### 0.3 `Volcano` prev-capture (modify repo — no schema change)
`upsertMany` is a batch `bulkWrite` and can't return prior docs, so capture prev separately.
**Modified:** [volcano-repo.ts](../shared/src/db/volcano-repo.ts) — add
`listByIds(volcanoIds: string[]): Promise<Pick<iVolcano, statusfields>[]>` (one indexed
`{volcanoId: {$in}}` read projecting only the diffed fields). P0 needs **no new schema fields** —
`diffVolcanoStatus` reads columns that already exist. (Normalized `alertScheme/alertLevelNormalized`
persistence is deferred to Phase 1 where multi-source status actually populates it.)

### 0.4 Promotion bridge (modify shared, pure + repo)
**Modified:** [events/promote.ts](../shared/src/events/promote.ts) — add
`volcanoToWatchedEvent(v: Volcano): WatchedEventCore` (`type:"VOLCANO"`,
`primarySource:"gvp"`, `primarySourceId: v.id` (= `gvp:<vnum>`), `title: v.name`,
`repPoint:[v.lng,v.lat]`, `status` from normalized level: `eruption→ACTIVE`, ended when dormant) +
`volcanoTimelineUpdatesFromChanges(eventId, changes, at) → NewEventTimelineUpdate[]` (labels live
here, mirroring `timelineUpdatesFromChanges`). **Modified:**
[watched-event-repo.ts](../shared/src/db/watched-event-repo.ts) — add `promoteFromVolcano(v, now)`
mirroring `promoteFromAlert` ([:35](../shared/src/db/watched-event-repo.ts#L35)): idempotent upsert
on `(primarySource:"gvp", primarySourceId)`, `created` true only on first insert.

### 0.5 Ingest hook (modify worker — store-on-change, flag-gated)
**Modified:** [jobs/volcanoes.ts#snapshot](../worker/src/jobs/volcanoes.ts#L23) — after
`upsertMany`, behind `eventsUnifiedEnabled()`:
```
const prev = keyBy(await db.volcanoes.listByIds(volcanoes.map(v => v.id)), "volcanoId");
for (const v of volcanoes) {
  if (!shouldPromoteVolcano(v)) continue;                 // significant only
  const changes = diffVolcanoStatus(prev[v.id], v);       // [] on first-seen / unchanged
  const { eventId, created } = await db.watchedEvents.promoteFromVolcano(v, now);
  const beats = created
    ? [issuedBeat(eventId, v, now)]
    : volcanoTimelineUpdatesFromChanges(eventId, changes, now.toISOString());
  if (beats.length) await db.eventTimeline.appendMany(beats);
  await db.eventWatch.upsert({ eventId, source: "gvp", intervalSeconds: cadenceForVolcano(v) });
}
```
Also run it in `snapshotUsgs` (the fresher US alert-level path), so a USGS WATCH→WARNING between
weekly bulletins produces a beat. `diffVolcanoStatus` is pure and every `db.*` call is a fake-repo
method → the handler stays unit-testable. **Modified:**
[events/config.ts](../worker/src/events/config.ts) — add `shouldPromoteVolcano(v)` +
`cadenceForVolcano(v)` (RED/ORANGE cadence for erupting/warning).

### 0.6 Surface via FocusBundle + admin (modify public)
The FocusBundle contract already carries a `volcano` target and the `watchedEvent / eventTimeline`
fields — Phase 0 only *populates* them for a volcano cut.
- **Modified:** [getFocusBundle.ts](../public/src/lib/focus/getFocusBundle.ts) — in the existing
  volcano branch (`db.volcanoes.get(subject)`), also
  `watchedEvents.byPrimary("gvp", volcanoId)` → `eventTimeline.listForEvent(eventId)` →
  `buildEventTimeline(event, updates, now)`; populate the same `watchedEvent`/`eventTimeline`
  fields the storm branch already fills. One extra pair of indexed reads on volcano cuts only.
- **Modified:** [mode-slides.tsx](../public/src/components/broadcast/mode-slides.tsx) — add the
  volcano segment kind to the existing event-timeline / event-media slide guard (reuse
  `EventTimelinePanel`; there's already a `volcano-facts` slide precedent). No new component.
- **Admin:** add a "Status timeline" card to the volcano detail panel in
  [VolcanoesTable.tsx](../public/src/components/volcanoes/VolcanoesTable.tsx) rendering the beats
  (glyph + relative time + label). (Fix the stale "NASA EONET" copy in
  [admin/volcanoes/page.tsx](../public/src/app/admin/volcanoes/page.tsx#L14) while here.)

**P0 verification:** `./update-shared`; set `EVENTS_UNIFIED_ENABLED=true`; `yarn refresh:volcanoes`
twice (mutate a fixture's status between runs) → the volcano's `WatchedEvent` gains an
`ALERT_LEVEL_CHANGED` beat, visible on the admin card and — with a volcano on air via the director —
in the left-deck timeline slide. A steady re-poll writes **zero** beats.

---

## PHASE 1 (P1) — Official multi-source status + notices

Widen status beyond the weekly GVP bulletin to official observatory feeds, and harvest official
bulletins as notices. Official-first priority is enforced here.

### 1.1 Source registry + links (new, lightweight)
**New:** `shared/src/db/volcano-source-link-model.ts` + repo — map `volcanoId` → external ids
(`{ volcanoId, sourceId, externalId, externalCode?, externalUrl?, matchMethod, isPrimary }`,
unique `(sourceId, externalId)`). Matching (`gvp_id | provider_crosswalk | coordinate | manual`)
is a **discovery process** run once and persisted — never re-fuzzy-matched every poll. Source
capabilities/attribution/licence live in a config module
(`worker/src/volcanoes/sources/registry.ts`), not a DB row, until we need per-source health rows.

### 1.2 Official status adapters (new)
Each adapter `{ fetch, parse, normalize }`, env-gated, fixture-backed, schema-guarded, with a raw
payload archive (USGS VSC = unsupported API). Feed normalized status onto the `Volcano` doc via a
new `updateOfficialStatus(volcanoId, {scheme, raw, normalized, aviation, activity, effectiveAt})`
repo method (bumps `fetchedAt`), then the P0 diff/promote hook runs on the result.
- **USGS VHP** (`usgs-vhp.ts`) — `.../volcanoApi/geojson` (all US status + aviation colour +
  observatory) as the principal US status adapter; keep VONA `elevated`
  ([usgs-vona.ts](../shared/src/volcanoes/usgs-vona.ts)) as the fast secondary. Poll 5 min.
- **GeoNet** (`geonet.ts`) — `/volcano/val` (`Accept: application/vnd.geo+json;version=2`) →
  `GEONET_VAL` scheme, raw level preserved. Also `/volcano/quake/{id}` (source-defined vicinity,
  60 days) → link into the existing quake cache (don't rebuild NZ's polygon logic). Poll 5/10 min.
- **GVP weekly CAP** — keep [gvp.ts](../shared/src/volcanoes/gvp.ts); additionally extend it into
  **notices** (§1.3). Never treat GVP *absence* as "normal" (Thursday-only, not a status feed).
- **GDACS volcano resolver** — **do not** add a second GDACS adapter. After normal GDACS ingest
  ([alerts/gdacs.ts](../worker/src/alerts/gdacs.ts)), resolve `VO` events → `volcanoId` → a
  `SOURCE_LINKED` beat + interest signal on the volcano's `WatchedEvent`. GDACS is an
  impact/escalation signal, **never** the canonical alert level.
- Regional observatories (IMO, PHIVOLCS, PVMBG/MAGMA, INGV, SERNAGEOMIN/OVDAS, JMA, IG-EPN,
  INSIVUMEH, OVSICORI…) are an **adapter backfill programme** in modes `api | feed |
  deterministic_product | official_page` (page-scrape is last resort). Seed registry config now;
  implement per-observatory as capacity allows. First four (USGS/GeoNet/GVP/GDACS) are the actual P1.

### 1.3 Notices (new — reuse `event_resources` + beats)
Official bulletins/VONA/reports become `event_resources`
([alert-resource pattern](../shared/src/db/alert-resource-model.ts) → the event twin) with
`kind:"report"`, original text + attribution + licence, `rebroadcastSafe` default per source, plus
a `REPORT_ADDED` beat. Generated summaries (OpenRouter,
[lib/openrouter.ts](../worker/src/lib/openrouter.ts)) are stored **separately** from the source
record. Dedup on content hash.

---

## PHASE 2 (P2) — Official live images (cameras)

Official cameras are first-class monitoring instruments, not tourism webcams.

### 2.1 Camera registry (extend the generic Cam model)
**Modified:** [cam-model.ts](../shared/src/db/cam-model.ts) — add `provider` values
`geonet | usgs-vhp | ingv`, plus volcano-specific optional fields (`volcanoId`, `cameraType:
visual|thermal|infrared|pan_tilt_zoom`, `azimuthDeg?`, `roi?`, `viewMayChange?`). `tags:["volcano",
volcanoId]` + the existing `nearMany` already answer "cameras near this volcano." (A separate
`volcano_cameras` model only if these bloat the shared schema — start by extending.) Seed from
official metadata feeds, never a hard-coded list: GeoNet `images.geonet.org.nz/volcano/cameras/
all.json`; USGS VHP webcam catalogue (daily refresh); INGV Etna/Stromboli/Vulcano deterministic
products.

### 2.2 Frame capture + retention
**New:** `worker/src/jobs/volcanoes.ts#snapshotCameras` (or a dedicated `volcano-media.ts` job) —
model on [jobs/alerts.ts#snapshotCameras](../worker/src/jobs/alerts.ts#L250): fetch each active
camera's latest image, `pHash` ([satimg/phash.ts](../worker/src/satimg/phash.ts)) dedup, store
`event_snapshots kind:"camera"` on disk (`blobs.eventSnapshot`). **`captured_at` = source image
timestamp**, never fetch time (priority: source metadata → archive key → printed → Last-Modified →
fetchedAt). Cadence matches upstream (GeoNet 10 min → poll 5, store on change).
- **Illumination ≠ quality**: a night/dark/thermal frame can carry incandescence/glow/lightning —
  classify `illumination (day|twilight|night|dark|thermal)` separately from `qualityScore`; grade
  glow/change within an optional per-camera ROI. Reuse [satimg/grade.ts](../worker/src/satimg/grade.ts)
  brightness math; add a small day/night classifier.
- **Retention policy** (a policy, not a cleanup script): 0–30 days retain **every** unique valid
  frame; >30 days retain one best **daytime** + one best **night/dark** frame per camera per
  camera-local day, plus unconditionally any event-significant / pinned / notice-linked /
  status-change-window frame. Thermal cameras thin to best + highest-change per day. Event windows:
  status change −6h/+24h, eruption −6h/+48h, aviation RED −12h/+48h.

### 2.3 Camera media on-air
Reuse `EventMediaPanel` (`<img src=/api/events/snapshot/{id}?v={capturedAt}>`); nearby-camera panel
via `db.cams.nearMany`. Presentational only, no sharp in public.

---

## PHASE 3 (P3) — Official scientific plots + series

### 3.1 Plot artifacts (reuse `event_snapshots`)
Store official plots as `event_snapshots` with plot `kind`s (`waveform|webicorder|spectrogram|
rsam|ssam|drum|deformation|gas|thermal|quake`), archiving the upstream image (don't hot-link) +
normalized metadata (network/station/channel/plotType) + a `GRAPH_ADDED` beat.
- **USGS station plots** — `.../volcanoApi/volcanoStationPlots/{GVP}` (major P0-of-this-phase win:
  nearby stations + recent plots). Poll 5 min elevated / 15 min others.
- **GeoNet drums / RSAM / SSAM** — official monitoring products as plot artifacts.
- **INGV / IMO tremor·strain·deformation** — separate capabilities per measurement (don't merge
  into one "activity chart"); the UI names the actual measurement.

### 3.2 Numeric series (reuse `event_series`)
Where machine-readable data exists (GeoNet data services, INGV numeric), ingest into `event_series`
([alert-series pattern](../shared/src/db/alert-series-model.ts)). **Neutral metrics only** — current
value, rolling median, local 24h percentile, absolute/relative change, data availability. **No**
derived `eruptionProbability`. Never read values off chart pixels for production.

---

## PHASE 4 (P4) — Seismic waveforms (reuse existing FDSN/SeedLink)

**Do not** write a `volcano-fdsn.ts`. Reuse [seismo/fdsn.ts](../shared/src/seismo/fdsn.ts)
(station metadata), [seedlink-client.ts](../worker/src/seismo/seedlink-client.ts) +
[miniseed.ts](../worker/src/seismo/miniseed.ts) (STEIM2), and the open/collect/close window in
[seismo/snapshot.ts](../worker/src/seismo/snapshot.ts).
- **New:** `shared/src/db/volcano-station-link-model.ts` — associate `volcanoId` → `(net, sta, loc)`
  with `distanceKm`, `associationSource (official_volcano_product | provider_volcano_station |
  distance | manual)`, `rank`, `preferredChannels`. Rank officially-linked stations first, then
  distance/availability — never the closest blindly.
- GODS-rendered plots (6h waveform, 24h webicorder, 6h spectrogram + neutral stats) are labelled
  **"GODS derived from {SOURCE} waveform data"**, stored `event_snapshots` with processing metadata
  + `dataCompleteness`; raw MiniSEED chunks kept separately (object-backed, not row-per-sample).
  Use SeedLink for continuous, dataselect (if ever) only for bounded backfill.

---

## PHASE 5 (P5) — Image retention sweeps + timelapse

- **Retention sweep** — a repeatable job enforcing §2.2 (a policy, applied continuously), reusing
  the blob delete-before-doc-drop discipline of
  [weather-texture-repo.ts:55](../shared/src/db/weather-texture-repo.ts#L55) so disk never orphans.
- **Daily timelapse** — after the camera-local day closes, order retained frames by `captured_at`
  (keep night frames), encode H.264 ≤1080p, ~10–20s @30fps; frame *duplication* to hit duration is
  fine, AI frame interpolation is out of scope. **Event timelapse** — triggered by status/aviation
  change / eruption notice / major visual-change / manual pin, window stays open until it closes;
  `/watch` may show a provisional rolling 6h/24h clip while collecting.

---

## PHASE 6 (P6) — Discovery/enrichment (last, per spec stage 7)

Only after 0–5: official news/press feeds, GDELT discovery, public-domain photography, satellite
SO2/thermal-anomaly + VONA/VAAC ash enrichment. This layer feeds **discovery + timeline
enrichment**; it **does not own primary status.**

---

## Reuse map

`WatchedEvent` idempotency ← `promoteFromAlert` · promotion mapping ← `promote.ts` (add
`volcanoToWatchedEvent`) · timeline beats ← `event_timeline_updates` + `buildEventTimeline` +
exported `labelFor` · media + route ← `event_snapshots` + `api/events/snapshot` +
`blobs.eventSnapshot` + `satimg/{frame,compare,phash,grade}.ts` · notices/resources ←
`event_resources` (alert-resource twin) · numeric series ← `event_series` (alert-series) · watch
scheduler ← `event_watch_schedules` + `events.watch/acquire` + `cadenceForRank` · cameras ←
`cam-model`/`cam-repo.nearMany` · seismic ← `seedlink-client` + `miniseed` + `seismo/snapshot.ts` ·
prose ← `callOpenRouter` · parity tests ← `broadcast-state-model.test.ts` / `alert-revision-model.test.ts`.

## Risks & mitigations

1. **Write volume / timeline noise** — beat written only on non-empty `diffVolcanoStatus`; no beat
   on first insert; ISSUED/ENDED synthesized on read; promotion gated to significant volcanoes.
   Verify a steady re-poll writes zero beats and creates zero new events.
2. **Batch prev-capture race** — `listByIds` reads *before* `upsertMany`, diff runs *after*, so
   the diff is prev-vs-persisted (not prev-vs-prev). Cover with a unit test.
3. **TTL expiry of tracked volcanoes** — any new `Volcano` writer bumps `fetchedAt`; a promoted
   `WatchedEvent` must not resurrect an expired volcano (event `status→ENDED` when the volcano doc
   lapses).
4. **Official-vs-third-party precedence** — normalized status is only ever set from official
   adapters; GDACS/news write beats/links, never the alert level. Enforced in the repo method
   surface (no `updateOfficialStatus` call path from a news adapter).
5. **USGS VSC instability** — fixtures + schema guards + raw archive + adapter isolation; UI reads
   the normalized `Volcano`/event fields, never a USGS payload shape.
6. **Illumination misclassification** — never reject dark/thermal frames as "bad"; classify
   illumination separately from quality; ROI-scope glow metrics; conservative `pHash` dedup so a
   real slow plume change is kept over a near-dup.
7. **BSON / disk** — all bytes via `blobs.eventSnapshot`; keep the inline-fallback size guard.
8. **Lands dark** — `EVENTS_UNIFIED_ENABLED` + `VOLCANO_OBSERVATION_ENABLED`; the existing volcano
   cache, overlay and all tests stay green with flags off.

## Verification

- **Unit (`./test`, stays green):** `volcanoes/diff.test.ts` (each change type, no-op/identical →
  `[]`, scheme normalization); `promote.test.ts` (volcano→event mapping, changes→beats);
  parity tests for every new model; a `jobs/volcanoes` test asserting (a) no beat on first-seen,
  (b) one beat on a status change, (c) zero on an unchanged re-poll, (d) bridge no-ops when
  `EVENTS_UNIFIED_ENABLED` off. Confirm existing volcano + storm-focus + mode-slides suites still pass.
- **End-to-end (local, no Docker; user runs the one-shots — don't kill dev processes):**
  `./update-shared`; `EVENTS_UNIFIED_ENABLED=true`; `yarn refresh:volcanoes` twice with a mutated
  fixture → `/admin/volcanoes` detail shows the status-timeline card; put a volcano on air → the
  event-timeline slide rotates into the left deck. Later phases: seed a GeoNet/USGS camera + run
  the media job → `/api/events/snapshot/{id}` serves the frame and the media slide renders.

## Build order (thin end-to-end first)

**P0 first — land + verify the status-timeline slice** (vocab → diff → prev-capture → promote →
ingest hook → focus/admin surfacing). Then **P1** official multi-source status + notices (USGS VHP,
GeoNet, GVP notices, GDACS resolver), **P2** cameras + retention, **P3** official plots + series,
**P4** seismic waveforms, **P5** retention sweeps + timelapse, **P6** discovery/enrichment. Each
phase is independently shippable and flag-gated.
