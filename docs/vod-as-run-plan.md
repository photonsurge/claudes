# VOD as-run pages — one page per YouTube video, what aired and when

Status: ALL THREE PHASES BUILT (2026-09-11) — `/admin/streams/:id`, chapters in the video description (`run-lifecycle.chapters`, `YOUTUBE_CHAPTERS`), public `/vod/:videoId`. What's below is the design as shipped; deviations are noted inline.

## The ask

Every YouTube broadcast we run (a streaming `Run` with a `platforms.youtube.broadcastId`)
should have its own page listing what the director put on air during that video and
*where in the video* it is — so "that quake at 1:23:45" is a click, not a scrub.

## What already exists (and the gap between the two halves)

| Half | Where | What it knows |
| --- | --- | --- |
| Streaming runs | `shared/src/runs.ts`, `db.listRuns/getRun`, `/admin/streams`, `/api/streams/*` | scene, YouTube `broadcastId` (= the video id), `watchUrl`, `startAt` (ms, stamped by the worker at the ready→live commit), `endedAt`, status, chat log (`db.chatLog.listForRun`) |
| As-run log | `shared/src/db/air-log-{model,repo}.ts`, `/admin/runs`, `/admin/runs/:id` | one `AirRun` per auto-director session per scene; one `AirEntry` per cut with `sceneId`, `startedAt`, `endedAt`, kind, subject, title, camera, hold, tour stops |

There is **no key between them**. A `Run` never learns which cuts aired on it, and an
`AirEntry` never learns which video it went out on. The two are joined only by
`sceneId` + wall-clock, and that is exactly the join this feature makes explicit.

Recording facts that shape the page (verify in code, not from memory):

- Only **auto-director cuts** are logged. Time the operator drives by hand is a gap in
  the log, not a shot — the page must draw those gaps honestly ("operator-controlled,
  not logged"), never hide them.
- Client-side sub-cuts (slide decks, map-type cycles from `public/src/lib/director.ts`
  `cutSteps`) are **not** recorded; round-up `stops` are recorded but carry no times
  (they can be spread evenly across the entry's `actualMs` as an estimate, labelled so).
- A video can span **several AirRuns** (auto toggled off/on mid-stream) and an AirRun
  can outlive a video (the director keeps cutting after the stream ends). Neither side
  owns the other; the page is a time-window view.
- The log only started 2026-07-08 — older videos show "no as-run data for this video".
- AirEntries are never pruned today (fine — a row per cut, small).

## Design

### 1. The join: scene + time window (no new foreign key)

Add to `air-log-repo.ts`:

```ts
/** Every cut that was on air for `sceneId` at any point inside [from, to). */
listEntriesInWindow({ sceneId, from, to }): Promise<iAirEntry[]>
// query: { sceneId, startedAt: { $lt: to }, $or: [{ endedAt: { $gt: from } }, { endedAt: null }] }
// sort startedAt asc. Served by the existing airentry_scene_ix (sceneId, startedAt).
```

Window = `[run.startAt, run.endedAt ?? now]`. Entries straddling the edges are clipped
for display (an entry that started 30 s before go-live shows as "on air from 00:00").

Why not stamp a `streamRunId` on each `AirEntry` at cut time? The director loop would
need a per-cut lookup of the scene's active run (or a cache that goes stale across
worker restarts), it wouldn't cover the ~2 months of videos already recorded, and
`activeRunForScene` already guarantees one active run per scene so the window join is
unambiguous. Denormalise later only if the query ever shows up as slow (it won't —
it's one scene, one time range, indexed).

### 2. Video time base: YouTube's `actualStartTime`, not our `startAt`

A VOD's `t=` is relative to the instant YouTube put the broadcast live
(`liveStreamingDetails.actualStartTime`). Our `run.startAt` is stamped by the worker a
moment after asking for that transition — same second give or take, plus a fixed
pipeline latency (browser → OBS → RTMP → YouTube, typically 5–30 s): what a viewer
sees at `t` was captured `latency` earlier on our clock.

- Persist YouTube's own numbers on the run: `platforms.youtube.actualStartTime` /
  `actualEndTime` (epoch ms). **Two writers, both free**: `worker/src/youtube/video-stats.ts`
  already calls `videos.list(part=liveStreamingDetails)` for every run on the /admin/streams
  poll — copy the fields onto the run doc when first seen (no extra quota); and `finishRun`
  does one `videos.list` (1 unit) before marking the run ended so a video that nobody
  looked at on /admin/streams still gets stamped. **Both fields must be added to
  `run-model.ts` too** — strict Mongoose drops unknown keys (the ControlState lesson).
- `offsetMs(entry) = entry.startedAt − (yt.actualStartTime ?? run.startAt) + VOD_LEAD_MS`,
  clamped ≥ 0 (a frame captured at C reaches YouTube at C + lead, so cuts sit LATER in
  the VOD than on our clock). `VOD_LEAD_MS` is one env constant (default 0) the operator tunes once after
  eyeballing a VOD against the page; document it in `.env.sample`. Pure helper in
  `shared/src/vod.ts` with tests, used by the page, the API and the chapters job.

### 3. The page: `/admin/streams/:id`

One run = one video, so the run id is the route key (consistent with the
`/api/streams/:id/*` surface). The header shows the video id and links the watch URL.

Layout (admin MUI, `AdminPageShell`, crumbs Streams → title):

- **Header**: title, scene name, channel, status chip, went-live → ended (UK + UTC),
  duration, views/likes (reuse `useYoutubeVideoStats`), "Watch ↗".
- **Player**: the YouTube embed (`youtube.com/embed/<id>?enablejsapi=1`) via the IFrame
  API so timeline rows can `seekTo`. Falls back to plain `watchUrl&t=<s>` links when the
  embed can't load (no VOD yet, private video, blocked). The player is the only reason
  to put this on a page at all rather than a dialog like chat.
- **Timeline**: reuse `RunTimelineEntry` with one addition — the rail shows the **video
  offset** (`1:23:45`) instead of the wall-clock, and a ▶ button seeks the player. Kind
  chips + counts at the top exactly as `/admin/runs/:id`.
- **Gaps and sessions**: between AirRuns (or before the first cut) render a grey
  "operator-controlled · 12m 05s · not logged" block, so the timeline adds up to the
  video's length. Entries clipped at go-live/end are marked "joined in progress".
- **Live**: while the run is live the page polls like `/admin/runs/:id` (5 s) and the
  player is the live stream — offsets still work because YouTube's live DVR is on the
  same time base.
- **Chat (phase 2)**: a toggle interleaves `chatLog.listForRun` messages by offset, so
  "someone asked what that was" sits next to the shot it was about.

API: `GET /api/streams/:id/asrun` (admin, `withApiLog`) →
`{ run: RunState, video: { id, watchUrl, actualStartTime, actualEndTime }, sceneName,
sessions: [{ airRunId, from, to }], entries: (AirEntry & { offsetMs, clipped })[] }`.
Offsets computed server-side from the one helper so the page never re-derives them.

Discovery: a **"As-run"** link on every `RunRow` on /admin/streams (next to Chat), and
the reverse link on `/admin/runs/:id` ("aired on video ▸ …" when a run's window overlaps
a video — `db.listRuns({ sceneId })` filtered by overlap; cheap, few runs).

### 4. Phase 2 — publish chapters into the video description (SHIPPED)

As built: `worker/src/stream/chapters.ts` (`publishChapters`, `queueChapters`, `chaptersEnabled`),
`shared/src/vod.ts` (`buildChapters`, `chapterBudget`, `composeDescription`, `ownDescriptionText`),
`shared/src/vod-bundle.ts` (`loadAsRunTimeline` — the ONE timeline loader the admin page, the
public page and the chapters job all share), `setVideoDescription` in `worker/src/youtube/client.ts`
(`videos.update` = 50 units, now in the quota table), button route `POST /api/streams/:id/chapters`.
Default ON after every YouTube run ends (30 s delay, 5 attempts); `YOUTUBE_CHAPTERS=off` disables
the automatic publish only. Outcome on `run.chapters {publishedAt,count,error}`. Our block is headed
`⏱ As aired` and always sits LAST; the operator's text above it is preserved, anything typed below
it is replaced on the next publish. Footer links the public page (§5).

The other half of "tie YouTube in": once a run ends, write the as-run digest into the
video's description as YouTube chapters, so the tie-in is visible on YouTube itself.

- New queued job `run-lifecycle.chapters { runId }` enqueued from `finishRun` (mirrors
  `announce`: own job, 5 attempts, backoff; idempotent via `run.chaptersAt`), plus a
  "Publish chapters" button on the page for re-runs and old videos.
- `videos.update` **replaces the whole snippet** — must `videos.list(part=snippet)` first
  and send title + categoryId + tags back unchanged, or they're wiped. Cost 1 + 50 units.
- Chapter rules: first line `00:00`, ≥3 chapters, each ≥10 s, ascending. Description cap
  5,000 chars, so a 24 h constant stream at 15 s holds (~5,000 cuts) cannot be listed
  raw. `buildChapters(entries, budget)` in `shared/src/vod.ts` (pure, tested):
  1. merge consecutive entries with the same `segmentId`;
  2. drop entries < 10 s;
  3. rank: breaking first, then first airings (`timesShown === 1`), then by hold;
  4. keep the top N that fit the char budget, re-sort by offset, prefix `00:00 Globe`;
  5. append the run's existing description text and (if phase 3 ships) the public page link.
- Quota: 3 constant streams recycling daily ≈ 150 units/day. Negligible.

### 5. Phase 3 — public page per video (SHIPPED)

As built: `GET /api/vod/:videoId` (anonymous, secret-free projection, finished videos cached 5 min
via `withCache`, live ones rebuilt per poll) and `/vod/:videoId` (own layout mounting the MUI
theme, reuses `VodPlayer` + `VodTimeline` with `subjectLinks={false}` so nothing links into /admin).
`db.getRunByBroadcastId` + sparse index `run_broadcast_ix`.

`/vod/:videoId` (video id, not run id, since that's what a viewer has), read-only,
secret-free like `/api/streams/live`. Needs `db.getRunByBroadcastId` + an index on
`platforms.youtube.broadcastId`. Same timeline component minus admin chrome; the chapters
job links to it. Not in scope until the admin page has proven the data reads well.

### 6. Loose ends closed (2026-09-11)

- **Chat on the admin timeline**: "Show chat" toggle on `/admin/streams/:id` loads the run's
  chat log and interleaves each message after the cut that was on air when it landed
  (`VodTimeline` `chat` prop; offsets from the same time base). Admin only.
- **Round-up stops** get ESTIMATED offsets (spread evenly across the shot, marked ≈, each
  seekable) — `estimateStopOffsets` in `VodTimeline`. The log still records no stop times.
- **12 h warning**: `vodArchiveAtRisk()` (shared/vod) drives a "no VOD" chip on every slot row
  set to never / 12h / 24h, plus a sentence in the card blurb. Nothing is enforced.

## Gotchas to flag before building

1. **YouTube does not archive live streams longer than 12 hours.** Constant-stream slots
   with `restartEveryMs` ≥ 12 h produce videos with **no VOD** — the page would still
   render the log but the player and every `t=` link would be dead. If the operator
   wants these pages for the constant streams, slot recycle must be ≤ 12 h (the UI
   already offers 1–24 h; nothing enforces the ceiling — worth a warning in `SlotsCard`).
2. Two clocks: the worker's and YouTube's. `actualStartTime` removes the transition
   jitter; `VOD_LEAD_MS` removes pipeline latency. Expect ±2 s residual — fine for a
   15 s hold, so don't over-engineer.
3. Hand-driven time is a gap by design. If that turns out to matter, the fix is a
   separate feature (log operator cuts from the socket relay), not a fudge here.
4. Runs with no YouTube binding (OBS-only) have no video: the page still works as a
   plain as-run window view with wall-clock offsets, no player.

## Files

| Package | File | Change |
| --- | --- | --- |
| shared | `src/db/air-log-repo.ts` (+test) | `listEntriesInWindow` |
| shared | `src/runs.ts`, `src/db/run-model.ts` | `YoutubeBinding.actualStartTime/actualEndTime`, `Run.chaptersAt` (phase 2) |
| shared | `src/vod.ts` (+test) | `vodOffsetMs`, `fmtOffset`, `clipToWindow`, `buildChapters` |
| worker | `src/youtube/video-stats.ts` | persist actualStart/End when seen |
| worker | `src/stream/lifecycle.ts` | `finishRun`: stamp times; phase 2 enqueue chapters |
| worker | `src/stream/chapters.ts`, `src/jobs/run-lifecycle.ts` | phase 2 job |
| public | `src/app/api/streams/[id]/asrun/route.ts` (+test) | the bundle |
| public | `src/app/admin/streams/[id]/page.tsx` | the page |
| public | `src/components/admin/streams/VodPlayer.tsx`, `VodTimeline.tsx` | player + timeline w/ offsets + gaps |
| public | `src/components/admin/RunTimelineEntry.tsx` | optional `offsetLabel` / `onSeek` props |
| public | `src/app/admin/streams/page.tsx`, `src/app/admin/runs/[id]/page.tsx` | cross-links |
| root | `.env.sample` | `VOD_LEAD_MS` |

After touching `shared/src`: `./update-shared`. Worker restart needed for the
stamping + job (user restarts).

## Order of work

1. Shared: window query + `vod.ts` helpers + run fields (tests).
2. Worker: stamp `actualStartTime/EndTime` (video-stats + finishRun).
3. Public: `/api/streams/:id/asrun` + the page + the two links. **← the deliverable**
4. Phase 2 chapters job + button.
5. Phase 3 public `/vod/:videoId` if wanted.
