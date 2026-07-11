# Alert Update / Timeline — "Easy Wins"

## Context

Weather alerts are stored **one Mongo doc per CAP message**, keyed `(source, identifier)` in
[alert-model.ts](../shared/src/db/alert-model.ts). Every ingest tick,
[alerts-repo.ts:42](../shared/src/db/alerts-repo.ts#L42) `upsert()` does an **in-place `$set`** — so for the
two GLOBAL sources (WMO + GDACS, covering ~all non-US/non-EU alerts), which use *stable identifiers* and
*empty CAP `references`*, each re-poll silently overwrites the prior version and **no history survives**.
Only NWS + MeteoAlarm carry real CAP `references`, so only they get a timeline today via `db.alerts.chain()`.

Goal: capture alert revisions and build a **live timeline of meaningful changes** ("SEVERITY INCREASED",
"AREA EXPANDED +52%", "WARNING ENDED"), plus harvest official resources, satellite snapshots, and
nearby-camera snapshots — without any complex event-correlation subsystem. Surface it in **admin** (extend
`/admin/alerts/[id]`) and **on-air** (a new declarative slide in the left-column deck). Full P0→P2 scope.

## Guiding decisions

- **4 new collections, not 5.** `alert_timeline` is **not stored** — the timeline is a *pure derived read*
  (`buildTimeline`) that both admin and on-air call, so they can never disagree. Camera snapshots fold into
  `alert_snapshots` via a `kind` discriminator (one blob route, one repo). New collections:
  `alert_revisions`, `alert_series`, `alert_resources`, `alert_snapshots`.
- **Revision capture is orchestrated in `ingestSource`, not buried in `upsert()`.** Keeps the repo focused
  and defeats the double-fire + geometry-strip false-diff risks at once (see Risks).
- **Volume control:** a revision is written **iff `diffAlert` returns a non-empty event list.** No revision
  on first insert; `ISSUED` and `ENDED` beats are *synthesized on read*. Steady-state WMO re-polls
  (hundreds of alerts every 10 min) therefore write **zero** rows.
- **On-air = a declarative slide:** add to `modeSlides` (not `BroadcastFrame`), mirror an existing slide.
  On-air timeline reads the new `alert_revisions` (WMO/GDACS have no CAP chain — that's the whole gap),
  merged with the chain for NWS/MeteoAlarm.

## Cross-cutting rules (apply throughout)

- Every `shared/src` edit → run `./update-shared` before worker/public see it (build shared `dist` + copy
  into each package's `node_modules`; don't hand-copy).
- Every new model ships a **STRICT-MODE parity test** (mirror
  [broadcast-state-model.test.ts](../shared/src/db/broadcast-state-model.test.ts)): any interface field
  missing from the Schema is silently dropped on write.
- Every package stays green under `./test` (jest + RTL); the pure modules below are the densest test targets.
  Keep files small.
- Wire each new collection with **one line** in `createDb()` in [db/index.ts](../shared/src/db/index.ts).

---

## PHASE 0 (P0) — Revisions + diff + derived timeline + geometry

### 0.1 Geometry helpers (new, pure — no turf exists in repo)
**New:** `shared/src/geo/polygon.ts` (+ `.test.ts`), beside existing
[pointInPolygon.ts](../shared/src/geo/pointInPolygon.ts).
- `polygonAreaKm2(geometry)` — spherical-excess shoelace, R=6371km, outer minus holes, sum MultiPolygon
  parts, Point→0. Handles the `{type,coordinates}` shape from `alert-model.ts`.
- `bboxOf(geometry) → [minLng,minLat,maxLng,maxLat] | null` — walk all coords (Point/Polygon/MultiPolygon).
- `padBbox(bbox, {frac=0.25, minDeg=0.5})` — expand + clamp to `[-180,180]/[-90,90]`.
- `unionBboxOfAlert(info[])` — merge `bboxOf` over every `info.area.geometry` (used by the snapshot job).

### 0.2 Pure diff module (new — the heart of the feature)
**New:** `shared/src/alerts/diff.ts` (+ `.test.ts`).
- `diffAlert(prev, next) → { events: AlertChange[]; areaKm2: number; severity: SeverityRank }`.
- `AlertChangeType = SEVERITY_CHANGED | AREA_CHANGED | TEXT_CHANGED | INSTRUCTION_CHANGED |
  START_TIME_CHANGED | EXPIRY_CHANGED | CANCELLED`. (`ENDED`/`ISSUED` are NOT emitted here — synthesized on
  read, §0.4.)
- Rules (each event carries `{from,to}`):
  - **SEVERITY_CHANGED**: `prev.maxSeverityRank !== next.maxSeverityRank`.
  - **TEXT_CHANGED** / **INSTRUCTION_CHANGED**: reuse
    [alertContentHash](../shared/src/alerts/content-hash.ts) on `(headline,description,"")` and
    `("","",instruction)` respectively. Compare **source** text only — never `translated*` — so a
    translate-job write never registers as a change.
  - **START_TIME_CHANGED** / **EXPIRY_CHANGED**: `Date.parse` of `onset ?? effective` / `expiresAt` differs
    (tolerate equal instants with different formatting).
  - **AREA_CHANGED**: primary signal = a local `geometryHash` (sha1 of coords rounded ~4dp, order-independent
    per part) differs; attach before/after `areaKm2` (§0.1) for magnitude; small area-delta floor to skip
    sub-1% jitter.
  - **CANCELLED**: `next.msgType === "Cancel"` (explicit issuer withdrawal — distinct from natural expiry).
- Test matrix: one test per type, `no-op re-poll → []`, `translation-only → []`, `Cancel vs expiry`,
  `area grew but same hash → no AREA_CHANGED`.

### 0.3 `alert_revisions` model + repo (new, append-only)
**New:** `shared/src/db/alert-revision-model.ts` + `alert-revision-repo.ts` (+ tests). Mirror the append-only
shape of [air-log-model.ts](../shared/src/db/air-log-model.ts) (`AirEntry`, `seq` index, single writer).
- Fields: `source, identifier, alertId, seq` (1-based per key), `at` (ISO), `msgType`, `status`,
  `changes: {type, from?, to?}[]`, plus snapshot summary for graphs without re-reading the Alert:
  `severityRank, areaKm2, expiresAt, onset`.
- Indexes: `{source:1, identifier:1, seq:1}`, `{alertId:1, seq:1}`. No TTL (history is the point).
- Repo: `append(rev)` (next `seq` = `countDocuments`+1 for the key — fine at this volume),
  `listForAlert(source, identifier)` (seq asc). + parity test.

### 0.4 Timeline builder (new, pure — the single source both surfaces use)
**New:** `shared/src/alerts/timeline.ts` (+ `.test.ts`).
- `AlertTimelineBeat = { at; type: ISSUED|UPDATED|<AlertChangeType>|ENDED; label; severityRank?; areaKm2?; msgType?; refAlertId? }`.
- `buildTimeline(alert, chain, revisions, now) → AlertTimelineBeat[]`:
  - Head **ISSUED** synthesized from `alert.sent` (or earliest chain message).
  - CAP-`references` sources (NWS/MeteoAlarm): map each `chain[]` message → a beat.
  - In-place sources (WMO/GDACS): map each revision's `changes` → beats.
  - Tail **ENDED** synthesized iff `active===false` AND no `CANCELLED` beat AND `expiresAt < now`.
  - Sort by `at`; expose `latest(n)` for on-air.
  - Human labels ("Upgraded to Severe", "Area expanded ~1,200 km²", "Cancelled by issuer", "Warning ended")
    live here so admin + on-air read identically.

### 0.5 Ingest hook (modified — double-fire-safe)
**Modified:** [alerts-repo.ts](../shared/src/db/alerts-repo.ts) — `upsert()` already reads the prior doc for
translation carry-forward; **widen that projection** to also return `maxSeverityRank, expiresAt, msgType,
status, sent, id, references` and **return `{inserted, prev}`** (`prev` = lean pre-write doc, `null` on
insert). Callers that ignore `prev` are unaffected.

**Modified:** [ingest.ts](../worker/src/alerts/ingest.ts) — restructure the per-alert loop so the revision
write happens **once, after** the doc is persisted, diffed against the **original** `a` (geometry intact):
```
let prev, persisted = false;
try   { ({inserted, prev} = await db.alerts.upsert(a)); persisted = true; }
catch { /* strip geometry, re-upsert */ ({inserted, prev} = await db.alerts.upsert(stripped)); persisted = true; }
if (persisted && prev) {
  const { events, areaKm2, severity } = diffAlert(prev, a);   // a = original, geometry intact
  if (events.length) {
    await db.alertRevisions.append({ ...a, prev, events, areaKm2, severity, at: now });
    changed++;
    if (crossesInteresting(prev, a)) newlyInteresting.push(a.id);   // feeds P1 onset snapshot
  }
}
```
The throwing (bad-geometry) call never persists and never reaches the revision block; the retry reads the
same untouched `prev`. → exactly one revision per alert per tick, diffed against real geometry (a stripped
retry can't fake `AREA_CHANGED`). Add `newlyInteresting: string[]` to `IngestResult`. `diffAlert` is pure and
`db.alertRevisions.append` is a fake-repo method, so `ingestSource` stays unit-testable.

**Modified:** [db/index.ts](../shared/src/db/index.ts) — `alertRevisions: makeAlertRevisionRepo(getAlertRevisionModel(conn)),`.

### 0.6 Admin surface (modified)
**Modified:** [route.ts](../public/src/app/api/admin/alerts/[id]/route.ts) — add `revisions`
(`db.alertRevisions.listForAlert`) and `timeline: buildTimeline(alert, chain, revisions, new Date())`.
**Modified:** [page.tsx](../public/src/app/admin/alerts/[id]/page.tsx) + `AlertDetail` type in
[lib/alerts.ts](../public/src/lib/alerts.ts) — add a **"Timeline"** card beside the existing "Update chain" /
"On air" cards, rendering beats (glyph + relative time + label + sev/area).

---

## PHASE 1 (P1) — GDACS series, resource harvest, satellite snapshots

### 1.1 `alert_series` (GDACS numeric deltas)
**New:** `shared/src/db/alert-series-model.ts` + repo. Mirror
[tide-series-model.ts](../shared/src/db/tide-series-model.ts): `key="${source}:${identifier}"` upsert,
`metric` (`alertscore|population|...`), `samples:[{t,v}]` (capped ~500), `updatedAt` TTL.
**Promote-from-raw, no extra HTTP** (GDACS already keeps `raw=feature`): in a small `source==="gdacs"`
post-step of `ingestSource`, read `alertscore/episodealertscore/severitydata/population` from
`a.raw.properties` → `db.alertSeries.appendSample(...)`. GDACS's 15-min re-poll is the sampling cadence.
Optional: a low-priority detail-fetch of the per-event endpoint for **orange+/red only**.

### 1.2 `alert_resources` (harvested images/maps — refs only, no bytes)
**New:** `shared/src/db/alert-resource-model.ts` + repo. Mirror [fire-repo.ts](../shared/src/db/fire-repo.ts)
`upsertMany` (`bulkWrite` `$set`+`$setOnInsert:{id:uuidv4()}`), dedup on `(alertId, url)`. Fields:
`alertId, source, identifier, url, mimeType?, kind (map|icon|report|resource), description?, harvestedAt`.
- Populate GDACS `feature.properties.url.*` + `icon` immediately (cheap).
- WMO `identifier` IS the capurl → the real CAP XML at `severeweather.wmo.int/v2/cap-alerts/{capurl}` has
  `<resource>` elements; harvest those only for **interesting** alerts in a dedicated low-priority job (gate hard).

### 1.3 `alert_snapshots` (satellite + camera blobs)
**New:** `shared/src/db/alert-snapshot-model.ts` + repo. Mirror
[satimg-model.ts](../shared/src/db/satimg-model.ts): `png: Buffer`, `contentType`, `.select("-png")` read
split, **reuse the `toPngBuffer` coercion helper**, guard `png.length > 15_500_000` (BSON 16MB cap). Fields:
`id, source, identifier, alertId, kind (satellite|camera|compare), layer?, bounds?, width, height,
observationTime, capturedAt, pHash?, camId?, attribution?, png`. **Append (uuid id), don't overwrite** —
dedup by an `hourSlot` key so hourly scheduling yields one per hour per `(alertId, layer)`. Index
`{alertId:1, kind:1, capturedAt:-1}`.

### 1.4 Satellite-snapshot job (new event on the existing alerts job file)
**Modified:** [jobs/alerts.ts](../worker/src/jobs/alerts.ts) — add `export async function snapshotSatellite(job)`
(auto-discovery → `type:"alerts", event:"snapshotSatellite"`). Canonical job shape (see
[fires.ts](../worker/src/jobs/fires.ts)): `TAG`, `getAppDb`, `blogInfo/blogErr`, `emitWorkerEvent`, rethrow.
- **"Interesting" filter** (the key volume guard — never snapshot hundreds of minor WMO alerts):
  `db.alerts.list({activeOnly:true, severityMin:3})` narrowed to alerts with geometry + GDACS orange/red +
  named cyclones (event matches Cyclone/Hurricane/Typhoon), capped ~50 by severity.
- Per alert: `unionBboxOfAlert(info)` → `padBbox` → `dimsFor(bounds, ~1024)` → reuse
  [gibs.ts](../worker/src/satimg/gibs.ts) `fetchLiveWms` (export it or add a thin
  `fetchAlertFrame(bounds, layers)` wrapper) for a live geocolor + IR frame; store via `db.alertSnapshots`
  with `observationTime`.
- **Scheduling** (modified [worker/src/index.ts](../worker/src/index.ts), mirror the fires/satimg blocks):
  repeatable every 60 min, `jobId:"alerts-snapshot-satellite"`, gated `ALERT_SNAPSHOT_ENABLED`. **Onset
  one-shot:** in `jobs/alerts.ts#ingest`, after `ingestSource`, for each `result.newlyInteresting` id
  `sendToQueue("alerts","alerts","snapshotSatellite",{alertId}, undefined, LOW)` (keep `ingestSource` bull-free).
- **New:** `worker/src/scripts/refreshAlertSnapshots.ts` (mirror
  [refreshFaults.ts](../worker/src/scripts/refreshFaults.ts): `loadWorkerEnv()` first, fake
  `Job {id:"manual",data:{data:{}}}`) + `"refresh:alert-snapshots"` in
  [worker/package.json](../worker/package.json).

### 1.5 Snapshot media route (new)
**New:** `public/src/app/api/alerts/snapshot/[snapId]/route.ts` — stream `png` with immutable cache + `?v=`
buster, mirroring [satimg frame.png route](../public/src/app/api/satimg/frame.png/route.ts).

---

## PHASE 2 (P2) — Comparison, camera snapshots, graphs

- **2.1 Satellite side-by-side:** `worker/src/satimg/compare.ts` — resize two snapshots to equal dims,
  `sharp().composite([{input,left:0},{input,left:w}])` (recipe already in
  [checkMapAlignment.ts](../worker/src/scripts/checkMapAlignment.ts)). On-demand admin route (two snap ids) to
  avoid storage bloat; optionally bake one `kind:"compare"` frame/hour for interesting alerts.
- **2.2 Nearby-camera snapshots:**
  - **Modified:** [cam-repo.ts](../shared/src/db/cam-repo.ts) — add `nearMany({lng,lat,maxKm,limit})` by
    copying the `$geoNear` aggregate from [tide-station-repo.ts:66](../shared/src/db/tide-station-repo.ts#L66)
    (the `cam-model` already has a sparse 2dsphere `loc` index).
  - **New:** `worker/src/jobs/alerts.ts#snapshotCameras` — `alertRepPoint(geometry)` (from
    [alerts/geo.ts](../shared/src/alerts/geo.ts)) → `nearMany` (nearest 3) → fetch `cam.imageUrl` bytes →
    perceptual hash (`worker/src/satimg/phash.ts`, net-new: sharp `.resize(8,8).greyscale().raw()` →
    aHash/dHash) → dedup vs last stored camera `pHash`; store `kind:"camera"` with `pHash, camId, attribution`.
  - **pHash dedup:** conservative Hamming threshold (>4 on 64-bit) + max-one-per-interval floor; **bias toward
    keeping a near-dup** over dropping a real update.
- **2.3 Graphs:** tiny inline-SVG sparkline (severityRank per beat; `areaKm2` over time from
  `alert_series`/revision snapshots) in both the admin card and the on-air slide. Follow the `dataviz` skill
  palette; mirror the compact charts already in the history panels.

---

## On-air timeline as a declarative slide

No bespoke component, no `BroadcastFrame` surgery beyond one context field. Slide guard = the `.push()` `if`
(the deck's `DeckSlide = {id, node}` has no `when` field).

**Data path — attach to the FocusBundle** (idiomatic: one cacheable per-cut payload; a separate fetch would
reintroduce the per-cut fan-out the bundle exists to kill):
- **Modified:** [focus/types.ts](../public/src/lib/focus/types.ts) — add `alertTimeline: AlertTimelineBeat[]`
  to `FocusBundle` (empty array when not a storm, never omitted).
- **Modified:** [getFocusBundle.ts](../public/src/lib/focus/getFocusBundle.ts) — only when
  `target?.kind==="storm"`, `Promise.all([db.alerts.chain(src,ident), db.alertRevisions.listForAlert(src,ident)])`
  → `buildTimeline(target.alert, chain, revisions, new Date())` (two cheap indexed reads, storm cuts only).
- **Modified:** [focus-client.tsx](../public/src/lib/focus/focus-client.tsx) — add `useAlertTimeline()`
  selector (mirror `useFocusTarget`).

**Slide declaration:**
- **Modified:** [mode-slides.tsx](../public/src/components/broadcast/mode-slides.tsx) — add `alertTimeline` to
  `ModeSlideContext`; inside the existing `isTargetedEvent` branch (after the quake block, before `nearby`):
  ```
  if (segment.kind === "storm" && alertTimelineSlideHasContent(ctx.alertTimeline)) {
    slides.push({ id: "alert-timeline",
      node: <AlertTimelinePanel beats={ctx.alertTimeline} color={color} theme={ctx.theme} /> });
  }
  ```
- **Modified:** [BroadcastFrame.tsx](../public/src/components/broadcast/BroadcastFrame.tsx) — pass
  `alertTimeline: useAlertTimeline()` into the single `modeSlides(onAirSegment, {...})` call.
- **New:** `public/src/components/broadcast/AlertTimelinePanel.tsx` (+ `.test.tsx`) — latest ~5 beats as a
  compact vertical list (glyph + relative time + label), optional P2 sparkline on top. Mirror
  [AreaAlertsPanel.tsx](../public/src/components/broadcast/AreaAlertsPanel.tsx) for structure; uses shared
  `BroadcastCard` chrome, honors `DeckSlideActiveContext`, pointer-inert, self-hides on empty. Export
  `alertTimelineSlideHasContent(beats)`.

---

## Riskiest / subtlest bits (verify explicitly)

1. **Double-fire on geometry-strip retry** — `ingestSource` can call `upsert` twice for one alert. The
   revision write lives *after* the try/catch resolves to persisted, diffed against the **original** `a`.
   → exactly one revision, against real geometry. Cover with a dedicated unit test.
2. **Write volume** — only write on non-empty `diffAlert`; no revision on insert; ISSUED/ENDED synthesized on
   read; snapshot job hard-gated + capped. Verify a steady-state re-poll writes **zero** revisions.
3. **ENDED vs CANCELLED** — `CANCELLED` = explicit `msgType:"Cancel"` (stored); `ENDED` = natural lapse
   (`active=false` + `expiresAt<now` + no Cancel), synthesized in `buildTimeline`, never written (so the
   expiry/deactivateMissing sweeps write nothing).
4. **BSON 16MB cap** — every `alert_snapshots` PNG write reuses the satimg `>15_500_000` guard.
5. **pHash false-dedup (P2)** — loose threshold silently drops real camera updates; use a conservative
   threshold + interval floor.

## Verification

- **Unit (`./test`, must stay green):** `diff.test.ts`, `timeline.test.ts`, `polygon.test.ts`, revision-repo
  parity test, and an `ingest` test asserting: (a) no revision on insert, (b) one on a severity change,
  (c) **exactly one** on the geometry-strip retry path, (d) zero on a translation-only re-poll. P1/P2 add
  series/resource/snapshot repo parity tests, the snapshot interesting-filter test, `phash` test, and a
  `mode-slides` case (storm+beats → slide present; storm+no beats → absent; non-storm → absent).
- **End-to-end (local, no Docker):** after any `shared/src` edit run `./update-shared`; then `yarn
  ingest:alerts` twice (mutate a fixture between runs) and eyeball the "Timeline" card on
  `/admin/alerts/[id]`. `yarn refresh:alert-snapshots` seeds a few frames — open
  `/api/alerts/snapshot/[snapId]`. Put a real storm on air via the director and confirm the `alert-timeline`
  slide rotates into the left deck with live beats. (Don't kill dev processes — restart them; run the
  one-shots manually.)

## Suggested build order

P0 (0.1 → 0.6) is the shippable "feels live" slice — land + verify it first (including the on-air slide wired
to P0 revisions). Then P1 (series/resources/satellite), then P2 (compare/cameras/graphs).
