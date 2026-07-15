# News & Media Enrichment (Event Registry addon)

## Context

The unified event layer already exists and works. A physical event is **one `WatchedEvent` doc**, keyed
`(primarySource, primarySourceId)` ([watched-event-model.ts](../shared/src/db/watched-event-model.ts)),
promoted from alerts ([alerts/ingest.ts:151](../worker/src/alerts/ingest.ts#L151)) and volcanoes
([jobs/volcanoes.ts](../worker/src/jobs/volcanoes.ts)). Around it sit `event_timeline_updates` (stored
beats), `event_resources` (harvested links), `event_snapshots` (GODS-captured bytes on disk),
`event_series`, and `event_watch_schedules` — the last driving a per-event cadence sweeper
([jobs/events.ts](../worker/src/jobs/events.ts)) so a burst of events never spawns a repeatable each.
External detail fetchers plug in as `ExternalSource` adapters behind
[events/registry.ts](../worker/src/events/registry.ts). All of it lands dark behind
`EVENTS_UNIFIED_ENABLED`.

**What's missing:** every event is described entirely by *official* feeds. Nothing in the repo has ever
fetched a news article. The closest thing is [gdacs-detail.ts:91](../worker/src/events/gdacs-detail.ts#L91),
which records GDACS's own news endpoints as `EventResource` LINK rows and **never fetches them**. An event
therefore has no human reporting, no photographs, no video — the material that makes a segment watchable
rather than a coloured polygon.

Goal: given an existing `eventId` plus search context (where, when, what words), **find news, score it
against the event, discover the media inside it, and attach the useful parts** — as a reusable addon that
neither detects events nor classifies them. The caller already owns all of that.

### Deviations from the pasted spec (deliberate — read first)

- **Mongo, not PostgreSQL.** The spec's eleven `CREATE TABLE`s become Mongoose models + `make*Repo(model)`
  factories. Unique constraints become compound unique indexes.
- **Six collections, not eleven.** `news_article_duplicates` folds onto the article
  (`canonicalArticleId`/`dupMatchType`/`dupSimilarity` — a doc has exactly one canonical);
  `news_article_media` folds onto the asset as an `articles[]` array (true many-to-many, but the real
  cardinality of "how many articles reuse one hero image" is dozens, not millions);
  `news_enrichment_queries` embeds in its run (bounded, ~4–12 per run); `media_probe_history` embeds on the
  asset. `event_news_score_history` is **deferred to the V2 re-score** — until a second scoring version
  exists it would be a history of one row (see P0.5).
- **Qdrant does not exist in this repo.** No vector store, no embeddings, no pgvector — the ~40 files
  matching `vector` are GRIB wind fields. §9's semantic duplicate check is greenfield (new container, new
  compose service, and an embedding endpoint that OpenRouter does not provide). **Cut from V1**; dedup stops
  at the fingerprint, which is steps 1–5 of the spec's own ordering and catches the overwhelming majority.
  Deferred to [P4](#phase-4-p4--blocked-on-a-commercial-licence).
- **ffprobe does not exist in this repo.** Video/animation work is `sharp` (the volcano animated-WebP
  timelapse). ffprobe means a new system binary in the worker image (`buildWgrib.sh` is the precedent) and
  only pays off on media we are permitted to download — which, per the rights position below, is currently
  none. **Cut from V1**; video is provider-parsed and URL-deduped, not probed.
- **No new BullMQ queue, and no per-queue concurrency.** The worker is a single process consuming one queue
  ([index.ts:185](../worker/src/index.ts#L185), `WORKER_CONCURRENCY` default 10), routed on
  `job.data.type`/`job.data.event` with handlers auto-discovered from `worker/src/jobs/*.ts`. The spec's
  "Registry search 3 · article ingestion 10 · media probe 5" is not expressible as queue config. The part
  that actually matters — *don't let 200 events create 800 Registry calls* — is enforced where the spec also
  puts it: **a limiter inside the Registry client** (P0.2).
- **No `POST /api/internal/...`.** [[all-work-in-worker]] is a standing rule the user has had to repeat:
  public reads Mongo and renders, and never grows a computing dependency. Triggering is a
  [shared/src/jobs.ts](../shared/src/jobs.ts) registry entry (an `/admin/jobs` button) plus `sendToQueue`.
  Public may *enqueue*; it never owns the pipeline.
- **Fetch caps are cost control, not display caps.** `maxArticles`/`maxImages`/`maxVideos` bound calls to a
  metered third-party API. [[no-arbitrary-caps]] governs what the operator is *shown* — every article we
  hold is listed. The two do not conflict, but do not let the fetch cap leak into a read path.

### Rights position (this shapes the whole plan)

Event Registry's terms state that third-party text, images and video remain third-party content and that the
API grants no publishing or embedding rights. The free tier is **evaluation only and excludes commercial
use**. This project streams to YouTube. Therefore, for V1:

- **`canPersistBroadcastCopy` is never true.** Every discovered asset resolves `UNKNOWN` → `REFERENCE_ONLY`.
- **We store no third-party bytes.** No blob namespace, no download, no pHash, no ingestion. Media assets are
  **metadata + source URL + article provenance**, for operator review.
- **Spec Stage 4 ("EVENT → SAFE PLAYER MEDIA") is blocked**, not deferred — it cannot ship without a paid
  agreement, and building the ingestion path first would produce a loaded gun pointed at the channel.
- **Even headline text on air needs a human call.** A ticker showing `headline — source name` with
  attribution is ordinary newsroom practice; article *bodies* are not ours to broadcast. P3's on-air slide
  therefore renders headline + source + timestamp only, and `bodyExcerpt` stays server-side as scoring input.
  Flagged in Risks — **the user decides this, not the code**.

## Guiding decisions

- **The addon owns no event model.** `eventId` is a `WatchedEvent.id`. There is no Registry-event matching,
  no second registry, and Event Registry is never authoritative about anything. It is a search index.
- **Articles are global; relevance is per-event.** `news_articles` is keyed
  `(provider, providerArticleUri)` and stores one BBC article once. Everything event-specific — lane, the six
  component scores, state, match reasons — lives on the `event_news_articles` join. One article can enrich
  many events; this is the whole reason for a global table.
- **Store-on-change discipline, inherited.** Same rule the alert diff hook and the volcano diff hook follow:
  a refresh that surfaces nothing new writes **zero** rows. The `updatesAfterTm` cursor exists to make
  re-runs cheap; it is advanced **only after ingestion succeeds** (P3.1).
- **Scoring is a pure module.** `scoreArticle(request, article, context) → {relevance, components, reasons}`
  with no I/O, stamped `scoringVersion: "NEWS_MEDIA_V1"`. It is the densest test target in the feature and
  the reason component scores are stored rather than just the total: we need to know *why* it got 0.83.
- **Lanes are separate searches with separate confidence, never one giant query.** The spec is right about
  this and it is the main quality lever. Lane A (occurrence) and Lane B (publisher location) are genuinely
  different filters — `locationUri` vs `sourceLocationUri` — and Lane B's "Tokyo paper reports French flood"
  failure mode is exactly what the geo/place components exist to catch.
- **Everything lands dark behind `NEWS_MEDIA_ENABLED`** (plus the existing `EVENTS_UNIFIED_ENABLED`, since
  there are no events to enrich without it). Default off. No key is set in any env file today, so the
  natural state of this feature on every machine is "inert".

## Cross-cutting rules (apply throughout)

- Every `shared/src` edit → run `./update-shared` before worker/public see it; don't hand-copy `dist`.
- Every new model ships a **strict-mode parity test** (mirror
  [broadcast-state-model.test.ts](../shared/src/db/broadcast-state-model.test.ts)) — Mongoose `strict:true`
  silently drops any interface field missing from the Schema literal.
- Wire each new collection with **one line** in `createDb()` in [db/index.ts](../shared/src/db/index.ts).
- Feature-local config module with lazy accessors, mirroring
  [events/config.ts](../worker/src/events/config.ts): gates are **functions** (read at call time, testable),
  tuning constants are module-level. No central typed config exists; don't invent one here.
- Declare every new var in a `── Section ──` block in [.env.sample](../.env.sample). **Drive-by fix:** while
  in there, add the `EVENTS_UNIFIED_ENABLED` / `EVENT_PROMOTE_MIN_SEV` / `EVENT_CADENCE_*` /
  `EVENTS_WATCH_TICK_MS` / `VOLCANO_OBSERVATION_ENABLED` block — the event and volcano work shipped without
  ever updating the sample, and this plan adds a sixth reason to trust it.
- All network adapters ship timeouts + fixtures + schema guards; the UI never couples to a Registry payload
  shape. Every package stays green under `./test`. Keep files small.

---

## PHASE 0 (P0) — Event → relevant news (the shippable slice)

Lane A only, no media, no dedup beyond the provider's own. At the end of P0 an operator can press a button
on `/admin/jobs`, and `/admin/events/[id]` grows a **News** card listing scored articles. That is the whole
"feels live" slice and it is worth landing alone.

### 0.1 Contract + config (new, pure)
**New:** `shared/src/news/types.ts` — `EventMediaEnrichmentRequest` verbatim from the spec §1 (it is a good
contract; `eventId` + `time` + `location` + `search` + `options`), plus `SearchLane =
"LOCATION_OCCURRENCE" | "LOCAL_SOURCE" | "NAMED_PLACE" | "VIDEO"`, `EventNewsState = "CANDIDATE" | "MATCHED"
| "REJECTED" | "HIDDEN"`, `MediaRightsState`, `MediaCandidateStatus`, `EnrichmentRunStatus = "PENDING" |
"RUNNING" | "READY" | "PARTIAL" | "NO_RESULTS" | "DEGRADED" | "FAILED"`.

**New:** `worker/src/news/config.ts` (+ `.test.ts`) —
```ts
export const newsMediaEnabled = (): boolean => process.env.NEWS_MEDIA_ENABLED === "true";
export const registryApiKey = (): string | undefined => process.env.EVENT_REGISTRY_API_KEY || undefined;
const BASE_URL = process.env.EVENT_REGISTRY_BASE_URL || "https://eventregistry.org/api/v1";
const MAX_CONCURRENT = Number(process.env.EVENT_REGISTRY_MAX_CONCURRENT || 3);
const TIMEOUT_MS = Number(process.env.EVENT_REGISTRY_REQUEST_TIMEOUT_MS || 20_000);
```
Missing key → the feature is inert and **says so once**, not per-event (mirror the `FIRMS_MAP_KEY` idiom:
the job is simply never scheduled and the surface stays silently empty).

### 0.2 Registry REST client (new — the only thing that talks to Event Registry)
**New:** `worker/src/news/registry/client.ts` (+ `.test.ts`, + `fixtures/`). REST directly; do not wrap the
old Node SDK. Mirror [lib/openrouter.ts](../worker/src/lib/openrouter.ts) exactly — it is the house pattern
for a metered external API: **never throws**, returns `{status: "ok" | "error", ...}`, own retry/backoff, own
timeout, `fetchImpl?` injection for tests.
- `resolveLocations(input) → RegistryLocation[]` — `POST /suggestLocationsFast`, `action:
  "getLocationsAtCoordinate"`, radius in km.
- `resolveLocalSources(input) → RegistrySource[]` — `POST /suggestSourcesFast`, `action:
  "getSourcesAtCoordinate"`.
- `searchArticles(query) → RegistryArticleSearchResponse` — `POST /article/getArticles`.
- `searchRecentArticles(query)` — `resultType: "recentActivityArticles"` (P3.1).
- **Global limiter lives here**, not in queue config: a module-level semaphore of `MAX_CONCURRENT` (default
  3) across the whole worker process, plus retry on `429`/`5xx`/timeout and **no retry** on `400`/`401`/`403`
  /invalid query. Since the worker is one process, a module-level semaphore *is* a global limiter — this is
  the one place the single-process architecture makes the spec easier rather than harder.
- Every call returns `{durationMs, resultCount, status}` for the run's embedded query log (P0.5).

### 0.3 Location + source resolution (new)
**New:** `worker/src/news/resolve.ts` (+ `.test.ts`).
- `resolveNewsLocations(client, req) → ResolvedNewsLocation[]` — normalise to the spec's shape, score
  `distance*0.60 + suppliedNameMatch*0.25 + population*0.10 + placeType*0.05`, keep **nearest 5 places + 2
  larger administrative + 1 country**. The scoring weights exist to answer *where did it happen*, not
  *largest place within 100 km* — a Tokyo-radius search must not collapse to "Tokyo" when the flood was in
  Shibuya. Pure function over a client response; the weights are the test target.
- `resolveLocalSources(client, req) → LocalNewsSource[]` for Lane B.
- **Cache Registry location responses 30 days.** Reuse the `withCache` Redis idiom from the public feed
  routes conceptually, but worker-side: key on rounded `(lat, lon, radiusKm)` so nearby events in the same
  city share one lookup. Coordinates round to ~3dp before keying.

### 0.4 Article + join collections (new)
**New:** `shared/src/db/news-article-model.ts` + `news-article-repo.ts` (+ parity tests).
- Fields: `id, provider, providerArticleUri, title, bodyExcerpt, url, canonicalUrl, publishedAt (ISO),
  providerSeenAt, language, sourceUri, sourceName, imageUrl?, storyUri?, sentiment?, isDuplicate,
  originalArticleUri?, fingerprint, canonicalArticleId?, dupMatchType?, dupSimilarity?, raw (Mixed),
  firstSeenAt, lastSeenAt`.
- Indexes: unique `news_article_provider_ix` on `(provider, providerArticleUri)`; **sparse** unique
  `news_article_canonical_ix` on `canonicalUrl` (sparse — plenty of articles have no canonical);
  `news_article_fingerprint_ix`; `news_article_story_ix` on `storyUri`.
- Repo: `upsertMany(articles)` via `bulkWrite` `$set` + `$setOnInsert: {id: uuidv4(), firstSeenAt}` (mirror
  [fire-repo.ts](../shared/src/db/fire-repo.ts)), `getById`, `byProviderUri`, `listByIds`.

**New:** `shared/src/db/event-news-article-model.ts` + repo (+ parity tests).
- Fields: `id, eventId, articleId, searchLane, relevanceScore, geoScore, timeScore, keywordScore, placeScore,
  sourceScore, mediaScore, matchReasons: string[], scoringVersion, state, firstMatchedAt, lastMatchedAt`.
- Indexes: unique `(eventId, articleId)`; `(eventId, state, relevanceScore desc)` for the admin read.
- Repo: `upsertMany`, `listForEvent(eventId, {state?})`, `countForEvent(eventId)`.

**Modified:** [db/index.ts](../shared/src/db/index.ts) — `newsArticles:
makeNewsArticleRepo(getNewsArticleModel(conn)),` and `eventNewsArticles: ...`.

### 0.5 Scoring (new, pure — the heart of the feature)
**New:** `shared/src/news/score.ts` (+ `.test.ts`). Weights and bands exactly as spec §10:
```
relevance = geo*0.25 + time*0.20 + keyword*0.20 + place*0.15 + source*0.10 + media*0.10
>= 0.70 MATCHED · >= 0.45 CANDIDATE · < 0.45 REJECTED
```
- **Unknown geo scores 0.30, never rejects** — local outlets routinely ship no article-location metadata,
  and Lane B exists precisely to catch them. This is the single most important rule in the module; give it
  its own test.
- Title matches beat body matches; phrase > alias > term.
- `matchReasons` are stable machine tokens (`ARTICLE_LOCATION_8KM`, `TITLE_PHRASE_FLASH_FLOOD`,
  `LOCAL_SOURCE`, `HAS_VIDEO`) — they render in admin and must be greppable.
- Stamp `scoringVersion: "NEWS_MEDIA_V1"`. **When V2 lands**, add `event_news_score_history` and write both;
  until then a history collection holds one row per article and earns nothing.
- Test matrix: each component in isolation; the three threshold boundaries; unknown-geo; an exclude-term hit
  forcing `REJECTED`; a Lane-B article about the wrong continent scoring below 0.45.

### 0.6 Lane A + the enrichment job (new)
**New:** `worker/src/news/lanes.ts` (+ `.test.ts`) — pure query *builders*, one per lane, returning the JSON
body. Lane A: `keyword` = terms ∪ phrases ∪ aliases, `keywordOper: "or"`, `keywordLoc: "body,title"`,
`locationUri` = resolved URIs, `dateStart`/`dateEnd` from `time.start` ± `searchBeforeHours`/
`searchAfterHours`, `isDuplicateFilter: "skipDuplicates"`, `articlesSortBy: "rel"`. Return flags per spec §7
with `articleBodyLen: 5000` — we score bodies, we do not archive them.

**New:** `worker/src/jobs/newsMedia.ts` — auto-discovery gives `type: "newsMedia"`. Exported handlers are the
job names; follow the canonical shape ([jobs/events.ts](../worker/src/jobs/events.ts)): `const TAG =
"job:newsMedia"`, read params from **`job.data?.data`** (note the double nesting), `blogInfo`/`blogErr`,
rethrow on failure, early-return `{skipped: true}` when `!newsMediaEnabled()`.
- `export async function enrich(job)` — the root. Create the run doc, resolve locations, build Lane A,
  search, normalise, score, upsert articles + joins, finalise the run. **P0 is deliberately synchronous
  within one job** — one event's Lane A is a handful of Registry calls behind a semaphore, and the spec's
  eight-child-job fan-out buys nothing until there are four lanes and media probes (P1/P2 split it).
- `export async function enrichEvent(job)` — thin: look up the `WatchedEvent`, derive an
  `EventMediaEnrichmentRequest` from it (`repPoint` → lat/lon, `startedAt` → time, `type` + `title` → terms
  via a small pure `requestForEvent(event)` in `shared/src/news/request.ts`), delegate to `enrich`. **This is
  the seam that makes the addon reusable**: `enrich` takes the spec's contract and knows nothing about
  WatchedEvent; `enrichEvent` is the adapter.

**New:** `shared/src/db/news-enrichment-run-model.ts` + repo (+ parity test) — `id, eventId, status,
requestedAt, startedAt, completedAt, articlesDiscovered, articlesMatched, articlesRejected,
imagesDiscovered, videosDiscovered, mediaIngested, providerRequests, providerTokensEstimated, errorCode,
errorMessage, request (Mixed), queries: [{lane, queryHash, page, resultCount, durationMs, status, errorCode}]`.
Queries embed — they are bounded per run and never read independently.

### 0.7 Trigger + admin surface (modified)
**Modified:** [shared/src/jobs.ts](../shared/src/jobs.ts) — add a `News & media` group. Note the registry
currently has **no `events` entries at all** (the only manual trigger is
[refreshEvents.ts](../worker/src/scripts/refreshEvents.ts)); this plan adds the first, so put the button
where an operator will find it:
```
{ id: "news-enrich-event", label: "Enrich event with news", domain: "events",
  type: "newsMedia", event: "enrichEvent", group: "News & media", priority: QUEUE_PRIORITY.LOW }
```
**New:** `worker/src/scripts/refreshEventNews.ts` (mirror
[refreshEvents.ts](../worker/src/scripts/refreshEvents.ts): `loadWorkerEnv()` first, fake
`Job {id: "manual", data: {data: {eventId}}}`) + `"refresh:event-news"` in
[worker/package.json](../worker/package.json). This is how it gets verified locally without a dev restart.

**Modified:** [api/admin/events/[id]/route.ts](../public/src/app/api/admin/events/%5Bid%5D/route.ts) — add
`news: db.eventNewsArticles.listForEvent(id)` joined to `db.newsArticles.listByIds(...)`.
**Modified:** [admin/events/[id]/page.tsx](../public/src/app/admin/events/%5Bid%5D/page.tsx) — a **News**
card: headline (link out), source, published, relevance, and the `matchReasons` as chips. Show every article
we hold, ordered by relevance ([[no-arbitrary-caps]]).

---

## PHASE 1 (P1) — The other three lanes + dedup

### 1.1 Lanes B, C, D
**Modified:** `worker/src/news/lanes.ts` — Lane B (`sourceLocationUri` from P0.3's resolved sources,
`articlesSortBy: "date"`, base confidence 0.65); Lane C (the advanced `$query`/`$and`/`$or` form for
keyword×place combinations Registry failed to geo-tag, 0.55); Lane D (repeat the strongest lane with
`videosFilter: "keepOnlyIfHasVideos"` + `includeArticleVideos: true`).
- **Lane D is media discovery, not news completeness** — never let its results define article coverage.
- Base confidence multiplies into `sourceScore`, it does **not** short-circuit the relevance threshold. A
  Lane B article still has to earn 0.70 on its own merits.

### 1.2 Dynamic paging (new, pure)
**New:** `worker/src/news/paging.ts` (+ `.test.ts`) — `nextPagePlan(matchedCount, lanes, maxArticles) →
{lane, page} | null`. Per spec §17: all four lanes page 1 → merge → dedupe → score; then page 2 of the
strongest lane only if matched < 20; page 3 only if matched < 50; stop at `maxArticles`. **Never** 3 pages ×
4 lanes unconditionally — each page is a billable search action. Pure, so the cost policy is unit-tested
rather than hoped for.

### 1.3 Dedup (new, pure)
**New:** `shared/src/news/dedupe.ts` (+ `.test.ts`) — resolve in the spec's order, stopping at 5:
`providerArticleUri → canonicalUrl → originalArticleUri → storyUri → fingerprint`. Step 6 (vector) is P4.
```ts
const fingerprint = sha256(normalize(title) + "|" + sourceUri + "|" + publishedAt.substring(0, 10));
```
- **Duplicates are stored, never deleted** — they are the signal for source count / reporting spread / story
  importance, and `sourceMultiplicity` in the media score depends on them. They just resolve to one
  `canonicalArticleId` so the operator sees one row.
- Reuse the `normalize` + hashing idiom from
  [alerts/content-hash.ts](../shared/src/alerts/content-hash.ts) rather than forking a second normaliser.

---

## PHASE 2 (P2) — Media discovery (references only)

No bytes are stored in this phase. See the rights position.

### 2.1 Media asset + join collections (new)
**New:** `shared/src/db/news-media-asset-model.ts` + repo (+ parity tests).
- Fields: `id, mediaType ("IMAGE" | "VIDEO" | "LINK"), sourceUrl, normalizedUrl, finalUrl?, mimeType?,
  contentLength?, width?, height?, durationMs?, sha256?, perceptualHash?, storagePath?, rightsState,
  probeState, provider, providerVideoId?, streamType?, articles: [{articleId, discoveryType, sourceUrl,
  firstSeenAt}], probes: [{at, status, httpStatus, mimeType, contentLength, errorMessage}]`.
- `width/height/sha256/perceptualHash/storagePath` are **declared now, populated in P4** — the schema is the
  cheap part and a later migration is not.
- Indexes: unique `news_media_url_ix` on `normalizedUrl`; `news_media_rights_ix` on `(rightsState, probeState)`.

**New:** `shared/src/db/event-media-model.ts` + repo — `id, eventId, mediaAssetId, relevanceScore, state,
isFeatured, isPlayerAllowed, firstMatchedAt, lastMatchedAt`. Unique `(eventId, mediaAssetId)`.
**`isPlayerAllowed` is computed, never stored as a wish** — it is `canPersistBroadcastCopy(rightsState)`,
which is `false` for everything V1 discovers.

### 2.2 Extraction + provider parsing (new, pure)
**New:** `shared/src/news/media-url.ts` (+ `.test.ts`) — `normalizeMediaUrl(url)` (strip tracking params,
resolve protocol-relative, lowercase host) and `identifyVideoProvider(url) → {provider, providerVideoId?,
streamType?}` over `YOUTUBE | VIMEO | JWPLAYER | BRIGHTCOVE | DAILYMOTION | DIRECT | HLS | DASH | UNKNOWN`
(`youtu.be`, `*.m3u8`, `*.mpd`, `.mp4/.webm/.mov`). Pure and heavily fixture-tested — URL shapes are where
this kind of code rots.

**New:** `worker/src/news/extract.ts` — for every `MATCHED` article, walk `image` / `videos[]` / `links[]` →
candidates → `db.newsMediaAssets.upsertMany` (dedup on `normalizedUrl`) → `db.eventMedia.upsertMany`.
**Modified:** `worker/src/jobs/newsMedia.ts` — `export async function extractMedia(job)`, fanned out from
`enrich` via `sendToQueue("events", "newsMedia", "extractMedia", {eventId, articleId}, undefined,
QUEUE_PRIORITY.LOW)`. Dedup is on by default in
[bull-queue.ts:89](../shared/src/bull/bull-queue.ts#L89), so a re-run is a cheap no-op.

### 2.3 HEAD probe (new)
**Modified:** `worker/src/jobs/newsMedia.ts` — `export async function probeMedia(job)`. **`HEAD` only**: MIME,
content-length, final URL after redirects. Accept `image/jpeg|png|webp|avif`; reject SVG by default, HTML, and
`contentLength < 10_000` (the tracking-pixel/thumbnail floor).
- **The spec's `width >= 640` gate cannot run here** — dimensions require decoding bytes, and decoding
  requires downloading, which is the thing rights forbid. Content-length is the honest V1 proxy. Dimension
  and pHash gating move to P4 with the download. Do not pretend otherwise in the admin UI: show
  `contentLength`, not a fabricated resolution.
- Append to the asset's `probes[]`; set `probeState`. A dead URL is `DEAD`, not an error — link rot is the
  normal case for news media and must never fail a run.

**Modified:** `worker/src/news/score.ts` — `mediaScore` now has real input (`image + video 1.00 · video 0.90
· image 0.60 · none 0.00`), and the media relevance score (spec §16) lands as a second pure function:
`scoreMedia({articleRelevance, sourceMultiplicity, timeScore, visualKeywordScore, imageQualityScore,
geoEvidenceScore, noveltyScore})`. V1 has no visual AI: `visualKeywordScore` comes from URL filename hints
only, `imageQualityScore` from content-length. **Never let a future VLM's output become factual event data —
it scores media relevance and nothing else.**

---

## PHASE 3 (P3) — Live: refresh, sockets, on-air

### 3.1 Refresh cursor (new)
**New:** `shared/src/db/event-news-provider-state-model.ts` + repo — `eventId, provider,
lastInitialSearchAt, lastRefreshAt, recentActivityCursor, lastArticleUri, articleCount, mediaCount`. Unique
`(eventId, provider)`.
**Modified:** `worker/src/jobs/newsMedia.ts` — `export async function refresh(job)` using
`resultType: "recentActivityArticles"` + `recentActivityArticlesUpdatesAfterTm: <cursor>`. **Advance the
cursor only after ingestion succeeds** — an advance-then-fail silently loses articles forever, and nothing
downstream would ever notice. This gets an explicit test.
**Scheduling:** do **not** add a repeatable per event. Reuse the existing cadence machinery — either add a
`newsMedia` source to `event_watch_schedules` or register one repeatable sweeper mirroring
[index.ts:361](../worker/src/index.ts#L361) with `staggerOffset("news-refresh", every)`, gated on
`newsMediaEnabled()`. The whole reason `event_watch_schedules` exists is that per-event repeatables don't
scale; don't relearn that.

### 3.2 Sockets (modified)
Reuse `emitWorkerEvent` (the cities/volcano enrich jobs' idiom), not a bespoke channel:
`event:news-media:started`, `event:news:updated`, `event:media:discovered`, `event:media:ready`,
`event:news-media:complete`. Counts and ids only — **never article bodies over Socket.IO**.

### 3.3 On-air via the FocusBundle (modified)
Attach to the bundle; do **not** add a per-cut fetch — [[focus-bundle-feature]] exists specifically to kill
the 30–80-req/cut fan-out, and a news fetch per cut would walk it straight back in.
- **Modified:** [focus/types.ts](../public/src/lib/focus/types.ts) — add `eventNews: EventNewsHeadline[]`
  (empty array when absent, never omitted — the contract's existing convention).
- **Modified:** [getFocusBundle.ts](../public/src/lib/focus/getFocusBundle.ts) — in the existing
  `db.watchedEvents.byPrimary(...)` branches (storm ~line 435, volcano ~line 467), add
  `db.eventNewsArticles.listForEvent(evt.id, {state: "MATCHED"})` to the existing `Promise.all` fan-out. One
  more indexed read on a path that already does four.
- **Modified:** [focus-client.tsx](../public/src/lib/focus/focus-client.tsx) — `useEventNews()` selector.
- **New:** `public/src/components/broadcast/EventNewsPanel.tsx` (+ `.test.tsx`) — **headline + source +
  relative time only** (see the rights position). Uses `BroadcastCard` chrome, honors
  `DeckSlideActiveContext`, pointer-inert, self-hides on empty; export `eventNewsSlideHasContent(items)`.
- **Modified:** [mode-slides.tsx](../public/src/components/broadcast/mode-slides.tsx) — add `eventNews` to
  `ModeSlideContext` and push the slide inside the existing `isTargetedEvent` branch. Declarative slide, no
  `BroadcastFrame` surgery beyond the one context field.

### 3.4 Run diagnostics (modified)
**Modified:** `/admin/events/[id]` — a **Enrichment runs** card: status, counts, provider requests, the
embedded per-lane query log with durations. When a run is `PARTIAL` or `DEGRADED` the operator must be able
to see *which lane* failed without opening a shell.

---

## PHASE 4 (P4) — Blocked on a commercial licence

**Do not build this until the rights question is answered.** Listed so the schema above stays honest about
what it is holding space for.

- Download + decode + `sha256` + `pHash` (reuse [satimg/phash.ts](../worker/src/satimg/phash.ts) — 64-bit
  dHash + `hamming`; import [weather/sharp-config.ts](../worker/src/weather/sharp-config.ts) in any new sharp
  path to cap the libvips cache). Dimension gating (`>= 640`, prefer `>= 1280`). pHash `<= 4` → visual
  duplicate, retain highest resolution, keep all source relationships.
- Blob namespace: one line — `newsMedia: makeInlineBlobStore("news-media", blobFs)` in
  [db/index.ts](../shared/src/db/index.ts) — plus a media route mirroring
  [api/events/snapshot/[snapId]](../public/src/app/api/events/snapshot/%5BsnapId%5D/route.ts).
- ffprobe in the worker image + `media_videos` fields (codec, audio, streams). Reject `duration < 2s`,
  corrupt, no decodable stream. **Do not require audio** — webcam and emergency footage is often silent.
- Qdrant + an embedding source for semantic dedup (title similarity ≥ 0.94 within 24h of the same event).
- `event_news_score_history` + `NEWS_MEDIA_V2` re-score.

---

## Reuse map

`enrich` job shape ← [jobs/events.ts](../worker/src/jobs/events.ts) · Registry client ←
[lib/openrouter.ts](../worker/src/lib/openrouter.ts) (never-throws + retry + `fetchImpl`) · enrichment loop +
self-chaining ← [jobs/cities.ts](../worker/src/jobs/cities.ts) `runWikiEnrich` (pure query builder + `run*` +
thin handler; always stamp the fetched-at so a miss isn't retried forever) · `upsertMany` bulkWrite ←
[fire-repo.ts](../shared/src/db/fire-repo.ts) · parity test ←
[broadcast-state-model.test.ts](../shared/src/db/broadcast-state-model.test.ts) · content normalisation ←
[alerts/content-hash.ts](../shared/src/alerts/content-hash.ts) · pHash (P4) ←
[satimg/phash.ts](../worker/src/satimg/phash.ts) · cadence without per-event repeatables ←
`event_watch_schedules` + [jobs/events.ts](../worker/src/jobs/events.ts) `watch` · stagger ←
[index.ts:54](../worker/src/index.ts#L54) · queue dedup ← [bull-queue.ts:89](../shared/src/bull/bull-queue.ts#L89)
· admin button ← [shared/src/jobs.ts](../shared/src/jobs.ts) · manual one-shot ←
[refreshEvents.ts](../worker/src/scripts/refreshEvents.ts) · on-air slide ← `modeSlides` +
[AlertTimelinePanel](../public/src/components/broadcast/AlertTimelinePanel.tsx) · bundle attach ←
[getFocusBundle.ts](../public/src/lib/focus/getFocusBundle.ts) event branches.

## Risks & mitigations

1. **Rights — the defining risk.** Free tier is non-commercial evaluation; the channel is commercial. V1
   stores no third-party bytes and `isPlayerAllowed` is always false. **Even broadcasting headlines is a
   human decision, not a code default** — P3.3 renders headline + source + attribution because that is
   standard newsroom practice, but the user signs that off before it goes to air. P4 does not start until a
   licence exists.
2. **Cost blowout.** Each page of each lane is a billable search action. Mitigation: the limiter lives in the
   client (P0.2), paging is a *pure, unit-tested policy* (P1.2), refresh uses the cursor not a re-search
   (P3.1), and the run doc records `providerRequests` so overspend is visible on `/admin/events/[id]` rather
   than on an invoice.
3. **Lane B relevance poisoning.** "Tokyo newspaper reports French flood" is the designed-for failure. The
   geo + place components are the defence, and the Lane-B-wrong-continent case is a named test in P0.5. Base
   lane confidence must not short-circuit the threshold.
4. **Cursor advance before ingest.** Loses articles permanently and silently. Advance only after a successful
   write; explicit test.
5. **Provider failure must never touch the parent event.** Registry exploding leaves the event existing,
   playing, and updating. `PARTIAL` is a success state (news ok + images ok + video failed = `PARTIAL`, not
   `FAILED`). The job returns `{skipped: true}` when disabled and never throws on link rot.
6. **Unknown-geo over-rejection.** Scoring unknown geo as 0 would silently delete exactly the local coverage
   Lane B exists to find. Fixed at 0.30 with its own test.
7. **Write volume.** A refresh that finds nothing must write zero rows — the same discipline as the alert and
   volcano diff hooks. Verify with a back-to-back double refresh.
8. **Registry payload drift.** Adapters ship fixtures + schema guards; `raw` is archived on the article; the
   UI never couples to a Registry shape.

## Verification

- **Unit (`./test`, must stay green):** `score.test.ts` (every component, all three thresholds, unknown-geo,
  Lane-B-wrong-continent, exclude-term); `dedupe.test.ts` (each of the five resolution steps, plus
  "duplicate stored not deleted"); `paging.test.ts` (never 3×4; stops at `maxArticles`); `media-url.test.ts`
  (every provider + the `.m3u8`/`.mpd` shapes); `resolve.test.ts` (Shibuya-not-Tokyo weighting); `client.test.ts`
  (retry on 429/5xx, **no** retry on 400/401/403, timeout, limiter caps at 3); `config.test.ts`; a refresh
  test asserting the cursor does not advance on a failed ingest; parity tests for all six new models; a
  `mode-slides` case (event + headlines → slide; event + none → absent).
- **End-to-end (local, no Docker):** after any `shared/src` edit run `./update-shared`. Needs a real
  `EVENT_REGISTRY_API_KEY` in `.env` — until one exists, the client tests run entirely on fixtures and the
  feature stays inert, which is the intended default state. Then: `NEWS_MEDIA_ENABLED=true`, pick an event
  id off `/admin/events`, `yarn refresh:event-news`, and eyeball the **News** card on `/admin/events/[id]` —
  headlines, relevance, match reasons. Run it twice: the second run must write zero new rows. Put the event
  on air via the director and confirm the news slide rotates into the left deck.
  (Don't kill the user's dev processes — ask for a restart; run the one-shots manually.)

## Build order

1. **P0.1 → P0.7** is the thin end-to-end slice: contract → client → resolve → Lane A → store → score →
   button → admin card. Land and verify it alone. At that point `EVENT → RELEVANT NEWS` genuinely works and
   everything after is quality.
2. **P1** (lanes B/C/D + paging + dedup) — the biggest single jump in news quality per line of code.
3. **P2** (media discovery, references only) — `EVENT → NEWS + FOUND MEDIA`.
4. **P3** (refresh cursor → sockets → FocusBundle → on-air → run diagnostics) — makes it live.
5. **P4** only if and when a commercial licence exists.
