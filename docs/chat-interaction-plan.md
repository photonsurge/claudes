# Plan: viewer chat interaction (the broadcast answers the chat)

> Status: **PROPOSED** (2026-09-12). Nothing built yet.
> Goal: let viewers steer parts of the broadcast from platform chat — pick a map
> look, pick / skip / reshuffle the music, swap the colour scheme — with every
> knob **per scene** so each stream type (simple map channel vs. the full
> G.O.D.S. feed) decides what its audience may touch. Testable **without going
> live**: an operator chat simulator drives the identical pipeline from /control.
> Operator hand-typed replies (the earlier ask) are NOT in scope here — this is
> the "video interacts with the users" shape instead. LLM chat is still parked
> (see `presenter-llm-plan` memory).

## 0. What already exists (reuse, don't rebuild)

| Piece | Where | Notes |
|---|---|---|
| Chat poller (YouTube `liveChatMessages.list`) | `worker/src/stream/chat.ts` | in-process monitor per live run; logs to `db.chatLog`; relays `chat:message`; skips the backlog page |
| Command responder | `worker/src/stream/chat-commands.ts` | `:modes` / `:mode` / `:help`, arg-less regex, per-(run,cmd) 30 s cooldown, ≤2 replies per poll |
| Write path into chat | `sendChatMessage` `worker/src/youtube/client.ts:613` | posts as the connected channel; **50 quota units each**; 200-char cap |
| Quota metering | `worker/src/youtube/quota.ts` | every call via `apiCall`; spent budget blocks until PT midnight |
| Per-scene chat prefs | `ChatSettings` `shared/src/control.ts:177` (`ControlState.chat`) | `enabled`, `promoteToTicker`; mirrored onto `Run.chat` at run creation |
| Audio bed settings | `AudioSettings` `shared/src/control.ts:154` | `enabled / mode / volume / muted`; modes `auto chill lounge deep minimal breaks`; synthesized client-side on every /watch (`AuroraBed`, `public/src/lib/audio/engine.ts`) |
| Theme presets | `BROADCAST_THEMES` `public/src/components/broadcast/config.ts:96` | `aurora`, `command` (default), `storm`; per-scene `broadcastTheme` + `themeOverrides` (non-empty override wins) |
| Map looks | `shared/src/director-rois.ts` | `INTRO_MAP_TYPES` (temp cloud rain pressure aurora night world satimg), `OCEAN_MAP_TYPES` (sst wave salinity); tour stepped client-side on `spinEpoch` |
| Director | `worker/src/director/loop.ts` | worker-side, 1 s tick, re-reads `DirectorConfig` every tick; `skipNonce` = "cut now"; **no timed force/pin mechanism today** |
| Worker→browser relay | `emitWorkerEvent` `worker/src/socket.ts` → `socket/src/handlers/index.ts:28` | any `payload.type` fans to the public room; `director:state` is the precedent for worker-owned per-scene state |
| Per-scene admin cards | `public/src/app/admin/scenes/[id]/page.tsx` + `SceneDraft.tsx` | `stage()` (ControlState bucket) / `stageDirector()` (DirectorConfig bucket), one Save bar; cards stage COMPLETE top-level fields |

Gap: nothing worker-side changes what is on air except the director's own cuts;
the worker cannot emit `scene:state` (relay rejects non-user actors) and there is
no `patchScene` helper. Rather than teach the worker to write operator state, the
design below gives viewer choices their **own** worker-owned state, exactly like
director state.

## 1. Model: timed viewer requests, layered over operator state

A viewer never edits the operator's settings. A command produces a **request**
with an expiry; /watch composes the effective look as

```
operator ControlState  ←  director cut patch  ←  active viewer requests (unexpired)
```

so expiry is implicit (wall clock on both sides), operator settings are untouched,
and the /control full-state emit can never clobber a viewer pick. When the request
lapses the layer disappears and the previous look is back with no revert logic.

### 1.1 `ViewerState` (new, worker-owned, one doc per scene)

```ts
// shared/src/viewer.ts
export type ViewerSlot = "mapType" | "audioMode" | "theme";
export interface ViewerRequest {
  slot: ViewerSlot;
  value: string;              // map-type id | AudioMode | palette id
  by: { author: string; platform: StreamPlatform | "sim"; isMod?: boolean };
  requestedAt: number;
  until: number;              // ms epoch — expiry of the hold once ACTIVE
  holdMs: number;             // the hold it was granted (needed while queued)
}
export interface ViewerState {
  sceneId: string;
  active: Partial<Record<ViewerSlot, ViewerRequest>>;   // one live pick per slot
  queue: ViewerRequest[];                                // FIFO, promoted on expiry
  audioSkipEpoch: number;     // monotonic: bump = every /watch cuts to the next phrase
  audioSeed: number;          // bump = every /watch reseeds the arranger (":shuffle")
  updatedAt: number;
}
export const VIEWER_STATE = "viewer:state";             // worker → browser event
```

- Mongo model `viewer-state-model.ts` (+ repo, `db.viewerState`), keyed by scene
  id. Persisted so worker restarts keep holds; expired entries are pruned by the
  worker, never trusted by the client (client re-checks `until` itself).
- `GET /api/scenes/:id/viewer` (token/admin gated like the scene GET) for /watch
  cold start; live tail via `viewer:state` (`emitWorkerEvent`, same as
  `director:state`). No PATCH from public — public only enqueues jobs (§4).

### 1.2 Composition on /watch (`useViewerState(sceneId)` in `public/src/lib/viewer.ts`)

| Slot | Effect on the effective state |
|---|---|
| `audioMode` | `audio.mode = value` for the hold; `BroadcastBed` already reacts to `audio.mode` changes (`setMode`) |
| `theme` | `broadcastTheme` + `themeOverrides` from the scene's palette catalog entry (§3.3); `WatchSurface` re-resolves via the existing memo |
| `mapType` | applied by the DIRECTOR (§2), not by the client — the cut it emits carries the pin. Client only shows the acknowledgement |
| `audioSkipEpoch` | new `AuroraBed.skip()`: end the current phrase at the next bar boundary (the arranger already replans at bar marks) |
| `audioSeed` | new `AuroraBed.reseed(seed)`: fresh `Rng` for the arranger, applied at the next phrase boundary so it never clicks |

A tiny timer re-evaluates at the earliest `until` so the layer drops on time even
with no socket traffic.

### 1.3 Acknowledgement on air (the "video interacts" part — free, no quota)

- `ViewerPickChip` on /watch: a flat plate (no drop-shadow, theme tokens) shown for
  ~6 s on each change — "VIEWER PICK · Aurora & Space Weather · @rich · 5 min" —
  then a compact countdown while a hold is active. Placement: bottom-centre just
  above the crawl (does not touch the static right column). Widget id `viewerPick`
  so per-channel `widgetsOff` can hide it.
- Optional ticker line: ticker kind `viewer` ("Viewer pick: Aurora — thanks
  @rich"), governed by the existing `tickerKindsOff` per channel.
- Chat confirmation (`replyInChat`) is OPTIONAL and off by default: each reply is
  50 units of the 10k/day budget; when on, replies stay behind the existing
  ≤2-per-poll + cooldown limits and read "@rich → Aurora for 5 min (2 queued)".

## 2. Map-mode requests go through the director

The director is the only thing that should cut the globe. A `mapType` request is
consumed in the worker loop, not painted over the top by the client:

1. `tick()` reads `db.viewerState` for the scene (same every-second re-read as
   `DirectorConfig`). If an `active.mapType` exists and the on-air segment is not
   already honouring it, the runner cuts NOW (like `skipNonce`) to a `global`
   segment (or `ocean` for `sst / wave / salinity`) whose hold = the remaining
   hold, with the map tour pinned to that single id.
2. Pin transport: `Segment.mapTypes?: string[]` (new optional field). The client
   tour stepper (`useMapStep` / `globalMapTour`, `public/src/lib/director.ts`)
   prefers a segment-level list over `cfg.mapTypes[kind]`, so a one-element list
   parks the look instead of cycling every 6 s.
3. Priority: **breaking (tier 0) > viewer pick > normal rotation.** A fresh
   quake/storm/volcano still interrupts; when its hold ends the viewer pick
   resumes for its remaining time (the request is unchanged in the doc, so this is
   automatic).
4. Availability: a request is only granted if `useMapTypeAvailability`'s `needs`
   are satisfied on the worker side too (e.g. `aurora` needs a current OVATION
   grid; `satimg` needs feeds) — otherwise the reply/chip says "not available
   right now". Reuse the `MapTypeNeed` table; add a worker-side resolver.
5. `mode: "off"` director (manual driving) → map requests are refused with a
   scene-configurable message; audio/theme still work because they don't cut.

## 3. Command grammar & per-scene policy

### 3.1 Grammar (`parseCommand` grows args)

```
[:!]<cmd> [arg] [minutes]
```

| Command | Effect | Slot |
|---|---|---|
| `:help` / `:commands` | list what THIS scene allows (built from the policy) | — |
| `:modes` | list map looks available now | — |
| `:mode` | what is on now (unchanged) | — |
| `:mode aurora [10]` | request map look, hold = arg or scene default, clamped to max | `mapType` |
| `:music` | list music modes | — |
| `:music deep [10]` | request music mode | `audioMode` |
| `:skip` | next phrase now | `audioSkipEpoch` |
| `:shuffle` | reseed the arrangement | `audioSeed` |
| `:themes` | list palettes | — |
| `:theme storm [10]` | request palette | `theme` |
| `:queue` | what's active + what's queued | — |
| `:reset` | clear all requests (mods/owner only) | — |

Aliases are fuzzy on the value (`aurora`, `Aurora`, `space`, `space weather` all
resolve via id/title match). Unknown commands stay silent (no quota spent).

### 3.2 Policy = `ControlState.chat.commands` (extends `ChatSettings`)

Lives with the existing per-scene chat prefs; persisted on the scene doc
(`broadcast-state-model.ts` — remember the strict-schema + parity-test rule),
sanitised in `mergeControlState`, mirrored onto `Run.chat` at run creation so the
poller has it without a scene read.

```ts
export interface ChatCommandSettings {
  enabled: boolean;                    // master (default false)
  allowFrom: "all" | "mods" | "owner"; // default "all"
  perUserCooldownS: number;            // default 60
  replyInChat: boolean;                // default false (quota)
  onAirChip: boolean;                  // default true
  maxQueued: number;                   // default 10; 0 = unlimited
  mapType: { enabled: boolean; allowed: string[]; holdS: number; maxHoldS: number };
  music:   { enabled: boolean; allowed: AudioMode[]; holdS: number; maxHoldS: number;
             allowSkip: boolean; allowShuffle: boolean; skipCooldownS: number };
  theme:   { enabled: boolean; palettes: ViewerPalette[]; holdS: number; maxHoldS: number };
}
export interface ViewerPalette { id: string; label: string; broadcastTheme: BroadcastThemeId; themeOverrides?: ThemeOverrides }
```

`allowed: []` = everything the scene can show. Defaults: holds 5 min, max 15 min.

### 3.3 Admin card `ChatCommandsSettings` (`/admin/scenes/:id`)

Stages the whole `chat` object via `stage()` (Save-bar semantics). Sections:
master + who + cooldown + reply/chip; Map looks (checkbox per id, hold/max);
Music (checkbox per mode, skip/shuffle toggles, cooldown); Palettes (rows of
label + base preset + optional "use this scene's current overrides" — seeded with
the three built-in presets). Copies the `DirectorSettings` / `AudioSettings`
card pattern.

## 4. Runtime: one scene-scoped handler, two entry points

Refactor `chat-commands.ts` so the unit of work is a **scene**, not a run:

```
handleChatBatch({ sceneId, policy, msgs, source: "youtube" | "sim" })
  → parses, applies policy (allowFrom, cooldowns, allowed lists, hold clamp, queue cap)
  → mutates ViewerState (grant / queue / bump epochs), persists, emits viewer:state
  → returns { replies: string[], acks: Ack[] }   // acks feed the on-air chip
```

Entry points:

1. **Live poll** (`chat.ts`, non-backlog pages, as now) → `replies` go to
   `sendChatMessage` only when `replyInChat`.
2. **Simulator (the "not live first" path):** `POST /api/scenes/:id/chat-sim`
   (admin) `{ author, text, isMod? }` → `sendToFore("stream", "chat", "inject", …)`
   → the same handler with `source: "sim"`. Replies are NOT sent to YouTube; they
   are relayed to the operator panel as `chat:message` from the bot so the
   operator sees exactly what viewers would. Simulated messages are not written to
   `chatLog`. Effects on the scene are REAL, so run it on LOCAL/TEST or on a scene
   with no live run.

Expiry/promotion: a small worker sweep (`viewer.sweep`, every 5 s, in-process
monitor like the chat poller) prunes expired `active` slots, promotes the next
queued request for that slot (stamping `until = now + holdMs`), and emits. Cheap
and restart-safe because everything is in the doc.

## 5. Operator surface on /control

`ViewerRequestsPanel` (next to `LiveChatPanel`, visible whenever
`chat.commands.enabled`, live run or not):

- Active picks per slot with countdown + **Clear**; the queue with **Drop**;
  "Clear all" → `POST /api/scenes/:id/viewer/clear` (admin → job).
- **Chat simulator** box: "say as viewer" input, author field, mod checkbox → the
  sim route. This is how the whole feature is exercised before any stream exists.
- Bot replies appear inline in the chat tail (as they would on YouTube).

## 6. Phases

- **P0 — policy + state + simulator + music/theme.** `ViewerState` model/repo/
  event, `handleChatBatch`, policy, sim route + job, `useViewerState` composition
  on /watch, `AuroraBed.skip()/reseed()`, `ViewerPickChip`, admin card,
  /control panel. Fully testable locally with no YouTube run.
- **P1 — map looks via the director.** Loop integration, `Segment.mapTypes`
  pin, worker-side availability check, breaking-news precedence.
- **P2 — polish.** `replyInChat` confirmations, `viewer` ticker kind, per-run
  "top requesters" on `/admin/streams/:id`, Twitch/Kick once those pollers exist
  (the handler is platform-agnostic by construction).

## 7. Tests (every package stays green)

- shared: `parseCommand` with args/minutes/fuzzy values; `mergeControlState`
  sanitising `chat.commands`; persist-parity test for the new fields.
- worker: policy table (allowFrom, cooldown, allowed lists, clamp, queue cap),
  grant/queue/promote/expire, sim path sends no YouTube reply, director cuts to
  the pinned global segment and yields to tier-0, resumes after.
- public: `useViewerState` composition + expiry timer, `AuroraBed.skip/reseed`
  at bar boundaries (existing clock tests), chip render, admin card staging the
  complete `chat` object, /control panel actions.

## 8. Decisions taken (change here if wrong)

1. Viewer picks are a separate worker-owned layer (`ViewerState`), not writes to
   operator `ControlState` — no revert logic, no /control clobber, restart-safe.
2. Map looks are honoured by the director cutting to a pinned global/ocean
   segment; breaking news still wins.
3. Arbitration is FIFO with a per-user cooldown, one active pick per slot, a
   scene-configurable queue cap. Voting is deferred.
4. Confirmations are on air (chip/ticker, free) by default; chat replies are an
   opt-in because each costs 50 quota units.
5. Policy lives on `ControlState.chat.commands` (with the existing chat prefs),
   edited on `/admin/scenes/:id`; live controls + simulator live on `/control`.
