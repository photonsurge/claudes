# Plan: multi-run live streaming (bounded-duration runs + chat monitoring)

> Status: **v2 IMPLEMENTED** — multi-view / constant streams (see the v2 section
> directly below). v1 (single-encoder bounded runs) as-built notes follow it.
> Goal: let an operator start/stop N concurrent, time-boxed broadcast **runs** (each
> bound to an existing scene, each optionally publishing to YouTube, each optionally
> monitoring platform chat) instead of the single always-on `/watch` capture we had.
> Generalizes and folds in `YOUTUBE.md`'s single-rotating-stream design rather than
> replacing it — see that file for the YouTube broadcast create/bind/transition
> mechanics, which still apply per-run. LLM-based chat moderation/narration is
> explicitly out of scope here (parked separately, see `presenter-llm-plan` memory).

## As built (v2 — multi-view / constant streams)

Goal: **N concurrent, always-on ("constant") streams** — e.g. three simple map
scenes each live on YouTube 24/7 — instead of v1's single at-a-time bounded run.

1. **Encoder registry (`StreamEncoder`, collection `streamencoders`).** One OBS
   instance still has exactly ONE streaming output, so concurrency = one
   registered instance per stream. Each doc holds the obs-websocket url, an
   optional secretbox-encrypted password (`passwordEnc`, same scheme as the
   YouTube tokens — public writes it, only the worker decrypts), and the
   `sceneId` its browser source captures (run-creation auto-picks by scene).
   `worker/src/obs/client.ts` is now per-endpoint (connection cache keyed by
   url); `worker/src/stream/encoders.ts` resolves run→endpoint. The legacy
   `OBS_WEBSOCKET_URL` pair lives on as the implicit `env` encoder — a run with
   no `encoderId` collapses onto it (`encoderKeyForRun`), so single-OBS setups
   need no registry. The one-publishing-run guard is now **per encoder**
   (`activeRunForEncoder`), both in the POST /api/streams pre-check and the
   goLive race-check.
2. **Persistent slots (`StreamSlot`, collection `streamslots`).** Desired-state
   layer: while a slot is enabled, the worker keeps an UNBOUNDED run live on its
   scene/encoder/account. A repeatable `run-lifecycle.reconcile` job (60s,
   `STREAM_RECONCILE_MS`) restarts dead runs with exponential backoff
   (`slotRetryDelayMs`: 30s→15min, `failCount` forgiven after 5 healthy live
   minutes) and ends the run of a disabled slot. Manual stop of a slot-owned run
   **auto-disables the slot** (stop route) so the reconciler doesn't resurrect
   it; deleting a slot ends its run. All external work goes through the existing
   run-lifecycle jobs — the sweep only reads + enqueues.
3. **Quota guard:** unbounded runs poll YouTube-side health every ~2 min
   (`YT_HEALTH_EVERY_UNBOUNDED`) instead of 30s — three 24/7 streams at 30s
   would burn ~8.6k of the 10k/day API quota on health alone. OBS-side health
   stays at 5s (free).
4. **No broadcast rotation.** YouTube's ~12h limit only affects VOD archiving;
   the live stream itself runs indefinitely, so constant streams skip rotation
   entirely. Revisit only if per-stream VODs become a requirement.
5. **UI:** `/admin/streams` gains an *OBS encoders* card and a *Constant
   streams* card (the slot enable switch IS the go-live/off control; new slots
   are created off). Run rows show encoder + a "constant" marker; the /control
   StreamPanel badges slot-owned runs `CONSTANT`.

v2 files: shared — `runs.ts` (+encoder/slot types + helpers),
`db/{stream-encoder,stream-slot}-model.ts`, `db/index.ts` accessors,
`db/run-model.ts` (+`encoderId`/`slotId`). worker — `obs/client.ts` (per-endpoint),
`stream/{encoders,slots}.ts`, `jobs/run-lifecycle.ts` (+reconcile), `index.ts`
(repeatable). public — `api/streams/{route,encoders/*,slots/*,[id]/stop}`,
`lib/stream.ts`, `components/admin/streams/{EncodersCard,SlotsCard}.tsx`,
`admin/streams/page.tsx`, `StreamPanel.tsx`. OBS multi-instance recipe:
[obs-setup.md](obs-setup.md) § "Multi-stream (the encoder registry)".

## As built (v1 — deviations from the original plan below)

Shipped this build; the phased design below is the historical plan. Key changes:

1. **OBS automation is IN v1** (the plan deferred it to manual key-paste). The worker
   drives OBS over `obs-websocket-js` (`worker/src/obs/client.ts`), endpoint
   configurable via `OBS_WEBSOCKET_URL`/`OBS_WEBSOCKET_PASSWORD`. If OBS is
   unreachable the run parks in a new **`awaiting-ingest`** status and surfaces the
   stream key for a manual paste — a graceful fallback, not a failure.
2. **Routes are `/admin/streams` + `/api/streams`**, NOT `/admin/runs` — that path is
   already the director's as-run log (`AirRun`). The Mongo model is `Run` (collection
   `runs`, no clash with `airruns`); socket events are `run:state` / `run:status` /
   `chat:message`.
3. **Confirm-ingest + health + chat run as IN-PROCESS monitors** (one per run, keyed
   in `worker/src/stream/monitor.ts`), mirroring the auto-director's in-process loop —
   this avoids BullMQ's self-reschedule jobId collision. **Auto-END stays a durable
   BullMQ delayed job** (`run-end-<id>`), cancelled on manual stop with
   `queue.getJob(id).remove()` (NOT `removeJobScheduler` — that's for repeatables).
   The boot reconciler `rearmLiveRuns()` restores monitors + re-arms auto-end after a
   worker restart.
4. **`goLive` is `attempts:1` + resumable** (guards each step on persisted
   `broadcastId`/`phase`) — no blind BullMQ retry against the non-idempotent
   `liveBroadcasts.insert`.
5. **No `socket/` relay change** — worker-emitted `run:*` / `chat:message` already pass
   `canRelayWorkerEvent`. The socket projection is **secret-free** (`toRunState` strips
   the RTMP key, which the admin-only `GET /api/streams/:id/key` serves instead).
6. **OAuth code→token exchange happens in the WORKER** (`youtube.exchangeCode` job); the
   public routes only build the consent URL + delegate, so the client secret + the
   AES-GCM token key never enter `public`. Refresh token stored encrypted
   (`shared/src/utill/secretbox.ts`) in `youtube-account-model`.
7. **Chat = mirror only (display in /control).** The worker chat poller
   (`worker/src/stream/chat.ts`) → `chat:message` → `LiveChatPanel`. **Promote-to-ticker
   is DEFERRED**: the on-air ticker is computed from quakes/tracks/alerts, so promoting
   needs a new operator-promoted-lines path through the broadcast render — its own
   follow-up, not built here. Twitch/Kick still deferred.

As-built files: shared — `runs.ts`, `db/run-model.ts`, `db/youtube-account-model.ts`,
`utill/secretbox.ts`, `+chat` on ControlState. worker — `obs/client.ts`,
`youtube/client.ts`, `stream/{lifecycle,monitor,chat}.ts`, `jobs/{run-lifecycle,youtube}.ts`.
public — `lib/{stream,chat,require-admin}.ts`, `components/StreamPanel.tsx`,
`components/control/LiveChatPanel.tsx`, `app/admin/streams/`, `app/api/streams/*`,
`app/api/youtube/*`, real `StreamStatusBadge`.

## Where we are today

The multi-stream substrate already exists — it's the *time-boxing* and the
*platform binding* that are missing.

| Piece | State |
|---|---|
| Multiple concurrent named streams | **Already built.** `shared/src/control.ts` `SCENE_STATE` event + `SceneMeta`; `shared/src/db/broadcast-state-model.ts` one Mongo doc per scene (`id`, `name`, `watchToken`); `/api/scenes/*`, `/watch/:id`, `/admin/scenes`, `/admin/access` (tokened OBS-source URLs). Each scene is a permanent, manually-created, always-on config — no lifetime, no external platform tie-in. |
| Bounded lifetime / start-stop-auto-end | **Missing entirely.** Closest analogs are `DirectorConfig.mode: "off"\|"auto"` (per-scene, persisted, no end time) and the director loop's in-memory per-segment `endsAt` hold timer (single always-on process, not a schedulable run). No BullMQ self-terminating job pattern exists anywhere yet. |
| YouTube API integration | **Nothing built.** No `googleapis` dependency, no OAuth, no `.env.sample` entries. `YOUTUBE.md` is a detailed spec (not yet built) for a single unattended 24/7 stream that rotates broadcasts every ~11h to dodge YouTube's 12h ingestion cutoff. Its rotation flow (create → bind → confirm live → close old) is the right mechanic, just scoped to one stream instead of N operator-started runs. |
| Chat monitoring | **Nothing built**, but shape agreed this session (see Decisions). |
| Socket fan-out model | All browsers join one `PUBLIC_ROOM`; every scene's `SCENE_STATE`/`DIRECTOR_STATE` traffic goes to every browser and is filtered client-side by an `id` in the payload — broadcast-then-filter, not room-per-scene. Fine at current scale; worth re-checking if run count grows large (see Open questions). |
| Worker job scheduling | BullMQ only, via fixed `jobId` + `{repeat: {every|pattern}}`. `worker/src/index.ts:137-147` warns that changing a repeatable's interval under the same `jobId` leaves the *old* schedule firing alongside the new one unless explicitly cleared — directly relevant once runs start adding/removing delayed jobs dynamically. |

## Decisions (locked in)

1. **A "run" is a new Mongo collection referencing `sceneId`, not fields bolted
   onto `BroadcastState`.** Scenes stay permanent/reusable config; runs are the
   bounded-lifetime layer on top. One scene can host many runs over time.
2. **One active run per scene at a time.** A scene's `ControlState` is singular
   (camera/director/etc.) — a second concurrent run on the same scene would fight
   over control. Concurrency comes from running on *different* scenes, not
   stacking runs on one.
3. **Auto-end via a BullMQ delayed job** (`{delay: durationMs}`), not a cron —
   this is exactly what `YOUTUBE.md` already proposed for rotation, and it
   generalizes cleanly to "end this specific run."
4. **Chat is operator-only, never on-air by default.** A `LiveChatPanel` lives in
   `/control`, not `/watch` — putting unmoderated viewer chat in front of viewers
   is a bigger product decision than operator visibility into it. Highlights
   (e.g. superchats) get an explicit manual **promote-to-ticker** action into the
   existing `summary` Ticker segment kind — curated, not automatic.
5. **YouTube chat = worker poll job** (`liveChatMessages.list`, no push API
   exists — server-given `pollingIntervalMillis`, typically 2–5s). **Twitch/Kick
   chat = persistent adapter living in the `socket` process** (real push
   transport: Twitch IRC via `tmi.js`, or EventSub over WS) — different
   transport shape, different home. Both normalize to one message shape before
   they reach the client.
6. **v1 ships YouTube publish automation only.** Twitch/Kick are chat-monitoring
   sources in v1, not outbound streaming targets — actually publishing to them is
   a distinct, larger scope for later.

## Core concept

```
Run.status: scheduled → live → ending → ended
                       ↘ stopped (manual, any point before ended)
                       ↘ failed  (platform binding error)

on create (POST /api/runs { sceneId, durationMs?, platforms, chat }):
  if platforms.youtube: client.createBroadcast() + bindStream()  → store ids on run
  status = "live"; startAt = now
  if durationMs: BullMQ delayed job "run-end:<runId>", delay: durationMs
  emit RUN_STATE

on delayed job fire (auto-end)  OR  POST /api/runs/:id/stop (manual):
  status = "ending"
  if platforms.youtube: client.transitionToComplete()
  status = "ended"; endedAt = now
  cancel any still-pending "run-end:<runId>" job (manual-stop path)
  emit RUN_STATE
```

Run doc shape:
```
Run {
  _id, sceneId,
  status: "scheduled"|"live"|"ending"|"ended"|"stopped"|"failed",
  startAt, durationMs (null = unbounded, manual stop only), endedAt,
  platforms: {
    youtube?: { broadcastId, streamId, liveChatId, channelId, accountId },
    twitch?:  { channelLogin, chatOnly: true },
    kick?:    { channelSlug,  chatOnly: true },
  },
  chat: { enabled, promoteToTicker },
  createdBy, createdAt, updatedAt
}
```

Normalized chat message (both transports funnel into this before hitting the
client — mirrors the `worker:event` relay pattern already used for other
worker→socket traffic):
```
ChatMessage { runId, sceneId, platform: "youtube"|"twitch"|"kick",
              author, text, ts, isMod, superchatAmount? }
```

## Phases

### Phase 0 — Run data model (`shared/`)
- `shared/src/db/run-model.ts` (new): Mongoose schema per the shape above.
- `shared/src/db/index.ts`: `createRun`, `getRun`, `listRuns(sceneId?)`,
  `updateRun`, `endRun` — mirrors the existing scene data-access layer
  (`getOrInitBroadcastState`, `listScenes`, ~L150-260).
- `shared/src/runs.ts` (new): `RUN_STATE` socket event (mirrors `SCENE_STATE` in
  `control.ts`), `RunStatus` type, `CHAT_MESSAGE` event + `ChatMessage` type.
- `shared/src/db/broadcast-state-model.ts`: add minimal `chat: { enabled,
  promoteToTicker }` to `ControlState` — must land here too, not just the type,
  per the strict-Mongoose parity requirement (`controlstate-persist-schema.md`).

### Phase 1 — Run lifecycle control (`worker/` + `public/`)
- `worker/src/jobs/run-lifecycle.ts` (new): BullMQ delayed job handling
  auto-end + manual-stop cancellation. Must explicitly remove the prior delayed
  job by id before re-adding on any duration change — same caveat `index.ts`
  already documents for repeatables.
- `public/src/app/api/runs/route.ts` (new): `POST` create+start, `GET` list.
- `public/src/app/api/runs/[id]/stop/route.ts` (new): `POST` stop.
- `public/src/app/admin/runs/page.tsx` (new): pick scene, duration (or
  unbounded), platforms to bind; Start/Stop buttons mirror the `stoppable` job
  pattern already in `shared/src/jobs.ts` / the admin Jobs panel.

### Phase 2 — YouTube binding (`worker/` + `shared/`)
- `shared/src/db/youtube-account-model.ts` (new): OAuth refresh token storage,
  one doc per connected channel — resolves `YOUTUBE.md`'s open "env var vs
  Mongo" question in favor of Mongo (multi-channel is plausible once runs
  exist).
- `worker/src/youtube/client.ts` (new): `googleapis` wrapper —
  `createBroadcast`, `bindStream`, `transitionToLive`, `transitionToComplete`,
  `resolveLiveChatId`. Lifts steps 1/3/5 of `YOUTUBE.md`'s rotation flow,
  adapted to fire per-run instead of per-11h-rotation.
- `worker/src/jobs/run-lifecycle.ts`: extended to call into `client.ts` on run
  start/end.
- Add `googleapis` to `worker/package.json`.
- **v1 ships manual stream-key handoff** (operator copies the key into OBS) —
  no `obs-websocket` automation yet. Same deferral `YOUTUBE.md` already made;
  not re-litigated here.

### Phase 3 — Chat ingestion (`worker/` + `socket/` + `public/`)
- `worker/src/jobs/youtube-chat.ts` (new): self-rescheduling BullMQ delayed job
  per live run with a YouTube binding — polls `liveChatMessages.list`,
  re-schedules itself at the server-given `pollingIntervalMillis`, emits
  `CHAT_MESSAGE` via `emitWorkerEvent`. Not Mongo-cached — chat is ephemeral,
  not historical data.
- `socket/src/adapters/twitch.ts` (new): persistent `tmi.js` connection,
  opened/closed on `RUN_STATE` transitions for runs with a Twitch binding.
  Kick would reuse the same adapter shape with a different client — not built
  in v1, deferred until the Twitch path proves out.
- `socket/src/handlers/relay.ts`: extend the relay policy so `CHAT_MESSAGE`
  from the worker (YouTube path) is allowed through the same way `worker:event`
  is today.
- `public/src/lib/chat.ts` (new): `useChatMessages(runId)` — mirrors
  `useSceneState`'s cold-start + live-subscribe shape.
- `public/src/components/control/LiveChatPanel.tsx` (new): operator-only,
  mounted in `/control`. "Promote to ticker" action on a message pushes it into
  the existing `summary` Ticker segment.

## Explicitly out of scope for v1
- On-air chat display (any `/watch` component) — operator-only, per Decision 4.
- LLM-based abuse detection, auto-moderation, or auto-narration of chat —
  parked separately, not part of this spec.
- Twitch/Kick as outbound publish targets — chat monitoring only in v1.
- `obs-websocket` automation of the stream-key handoff — manual for v1, same
  deferral as `YOUTUBE.md`.
- Seamless/no-reconnect stream rebinding — carried over from `YOUTUBE.md`,
  still not worth the complexity (stats reset per-video regardless).

## Open questions / decisions needed
- **OAuth token encryption at rest**: Mongo storage is decided (Phase 2); the
  encryption mechanism (app-level secret vs KMS) isn't.
- **`ControlState.chat.{enabled,promoteToTicker}` scope**: this plan defaults to
  per-scene (persistent operator preference, survives across runs on that
  scene). Could instead reset per-run if that's a better fit — flag if so.
- **Title/description templating** for YouTube broadcasts (static vs pulled from
  `ControlState` at run-start time) — carried over unresolved from `YOUTUBE.md`.
- **Failure handling/alerting** if a YouTube API call or the OBS handoff fails
  mid-run (retry / alert channel / leave on old broadcast) — carried over
  unresolved from `YOUTUBE.md`.
- **Socket fan-out at higher run counts**: broadcast-then-filter is fine today;
  revisit room-per-run if concurrent run count grows enough to matter.

## Scope
~9 new files (shared: 3, worker: 4, socket: 2, public: 5 — some overlap in
counting shared helpers) + edits to ~4 existing files, across all four
phases/packages. Similar order of magnitude to `regional-highres-plan.md`.

## Start here
Phase 0 (run data model) — every later phase reads/writes through it, and it's
where the "new collection vs fields-on-scene" call gets made concrete in code
before anything schedules against it.
