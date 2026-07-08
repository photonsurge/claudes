# YouTube auto-streaming — spec (not yet built)

> Superseded in scope by [docs/streaming-runs-plan.md](docs/streaming-runs-plan.md),
> which generalizes this into N concurrent operator-started **runs** (bounded
> duration, any scene, optional chat monitoring) instead of one always-on rotating
> stream. The rotation mechanics below — broadcast create/bind/transition, the
> OAuth and obs-websocket open questions — are still the reference for how each
> run's YouTube binding actually works; read this file for that detail.

Goal: run the `/watch` globe as an unattended 24/7 YouTube live stream, rotating to a
fresh broadcast every **~11h** so we never hit YouTube's hard 12h ingestion cutoff (a
forced cutoff truncates the VOD and is worse for stats than a clean handoff). Each
rotation is a brand-new video anyway (stats reset per video regardless of whether the
RTMP connection itself is kept alive), so there's no reason to chase a seamless
rebind — a short reconnect gap on rotation is fine.

## Components involved
| Piece | Role |
|---|---|
| **OBS** | Captures `/watch`, encodes, pushes RTMP. Needs `obs-websocket` (built into OBS 28+, enable in Tools → WebSocket Server Settings). |
| **YouTube Data API v3** | Creates/ends broadcasts, binds streams, posts live chat messages. Requires OAuth (channel owner) — API key alone isn't enough for broadcast/chat writes. |
| **worker** (BullMQ) | Owns the rotation timer + orchestration job. Already the home for scheduled/background work in this repo. |
| **obs-websocket client** | Worker → OBS control channel (LAN or same box). `obs-websocket-js` (Node) talks the v5 protocol. |

## Rotation flow (every ~11h)
1. **Create next broadcast**: `liveBroadcasts.insert` (title/desc templated, e.g. date +
   time range), `liveStreams.insert` (new stream key — simplest; no rebind complexity),
   `liveBroadcasts.bind` the two together.
2. **Point OBS at the new key**: obs-websocket `SetStreamServiceSettings` (server +
   stream key from step 1), or swap a saved OBS Profile if the RTMP server differs.
3. **Stop/start OBS streaming output**: `StopStream` → (brief gap) → `StartStream`.
   Confirm actually live before touching the old broadcast (poll `liveBroadcasts.list`
   for `lifeCycleStatus: live`, or watch obs-websocket's `StreamStateChanged` event).
4. **Hand off on the outgoing stream**: post a `liveChatMessages.insert` with the link
   to the new video (and optionally pin it), before ending it.
5. **Close out the old broadcast**: `liveBroadcasts.transition` → `complete`.
6. **Schedule the next rotation** ~11h from step 3's confirmed-live timestamp (BullMQ
   delayed job, not a fixed cron, so drift doesn't compound).

## Open questions / decisions needed
- **OAuth**: which Google account owns the channel, and where do we persist the
  refresh token (env var vs. a Mongo doc like the other worker credentials)?
- **Title/description template**: static vs. pulling something dynamic from
  `ControlState` (current region/variable) at rotation time?
- **Failure handling**: if OBS fails to reconnect or the YouTube API call fails
  mid-rotation, do we retry, alert (how — email/Slack?), or just let the stream stay
  on the old (soon-to-be-cut-off) broadcast until manually fixed?
- **Where does the rotation job live**: new `worker/src/jobs/youtube-rotate.ts`,
  scheduled via BullMQ's repeatable/delayed jobs same as the weather ingest pattern.
- **obs-websocket reachability**: worker and OBS need to be network-reachable to each
  other (same box/LAN) and the websocket password stored alongside other worker env.

## Explicitly out of scope for v1
- Seamless (no-reconnect) handoff via stream rebinding — not worth the complexity
  since stats reset per-video either way.
- Auto-generated end-screens/cards inside the video itself (YouTube doesn't expose
  that via API for live broadcasts) — chat message + description link only.
