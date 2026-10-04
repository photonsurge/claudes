# Director programme plan — per-channel config, break-ins, commands and viewer chat

> **Status: Phases 1–9 BUILT** (combined 2026-10-04; phase 1 on
> `claude/director-phase1-foundations`, phases 2–9 on
> `claude/director-phase2-admin-cards`, one commit per phase). Still open from
> phase 9: the `viewer` ticker kind (`chat.promoteToTicker` has no ticker
> behind it yet) and Twitch/Kick (no pollers yet). Built differently from the
> text below: a mod's `:clear` drops viewers' requests only, never the
> operator's; a `:mode` look always waits for the next shot change; the
> `ocean` template sets a slower depth cycle (`tempo.depthCycleS`) since there
> is no depth-cycle switch; Copy from channel also leaves out `mode`. This document
> **replaces four plans** written on 2026-09-12 that kept pointing at each
> other: the per-channel director config plan, the director break-ins plan,
> the director commands plan and the viewer chat interaction plan. The
> originals are in git history (`git log -- docs/director-break-in-plan.md`
> and so on). Each section below notes which original it came from (`[cfg]`,
> `[brk]`, `[cmd]`, `[chat]`) so earlier discussion can still be traced.
>
> Everything was re-checked against the code on `singleVideos` (`3fe9fca`).
> The constants, the loop's cut path and the chat poller are still as the
> originals described them. One thing has changed since: the
> [scene settings refinement](./scene-settings-refinement-plan.md) shipped on
> 2026-09-13. `/admin/scenes/:id` now has a draft that owns the data, a card
> catalog and a group rail, so this plan uses that card contract (§7) rather
> than the per-card fetch/`epoch` pattern the originals assumed.

## What this delivers

One auto-director per channel that:

1. is **fully configurable per channel** from `/admin/scenes/:id`, covering
   pacing, pools, rotation, tours and looks, with templates per stream type.
   Today most of this lives in constants. `[cfg]`
2. **breaks into the running shot** when something new lands (a fresh quake,
   a just-issued severe warning, an eruption, optionally a favourite place's
   round-up), groups bursts into one cut, and shows an on-air **INCOMING**
   reticle while the camera flies. `[brk]`
3. takes **commands through one queue**. The operator can Take, Go to, Hold,
   Pause and Skip, and, if a channel allows it, viewers can make requests
   from chat (`:show japan`, `:roundup uk`, `:mode aurora`). `[cmd]`
4. **answers the chat**. Viewers can pick the music, skip or shuffle it and
   pick the palette, each with a timed hold and on-air credit. Every switch is
   per channel, and an operator simulator exercises all of it without going
   live. `[chat]`

## Contents

0. What exists today
1. Guiding decisions
2. How the pieces fit: inputs, precedence, layers
3. Shared contracts
4. Worker
5. Chat runtime
6. On air (`/watch`)
7. Admin (`/admin/scenes/:id`)
8. Operator desk (`/control`)
9. As-run log and the per-video record
10. Persistence
11. Build order
12. Tests
13. Decisions taken
14. Assumptions to confirm
15. Later / out of scope

---

## 0. What exists today

### 0.1 Director

- The loop runs **in the worker only**
  ([director/loop.ts](../worker/src/director/loop.ts)), one `SceneRunner` per
  auto-mode scene, on a 1 s tick. It re-reads `DirectorConfig` every tick. **A cut
  only happens when the current shot has expired or the operator bumped
  `skipNonce`** (`expired || skipRequested`, loop.ts ~L264). There is no
  mid-shot interrupt and no other external input.
- "Breaking news" is a **boundary** preempt. `selectPriority`
  ([director-select.ts](../shared/src/director-select.ts)) runs before fair
  rotation on every cut except the opener. It walks `PRIORITY_KINDS` (quake → storm →
  volcano) and takes unaired candidates whose `Candidate.breaking` flag is not
  false. Freshness is hard-coded in
  [candidates.ts](../worker/src/director/candidates.ts):
  `BREAKING_NEWS_WINDOW_MS` = 20 min, `VOLCANO_BREAKING_WINDOW_MS` = 6 h. A
  one-normal-cut cooldown (`r.lastCutWasPriority`) keeps it from firing every cut.
  None of this is per channel, and none of it reaches the client.
- The reticle ([EventOverlay.tsx](../public/src/components/broadcast/EventOverlay.tsx))
  has one state: locked. Because the chrome swaps on the cut while the globe
  is still flying for `cutTransitionMs`, a locked reticle names an event the
  camera hasn't reached yet for about 4 s. That gap is where an "acquiring"
  state belongs.
- Round-ups: per-place `CountryRoundup`/`RegionRoundup` docs only appear as
  *slides* inside a spotlight. The worker emits `PLACE_ROUNDUPS_UPDATED`, but
  the director never reacts to it. The hourly world round-up airs once per
  session through rotation.

**Where every director knob lives** `[cfg]`:

| Knob | Field | Admin | `/control` (live) | Hard-coded |
|---|---|---|---|---|
| Auto / off | `mode` | | ✓ `DirectorModeBar` | |
| Which kinds air, how often | `kinds`, `kindWeights` | ✓ | ✓ (kinds) | |
| Favourite countries / areas, presets | `countries`, `regions`, `DIRECTOR_PRESETS` | ✓ | | |
| Hold per kind / quake class / storm level / volcano level | `kindHoldSeconds`, `quakeHoldSeconds`, `stormHoldSeconds`, `volcanoHoldSeconds` | | ✓ `DirectorHolds` | |
| Flight time between shots | `transitionSeconds` | | ✓ | |
| Pool thresholds | `minQuakeMag`, `minAlertSeverity` | | ✓ `DirectorTuning` | |
| Hazard-cycle beat, ad cadence | `alertCycleSeconds`, `adEveryNShots` | | ✓ | |
| Map-type tour per kind | `mapTypes` | | ✓ `DirectorMapTypes` | |
| Overlays / looks / slides | `overlayOverrides`, `kindLooks`, `kindSlides`, `activeSlideId` | | ✓ `DirectorSlides` | |
| Geo cooldown, recent centres, area memory | | | | `DEFAULT_GEO_COOLDOWN_DEG` 25, `GEO_RECENT_CAP` 8, `AREA_MEMORY_CAP` 3 |
| Storm pool, per-country cap | | | | `ALERT_POOL_CAP` 40, `ALERT_COUNTRY_CAP` 3 |
| Notable / VIP track boost | | | | `NOTABLE_SCORE` 45, `VIP_SCORE` 80 |
| City-tour length | | | | `COUNTRY_TOUR_STOPS` 8, `REGION_TOUR_STOPS` 10 |
| Round-up pace, cap, dwell, stops | | | | `SUMMARY_WORDS_PER_MIN` 170, `SUMMARY_MAX_HOLD_MS` 60 s, `SUMMARY_STOP_DWELL_MS` 40 s, `SUMMARY_MAX_TOUR_STOPS` 6 |
| Volcano zoom | | | | `VOLCANO_ZOOM` 5 |
| Look dwell / scalar cycle / depth cycle (client) | | | | `GLOBAL_MAP_CYCLE_MS` 6 s, `VAR_CYCLE_MS` 5.5 s, `DEPTH_CYCLE_MS` 2.5 s |
| Breaking windows | | | | `BREAKING_NEWS_WINDOW_MS` 20 min, `VOLCANO_BREAKING_WINDOW_MS` 6 h |

### 0.2 Chat `[chat]`

| Piece | Where | Notes |
|---|---|---|
| Chat poller (YouTube `liveChatMessages.list`) | `worker/src/stream/chat.ts` | in-process per live run; logs to `db.chatLog`; relays `chat:message`; skips the backlog page |
| Command responder | `worker/src/stream/chat-commands.ts` | `:modes` / `:mode` / `:help`, arg-less, per-(run,cmd) 30 s cooldown, ≤2 replies per poll |
| Write path into chat | `sendChatMessage` (`worker/src/youtube/client.ts`) | **50 quota units each**, 200-char cap |
| Quota metering | `worker/src/youtube/quota.ts` | spent budget blocks until PT midnight |
| Per-scene chat prefs | `ChatSettings` (`shared/src/control.ts`) | `enabled`, `promoteToTicker`; mirrored onto `Run.chat` |
| Audio bed | `AudioSettings`; `AuroraBed` (`public/src/lib/audio/engine.ts`) | synthesized client-side on every `/watch` |
| Theme presets | `BROADCAST_THEMES` (`public/src/components/broadcast/config.ts`) | `aurora`, `command`, `storm`; per-scene overrides |
| Map looks | `shared/src/director-rois.ts` | `INTRO_MAP_TYPES`, `OCEAN_MAP_TYPES` |
| Worker → browser relay | `emitWorkerEvent` → socket handlers | `director:state` is the precedent for worker-owned per-scene state |

The worker cannot emit `scene:state`, because the relay rejects non-user actors. So viewer choices get
their **own** worker-owned state rather than writing operator state.

### 0.3 Admin page (shipped 2026-09-13)

`SceneDraftProvider` fetches the scene and director docs **once**. Cards are pure
forms: they read `state` / `config` from `useSceneDraft()` and call `stage(patch)` /
`stageDirector(patch)` (no `sceneId`, no `epoch` refetch). Each card is an entry in
[catalog.ts](../public/src/components/admin/scenes/catalog.ts) (`id`, `title`,
`group`, `bucket`, `fields`) plus a component rendered inside `SettingsCard`.
`catalog.test.ts` pins that **every staged top-level key has exactly one owning
card**. Groups today: Layout, Presentation, Programme, Identity. The Programme group
holds a single card, "Auto-director content" (`kinds`, `kindWeights`, `countries`,
`regions`). Cards are capped at ~200 lines.

---

## 1. Guiding decisions

**Config**

1. **One doc, one truth.** `DirectorConfig` stays the single per-scene doc. Admin
   stages into it through the Save bar; `/control` patches it live. Both go through
   `PATCH /api/director/:scene/config` → `mergeDirectorConfig`. Admin is canonical,
   `/control` is the desk, and nothing is removed from `/control`. `[cfg]`
2. **Promote, don't fork.** Every constant in §0.1 becomes a config field whose
   default is *exactly* today's number. The first phase changes no channel's
   behaviour. `[cfg]`
3. **Defaults reproduce today's show.** Break-ins default to `"boundary"` with the
   current windows, round-ups off, chat commands off, viewer steering off.
   Existing channels change nothing until an operator opens a card. `[brk]`
4. **Templates are a starting point, never a live link.** `[cfg]`

**Director runtime**

5. **The loop is the only writer of on-air state.** Break-ins are decided inside
   the loop. Commands (operator and viewer) arrive through a persisted queue. Viewer
   music and palette picks are a separate layer that never cuts the globe. `[brk][cmd][chat]`
6. **Precedence: operator > break-in > viewer > rotation.** `pause` freezes all of
   it, including break-ins. `[cmd]`
7. **Interrupt = a normal cut, earlier.** A break-in or command cut uses the same
   bookkeeping (`performCut`) as rotation, with the same `spinEpoch` /
   `cutTransitionMs` stamping. An interrupted shot is not resumed. `[brk]`
8. **One builder per event.** Break-ins, commands and rotation all build segments
   through the same single-item builders, so the same event looks identical
   whichever path aired it. `[brk][cmd]`
9. **Nothing is silently dropped.** Break-in events and commands both live in
   arrays that drain. An item leaves only by airing, being covered by a group,
   being refused with a reason, expiring, or an explicit clear. Every outcome is
   recorded. `[brk][cmd]`
10. **Two bars, never crossed.** The *pool* bar decides what may air at all. The
    *break-in* bar decides what interrupts, and it is clamped never to sit below
    the pool bar. `[brk]`
11. **Ads are never cut short.** This applies to break-ins and viewer commands.
    An operator who needs to cut an ad sends Skip first. `[brk][cmd]`
12. **Restart-safe.** The fresh-event high-water mark starts at process start, so
    a restart never replays the backlog as break-ins. Queued commands and
    viewer holds live in Mongo. `[brk][cmd][chat]`

**Client**

13. **Clock-derived, never a timer chain.** Tempo, the INCOMING phase and viewer-hold
    expiry are all computed from wall clock plus values stamped on the cut or state, so
    `/watch`, `/control` and every OBS scene agree without traffic. `[cfg][brk][chat]`
14. **The client learns from the cut, not from config.** Tempo, break-in reason,
    incoming length, lead slide, requester and pinned map look all ride `Segment` on
    `director:state`. `/watch` never fetches `DirectorConfig`. `[cfg][brk][cmd]`
15. **Client cost ≈ zero, and safe for OBS software rendering.** Only `transform` / `opacity`, with no plate
    shadows and no new deck layers. `[brk]`

**Chat**

16. **Opt-in at three levels**, each a checkbox on the channel: Monitor chat →
    Viewer commands → Viewers may steer the director. Turning one off greys out
    everything below it, with the reason shown. Operator commands are never gated by
    chat policy. `[cmd]`
17. **Acknowledge on air for free; replying in chat is opt-in.** Each chat reply costs 50 quota units. `[chat]`
18. **Testable without going live.** The simulator drives the identical pipeline. `[chat][cmd]`

---

## 2. How the pieces fit

```
                         ┌──────────── per-scene DirectorConfig (Mongo, read every tick)
                         │               tuning (rotation/pools/tours/tempo) · breakIn · …
                         ▼
 FreshEventWatch ──► reconcilePending ─► selectBreakIn ─┐
 (process-wide,      (break-in queue,    (immediate      │
  5 s poll + nudge)   r.pending)          mode)          │
                                                         ▼
 /control route ──┐                              ┌──► performCut ──► director:state ──► /watch, /control, OBS
 (operator ops)   ├─► director_commands ─► arbitrate     │                │
 chat handler ────┘    (Mongo queue)       (every tick)  │                └──► AirEntry ──► as-run, chapters, /vod
 (viewer ops)                                            │
                       boundary: selectPriority ─────────┤  (reads the same break-in queue)
                                 selectNext (rotation) ──┘

 chat handler ──► ViewerState (audioMode, theme, skip/shuffle epochs) ──► viewer:state ──► /watch layer
```

### 2.1 One tick, in order

1. Re-read `DirectorConfig` (as today).
2. **Commands:** run `arbitrate` over the pending command rows. Expire stale rows,
   then apply `pause` / `resume` / `hold` / `clear` / `skip`. An operator `cut` resolves and calls
   `performCut` now; if one did, the tick ends.
3. **If paused:** push `endsAt` along and stop. Nothing expires and nothing breaks in.
4. **Break-in queue:** `reconcilePending(r.pending, fresh.since(), …)`. This runs every
   tick whether or not anything airs, so a burst that lands during a long shot is
   still waiting when the shot ends. Aged-out and dropped entries go to `handled`
   and are logged.
5. **Immediate break-in:** `selectBreakIn`. On a hit, build a single or group
   segment, stamp it, call `performCut`, and end the tick.
6. **Viewer `cut` in immediate mode** (only if the scene allows it and step 5 found nothing):
   resolve it and call `performCut`.
7. **Boundary** (`expired || skip`): the next segment is, in order, the break-in tier
   (`selectPriority` over candidates whose `breakIn` is still pending), then the
   oldest eligible viewer `cut`/`queue` command (subject to `everyS`, per-user
   cooldown and the queue cap), then `selectNext` rotation.

### 2.2 What `/watch` composes

```
operator ControlState  ←  director cut (segment fields)  ←  active viewer picks (audio, theme)
```

Viewer picks expire on the wall clock on both sides. Operator settings are never
written, so `/control`'s full-state emit can't overwrite a pick, and when a pick lapses
the previous look comes back with no revert logic. Map looks are **not** a client layer:
they are a director cut with a pinned look (§4.5).

---

## 3. Shared contracts

### 3.1 `DirectorConfig` tuning buckets `[cfg]` (`shared/src/director.ts`)

> **Change from the original plan:** `[cfg]` proposed a single `tuning` key with four
> sub-buckets. The catalog parity test (§0.3) needs each top-level key to have exactly
> one owning card, but three different cards edit parts of `tuning`. The sub-buckets
> therefore become **four top-level keys**. Each card still stages one complete object.

```ts
export interface DirectorRotation {
  geoCooldownDeg: number;      // 25 — min great-circle distance from recent shot centres
  recentCentersCap: number;    // 8
  areaMemoryCap: number;       // 3
}
export interface DirectorPools {
  alertPoolCap: number;        // 40
  alertCountryCap: number;     // 3
  notableBoost: number;        // 45
  vipBoost: number;            // 80
}
export interface DirectorTours {
  countryStops: number;        // 8
  regionStops: number;         // 10
  roundupStops: number;        // 6
  stopDwellS: number;          // 40 — dwell per tour stop (country, area and round-up tours)
  roundupWordsPerMin: number;  // 170
  roundupMaxHoldS: number;     // 60
  volcanoZoom: number;         // 5
}
export interface DirectorTempo {
  mapStepS: number;            // 6
  varCycleS: number;           // 5.5
  depthCycleS: number;         // 2.5
}
// DirectorConfig gains: rotation, pools, tours, tempo, breakIn (§3.2)
```

- `DEFAULT_DIRECTOR_{ROTATION,POOLS,TOURS,TEMPO}` are today's constants, verbatim. A
  `mergeTuningBucket` per key clamps each value (deg 0–90, caps 1–50, stops 1–20,
  seconds 1–120, wpm 60–400) and falls back per field, the same shape as
  `mergeHolds`. All of them are wired into `mergeDirectorConfig`. **Unlisted keys
  are dropped by that merge, so forgetting the wiring fails silently.**
- `ALERT_SCAN_LIMIT`, `TICK_MS`, `HEARTBEAT_MS`, `SEEN_CAP` and `HISTORY_CAP` stay
  constants. They are engine guards, not programme policy.

### 3.2 `DirectorConfig.breakIn` `[brk]`

```ts
export type BreakInReason = "quake" | "storm" | "volcano" | "roundup";
export const BREAK_IN_REASONS: BreakInReason[] = ["quake", "storm", "volcano", "roundup"]; // priority order

export interface BreakInConfig {
  enabled: boolean;                          // off = no breaking tier at all (pure rotation)
  interrupt: "boundary" | "immediate";       // default "boundary" (today's behaviour)
  reasons: Record<BreakInReason, boolean>;   // round-ups default off
  minQuakeMag: number;                       // break-in bar; clamped ≥ pool minQuakeMag
  minAlertSeverity: SeverityRank;            // clamped ≥ pool minAlertSeverity
  volcanoMin: VolcanoLevel;                  // "erupting" (default) | "unrest"
  windowMinutes: number;                     // default 20 (quakes/alerts); volcano keeps 6 h
  guardSeconds: number;                      // immediate: never cut a shot younger than this (6)
  cooldownSeconds: number;                   // immediate: min gap between event break-ins (120)
  clusterMin: number;                        // burst → one grouped cut at ≥ this many (3; 0 = off)
  clusterWindowSeconds: number;              // 180
  maxPending: number;                        // queue cap; lowest-scored fall off, logged (12)
  roundupCooldownMinutes: number;            // 30
  incoming: "off" | "breakIns" | "allEvents";// default "breakIns"
  incomingSeconds: number;                   // 0 = match transitionSeconds; max 15
  worldRoundup: boolean;                     // include the hourly world round-up (false)
}
```

`DEFAULT_BREAK_IN` + `mergeBreakIn` clamps values, drops unknown keys and merges
`reasons` key by key. **The pool-floor clamp is tested in both directions.**

### 3.3 `Segment` additions (all optional, all on `director:state`; no ControlState change)

| Field | From | Meaning |
|---|---|---|
| `tempo?: { mapStepMs; varCycleMs; depthCycleMs; stopDwellMs }` | `[cfg]` | stamped by `make()`; client constants are the fallback for an old worker. `stopDwellMs` is `tours.stopDwellS`: the client parks on each tour stop for it, so the worker's hold sizing and the client's dwell can't drift apart |
| `breakIn?: { reason; interrupted; items? }` | `[brk]` | why the cut jumped the queue; `items` lists every event of a grouped cut |
| `incomingMs?: number` | `[brk]` | INCOMING pre-roll length, clocked from `patch.spinEpoch` |
| `leadSlide?: "roundup"` | `[brk][cmd]` | deck leads with the round-up (round-up break-in or `:roundup`) |
| `requestedBy?: { author; platform }` | `[cmd]` | viewer-requested cut (operator cuts are editorial and unmarked) |
| `mapTypes?: string[]` | `[chat][cmd]` | pins the look tour; a one-element list parks a look instead of cycling |

### 3.4 `Candidate` `[brk]`

Delete `breaking?: boolean` (and its default-true quirk). Add
`breakIn?: { reason: BreakInReason; at: number }`, which builders set only when the
channel's config qualifies the event. `selectPriority` returns null when
`!cfg.breakIn.enabled`. Otherwise it walks `BREAK_IN_REASONS` and takes unaired
candidates with that reason, filtered by `withoutRecentAreas`, highest score first.
`PRIORITY_KINDS` goes away; `loop.ts#previewNext` mirrors the new list. Test helpers
that relied on "omitted = breaking" set `breakIn` explicitly.

### 3.5 `shared/src/director-break-in.ts` (new, pure) `[brk]`

```ts
export interface FreshEvent {
  reason: BreakInReason;
  segmentId: string;       // "quake:us7000abcd", "country:uk", "global:<docId>"
  key: string;             // dedupe; "roundup:<docId>" for round-ups
  at: number; score: number; areaKey?: string;
  mag?: number; severityRank?: number; erupting?: boolean;
  placeId?: string; placeKind?: "country" | "region" | "world";
}
export interface PendingBreakIn extends FreshEvent { queuedAt: number; coveredBy?: string }
export interface BreakInRunnerView {
  now: number;
  current: { id: string; kind: SegmentKind; startedAt: number; areaKey?: string } | null;
  seen: ReadonlySet<string>; handled: ReadonlySet<string>;
  lastBreakInAt: number; lastRoundupBreakInAt: number;
  favourites: { countries: ReadonlySet<string>; regions: ReadonlySet<string> };
  paused: boolean;
}
export function qualifiesAsBreakIn(ev, cfg, favourites, now): boolean;
export function reconcilePending(pending, fresh, cfg, r): { pending; aged; dropped };
export function selectBreakIn(pending, cfg, r):
  | { type: "single"; item: PendingBreakIn }
  | { type: "group"; reason: BreakInReason; items: PendingBreakIn[] }
  | null;
```

`selectBreakIn` applies these rules in order:

1. **Gates.** If any fails, it returns null and leaves the queue untouched:
   - `enabled` and `interrupt === "immediate"`;
   - not paused;
   - a current shot exists and is not an `ad`;
   - the shot is at least `guardSeconds` old;
   - the per-reason cooldown has passed.
2. **Eligibility.** The entry is not `handled` and not `coveredBy`. Events must
   also not be `seen`, not be the current segment, and not share the current
   shot's `areaKey`.
3. **Group or single.** Take the first reason in `BREAK_IN_REASONS` that has any
   eligible entries. If `clusterMin > 0` and at least `clusterMin` of them fall
   within `clusterWindowSeconds`, return a group (highest score first, capped at
   `clusterMin * 2`). Otherwise return the highest-scored single entry.
   Everything else stays queued and drains through the boundary tier.

### 3.6 `shared/src/director-commands.ts` (new) `[cmd]`

```ts
export type CommandSource =
  | { kind: "operator"; user: string }
  | { kind: "viewer"; platform: StreamPlatform | "sim"; author: string; isMod?: boolean }
  | { kind: "system"; job: string };          // reserved

export type CommandTarget =
  | { type: "segment"; id: string }          // an existing segment id
  | { type: "kind"; kind: SegmentKind }      // the best current candidate of that kind
  | { type: "place"; query: string }         // country / area / city (cities policy-gated)
  | { type: "roundup"; place?: string }      // place round-up, or the world round-up
  | { type: "mapType"; id: string };         // park a look on a global/ocean spin

export type DirectorOp =
  | { op: "cut"; target: CommandTarget; holdS?: number }
  | { op: "queue"; target: CommandTarget; holdS?: number }
  | { op: "skip" } | { op: "hold"; extendS: number }
  | { op: "pause"; untilMs?: number } | { op: "resume" } | { op: "clear" };

export type CommandStatus = "queued" | "applied" | "refused" | "expired" | "dropped";

export interface DirectorCommand {
  id: string; sceneId: string; source: CommandSource; cmd: DirectorOp;
  status: CommandStatus; note?: string; resolved?: { id: string; title: string };
  createdAt: number; expiresAt: number; appliedAt?: number; appliedSeq?: number;
}
```

Pure helpers: `parseOp(text)` (chat grammar, §5.2), `arbitrate(pending, view)` (§4.4),
`resolvePlaceQuery(query, catalogs)` (name / iso2 / demonym / fuzzy; on ambiguity
pick the largest population; cities gated). `skipNonce` stays as the `skip` op's legacy alias.

### 3.7 `shared/src/viewer.ts` (new) `[chat]`

> **Change from the original plan:** `[chat]` had a `mapType` slot in `ViewerState`
> that the loop read every tick. `[cmd]` replaced that with a `cut { target: mapType }`
> command. In the combined design, **`ViewerState` holds only the slots that don't
> move the camera.**

```ts
export type ViewerSlot = "audioMode" | "theme";
export interface ViewerRequest {
  slot: ViewerSlot; value: string;
  by: { author: string; platform: StreamPlatform | "sim"; isMod?: boolean };
  requestedAt: number; until: number; holdMs: number;
}
export interface ViewerState {
  sceneId: string;
  active: Partial<Record<ViewerSlot, ViewerRequest>>;   // one live pick per slot
  queue: ViewerRequest[];                                // FIFO, promoted on expiry
  audioSkipEpoch: number;                                // bump = next phrase now
  audioSeed: number;                                     // bump = reseed the arranger
  updatedAt: number;
}
export const VIEWER_STATE = "viewer:state";
```

### 3.8 Chat policy: `ControlState.chat.commands` `[chat][cmd]`

```ts
export interface ChatSettings {
  enabled: boolean;              // exists: Monitor chat
  promoteToTicker: boolean;      // exists
  commands: ChatCommandSettings; // new
}
export interface ChatCommandSettings {
  enabled: boolean;                    // Viewer commands (default false)
  allowFrom: "all" | "mods" | "owner"; // default "all"
  perUserCooldownS: number;            // 60
  replyInChat: boolean;                // false (quota)
  onAirChip: boolean;                  // true
  maxQueued: number;                   // 10; 0 = unlimited (music/theme slots)
  music: { enabled; allowed: AudioMode[]; holdS; maxHoldS; allowSkip; allowShuffle; skipCooldownS };
  theme: { enabled; palettes: ViewerPalette[]; holdS; maxHoldS };
  mapType: { enabled; allowed: string[]; holdS; maxHoldS };     // routed as a director cut
  director: {                          // Viewers may steer the director (default off)
    enabled: boolean;
    mode: "boundary" | "immediate";    // "boundary"
    ops: { cut: boolean; roundup: boolean; skip: boolean; clear: boolean };
    kinds: Partial<Record<SegmentKind, boolean>>;   // default storm/quake/volcano/ocean/global
    places: { countries: boolean; regions: boolean; cities: boolean };   // true/true/false
    holdS: number; maxHoldS: number;   // 60 / 180
    everyS: number;                    // min gap between viewer cuts, 120
    maxQueued: number;                 // 5
  };
}
export interface ViewerPalette { id; label; broadcastTheme: BroadcastThemeId; themeOverrides? }
```

`allowed: []` means everything the scene can show. Music and theme holds default to 5 min,
with a 15 min max. `:mode aurora` needs only `mapType.enabled`, and it **always waits for the next
shot change** (never immediate, whatever `director.mode` says), so it never needs
the full "viewers may steer the director" switch. It still respects `everyS` and
the director queue cap. Sanitised in `mergeControlState`, persisted on the scene
doc (**strict schema + parity test**), and mirrored onto `Run.chat` at run creation.

### 3.9 `DirectorState` additions (readouts only)

- `breakInQueue: { reason; title; at }[]` (the first few entries of `r.pending`)
- `lastBreakInAt?: number`
- `paused?: { since: number; until?: number }`
- `queued: { id; label; source }[]` (the first few pending commands)

---

## 4. Worker

### 4.1 Read the config instead of the constants `[cfg]`

- `candidates.ts`: pool caps, boosts, tour stops, the round-up `SUMMARY_*` values
  and `VOLCANO_ZOOM` come from `cfg.pools / cfg.tours`. The builders already receive `cfg`.
- `loop.ts`: `GEO_RECENT_CAP` becomes `cfg.rotation.recentCentersCap`. The `view`
  passed to `selectNext` carries `geoCooldownDeg` and `areaMemoryCap`; the
  `director-select.ts` constants become the defaults for those optional view fields.
- `make()` stamps `segment.tempo` next to `holdMs`.
- An admin Save applies within one tick, with no restart.

### 4.2 Single-item builders + `performCut` (the shared foundation) `[brk][cmd]`

- Factor the per-item bodies out of `buildCandidates` into exported builders:
  `quakeCandidate`, `stormCandidate`, `volcanoCandidate`, `countryCandidate`,
  `regionCandidate`, `summaryCandidate`. Each sets `candidate.breakIn` through
  `qualifiesAsBreakIn`, which replaces the two `*_BREAKING_WINDOW_MS` constants
  (the volcano 6 h becomes a constant inside it).
- `buildCandidates` gains a `kinds` filter option, so a `kind` command doesn't scan everything.
- Extract the ~100-line cut block in the loop into
  `performCut(r, next, pool, meta: { breakIn?, command?, now })`, covering
  seen/areas/history/upNext, the emit and the air log. The boundary path calls it unchanged.

### 4.3 `FreshEventWatch` (`worker/src/director/fresh.ts`, new) `[brk]`

- Process-wide, shared by every scene. `start(db)` sets `hwm = Date.now()`, then polls every
  `FRESH_POLL_MS` (5000, env-overridable) with four indexed queries at the global floor:
  - quakes `time > hwm`, mag ≥ 4.0: `db.quakes.list({ sinceMs, minMag, limit })` (exists)
  - alerts `created > hwm`, active, severity ≥ 2: **new** `db.alerts.createdSince` (+ index on `created` if absent)
  - volcanoes `statusChangedAt > hwm`, erupting: **new** `db.volcanoes.statusChangedSince`
  - round-ups `generatedAt > hwm`: **new** `generatedSince` on `countryRoundups` / `regionRoundups`; the world round-up is compared via `db.eventSummaries.latest`
- Hits become `FreshEvent`s, scored the way the pool scores them, and go into a ring kept for
  `max(windowMinutes across scenes, 60 min)`. `nudge()` is called from the quake, alert,
  volcano and round-up jobs at their existing emit points and triggers an immediate
  poll. It only reduces latency; the poll stays the source of truth.
- `candidateForFresh(db, cfg, ev)` loads the one doc and calls the matching builder.
  Round-ups resolve to the favourite country/region shot (or the world spin) with
  `leadSlide: "roundup"`.
- `buildGroupSegment(db, cfg, reason, items)` frames the centroid at a zoom that fits
  the span. If the span is wider than a hemisphere, it falls back to the top item's own frame. The title comes
  from the phrasebook ("4 NEW SEVERE WARNINGS" / "Bavaria and 3 more"), so source CAP
  strings never reach air. The segment id is `breakin:<reason>:<earliest key>`.
- The `stamp()` helper sets `segment.breakIn` and `segment.incomingMs` according to
  `cfg.breakIn.incoming`. Boundary-mode priority picks get
  `{ reason, interrupted: false }` from the same helper, so the on-air treatment
  is the same in both modes.

### 4.4 Command queue (`worker/src/director/commands.ts`, new) `[cmd]`

**Resolution:** `resolveTarget(db, cfg, target, now)` returns either a `Segment` or `{ refused }`.

| target | how |
|---|---|
| `segment` | split `kind:subject`, load the one doc → single-item builder |
| `kind` | `buildCandidates({ kinds: [k] })` → `selectNext` with the runner's history, so "a quake" is the one rotation would pick |
| `place` | `resolvePlaceQuery` over `COUNTRY_SHOTS` / `REGION_SHOTS`; if cities are allowed, **new** `db.cities.searchByName` (prefix, population-desc, limit 5) → a `point` segment |
| `roundup` | place resolution → `latestForPlace` → country/region segment with `leadSlide: "roundup"`; no place → `summaryCandidate` |
| `mapType` | a `global` segment (`ocean` for sst/wave/salinity) with `mapTypes: [id]`. Availability is checked worker-side through a new `MapTypeNeed` resolver (e.g. `aurora` needs a current OVATION grid); a look that isn't available is refused as "not available right now" |

`holdS` replaces the kind's hold. Viewer values are clamped by policy; operator values are not.

**Arbitration:** `arbitrate`, step 2 of §2.1. Operator `cut` bypasses the guard and cooldown. A
viewer `cut`/`queue` goes at the boundary by default, or immediately when the scene allows it,
and only when no break-in fires that tick. The `everyS`, per-user cooldown and `maxQueued` limits apply, and a full queue
**refuses at enqueue time** ("the queue is full, try again in a minute") rather than
dropping later. Operator commands are never capped.

**Bookkeeping:** `performCut(…, { command })` settles the row `applied` with
`appliedSeq` and stamps `requestedBy` for viewer sources. A resolution failure settles
`refused` with a human-readable reason ("no quake in the pool", "unknown place
\"narnia\"", "cities not allowed on this channel", "director is off"). A refusal is never
silent. `mode: "off"` is refused at enqueue time by the route, which reads the config.

**`SceneRunner` additions** (break-ins and commands together): `pending: PendingBreakIn[]`,
`handled: Set<string>` (capped like `seen`), `lastBreakInAt`, `lastRoundupBreakInAt`,
`pausedUntil`, `lastViewerCutAt`, `viewerCooldowns: Map<author, ms>`.

### 4.5 Map looks via the director `[chat][cmd]`

A viewer `:mode aurora` becomes `queue { target: mapType }` on the queue, so it airs at the next shot change. The client tour
stepper (`useMapStep` / `globalMapTour`) prefers `segment.mapTypes` over
`cfg.mapTypes[kind]`, so a one-element list parks the look. A break-in still wins.
Because an interrupted shot is not resumed (§1.7), a pinned look that a break-in cuts
short is not resumed either. The viewer can simply ask again.

---

## 5. Chat runtime `[chat][cmd]`

### 5.1 One scene-scoped handler, two entry points

Refactor `chat-commands.ts` so the unit of work is a **scene**:

```
handleChatBatch({ sceneId, policy, msgs, source: "youtube" | "sim" })
  → parseOp / parseCommand, apply policy (allowFrom, cooldowns, allowed lists, clamps, caps)
  → music / theme: mutate ViewerState, persist, emit viewer:state
  → director ops (incl. mapType): enqueue on director_commands (refusals settle immediately)
  → returns { replies: string[], acks: Ack[] }
```

1. **Live poll** (`chat.ts`, non-backlog pages): replies go to `sendChatMessage`
   only when `replyInChat` is on, and stay behind the existing ≤2-per-poll + cooldown limits.
2. **Simulator:** `POST /api/scenes/:id/chat-sim` (admin) `{ author, text, isMod? }`
   → `sendToFore("stream", "chat", "inject", …)` → the same handler with `source: "sim"`.
   Replies are relayed to the operator panel as bot `chat:message`s and never sent to
   YouTube. Simulated messages are not written to `chatLog`. **Effects on the scene are real**,
   so use it on LOCAL/TEST or on a scene with no live run.

**Sweep:** `viewer.sweep` runs every 5 s in-process. It prunes expired `active` slots,
promotes the next queued request (`until = now + holdMs`) and emits. It is restart-safe
because all of its state is in the doc.

### 5.2 Grammar: `[:!]<cmd> [arg] [minutes]`

| Chat | Effect | Gate |
|---|---|---|
| `:help` / `:commands` | lists what **this** scene allows (built from the policy) | commands |
| `:modes` / `:mode` | list looks available now / what's on now | commands |
| `:mode aurora [10]` | `queue` `mapType` (next shot change) | `mapType` |
| `:music` / `:music deep [10]` | list / request music mode | `music` |
| `:skip` / `:shuffle` | next phrase / reseed (`audioSkipEpoch` / `audioSeed`) | `music.allowSkip` / `allowShuffle` |
| `:themes` / `:theme storm [10]` | list / request palette | `theme` |
| `:show japan [5]` / `:go alps` / `:show london` | `cut`/`queue` `place` | `director` (+ `places.*`) |
| `:quake` / `:storm` / `:volcano` / `:flight` / `:ship` / `:ocean` / `:space` / `:show quake` | `cut`/`queue` `kind` | `director.kinds` |
| `:roundup [uk]` | `cut`/`queue` `roundup` | `director.ops.roundup` |
| `:next` | director `skip` | `director.ops.skip` (mods/owner by default) |
| `:queue` | what's active and queued (music, theme and director) | commands |
| `:clear` / `:reset` | clear director queue / clear music+theme picks | mods/owner |

Values match fuzzily against id and title (`aurora`, `space weather`). Unknown commands are
silent and spend no quota.

---

## 6. On air (`/watch`)

- **Tempo** `[cfg]`: `useMapStep` and the variable and depth cycles take `periodMs` from
  `segment.tempo` when it is present. `spinEpoch` anchoring is unchanged, so a change
  lands at the next cut.
- **INCOMING reticle** `[brk]`: `public/src/lib/incoming.ts`,
  `useIncomingPhase(segment)` returns `"incoming" | "locked" | null`. It flips once at
  `spinEpoch + incomingMs`, using one timeout and no interval. The pure
  `incomingPhaseAt(segment, now)` is there for tests.
  - *incoming*: brackets start pushed out ~40 px at 50% alpha and ease in. The scan
    runs 4× faster. A ~64 px acquiring ring rotates, with the eyebrow
    `⚡ INCOMING · EARTHQUAKE` / `NEW WARNING` / `ERUPTION` / `NEW ROUND-UP`
    (`BREAK_IN_LABEL`, or `EVENT DETECTED` when there's no `breakIn`). The title is held at
    opacity 0 so nothing reflows.
  - *locked*: the ring fades, the brackets snap into place with a small overshoot, and the title fades in.
    `eventPulse` returns the centre only once locked, so the existing map pulse
    reads as "acquired".
  - Viewers with reduced motion get the label without the animation.
- **Wide kinds** (`country` / `region` / `global`) have no reticle. Instead the
  `BroadcastCard` badge shows the same ring at badge size with `BREAKING` /
  `NEW ROUND-UP`, then a static `⚡` chip once locked.
- **Lead slide** `[brk][cmd]`: `modeSlides` leads with the `place-roundup` (or world
  `roundup`) slide when `segment.leadSlide === "roundup"`.
- **Grouped cut** `[brk]`: the reticle caption shows the group title, and the deck leads with a new
  `break-in-items` slide listing every `breakIn.items` entry (area, hazard, severity).
- **Requested by** `[cmd]`: a viewer cut shows a `REQUESTED BY @name` eyebrow in the
  same slot as `BREAKING`.
- **Viewer layer** `[chat]`: `useViewerState(sceneId)` (`public/src/lib/viewer.ts`) loads
  `GET /api/scenes/:id/viewer` on cold start and then tails `viewer:state`. `audioMode` overrides
  `audio.mode` and `theme` overrides `broadcastTheme`/`themeOverrides` for the hold. A timer re-evaluates
  at the earliest `until`, and the client re-checks `until` itself rather than trusting the worker.
- **Audio** `[chat]`: `AuroraBed.skip()` ends the phrase at the next bar boundary.
  `AuroraBed.reseed(seed)` swaps in a fresh arranger `Rng` at the next phrase boundary, so it never clicks.
- **`ViewerPickChip`** `[chat]`: a flat plate with no drop shadow, in theme tokens. It sits bottom-centre
  above the crawl and shows "VIEWER PICK · Aurora & Space Weather · @rich · 5 min" for ~6 s,
  then a compact countdown. It covers music, theme and director-routed picks (from
  `requestedBy`). Widget id `viewerPick`, so `widgetsOff` can hide it.
- **All of it** is `transform`/`opacity` only, with no `filter` animation and no box-shadow.

---

## 7. Admin (`/admin/scenes/:id`)

All new cards use the shipped contract: a **catalog entry + a component** rendered
inside `SettingsCard`. The component reads `config`/`state` from `useSceneDraft()`, calls
`stageDirector({ key: <complete object> })` / `stage(…)`, keeps no local server
copy and does no `epoch` refetch. Each card stays under ~200 lines, every staged key
is declared in its `fields`, and the catalog parity test passes.

### 7.1 Programme group (director cards) `[cfg][brk]`

| Card id | Title | `fields` (director bucket) | Notes |
|---|---|---|---|
| `director` (exists) | Content | `kinds`, `kindWeights`, `countries`, `regions` | + **Apply template** and **Copy from channel…** (§7.3) |
| `director-pacing` | Pacing | `kindHoldSeconds`, `quakeHoldSeconds`, `stormHoldSeconds`, `volcanoHoldSeconds`, `transitionSeconds`, `alertCycleSeconds`, `adEveryNShots`, `tempo` | |
| `director-pools` | Pools & rotation | `minQuakeMag`, `minAlertSeverity`, `pools`, `rotation` | the **pool** bar |
| `director-tours` | Tours & round-ups | `tours` | |
| `director-looks` | Looks | `mapTypes`, `overlayOverrides`, `kindLooks`, `kindSlides` | reuses `DirectorMapTypes` / `DirectorSlides` with an `update` that stages instead of patching live |
| `director-break-ins` | Break-ins | `breakIn` | §7.2 |

Every pacing/tuning field shows its default as helper text ("default 6 s"), and each card
has a **Reset to defaults** button that stages the default object. `activeSlideId` and `skipNonce` stay
live-only on `/control`.

**Naming (decided 2026-10-04):** no "Director:" prefix. The rail group is already
called Programme, so the cards read Content, Pacing, Pools & rotation, Tours &
round-ups, Looks, Break-ins. The existing card renames from "Auto-director content"
to "Content". This supersedes the 2026-09-13 prefix decision, which was made before
the rail shipped.

### 7.2 Break-ins card `[brk]`

From top to bottom:

1. **Cut to breaking events**: the master switch, plus the channel's Auto/Off chip.
2. **When**: *At the next shot change* / *Interrupt the current shot*. Immediate
   reveals Guard (s) and Cooldown (s), with "a commercial break always finishes" as helper text.
3. **What breaks in**: one row per reason, each with a checkbox and a threshold in words.
   Each row prints the pool bar beside its own bar ("This channel airs M4.5+ · breaking in at M6.0+").
   Options below the pool bar are disabled. An `info` alert appears when the reason's kind is off
   in the Content card.
   - **Earthquakes**: `QUAKE_MAGNITUDE_BANDS`
   - **Weather warnings**: `SEVERITY_LABELS`
   - **Volcanoes**: *Eruptions only* / *Eruptions and unrest* (6 h window)
   - **Round-ups**: favourites, plus a *World round-up too* checkbox and its own cooldown
4. **Bursts**: group at ≥ N within M seconds, and the queue cap.
5. **Freshness window** (minutes): "older than this is news, not breaking — it still
   airs through rotation".
6. **On air**: *Incoming reticle* Off / Breaking cuts only / Every event shot, plus its *Length* (s).

### 7.3 Templates and copy-from `[cfg]`

`shared/src/director-templates.ts`: `DIRECTOR_TEMPLATES: Record<id, { label, blurb,
config: Partial<DirectorConfig> }>`. Templates cover content, pacing and pools only, and **never**
`kindLooks` / `kindSlides` / `breakIn` / `skipNonce` / `activeSlideId`.

| id | Programme |
|---|---|
| `maps` | intro/global/ocean/orbital only, no events, 90 s holds, 10 s map step, ads off |
| `events` | storm/quake/volcano/flight/ship, short global bridges, thresholds M5 / severe |
| `ocean` | ocean + orbital + global, ocean tour only, depth cycle on, long dwell |
| `full` | today's defaults (the G.O.D.S. feed) |

- **Apply template** stages the template's objects into the draft, after a confirm listing what
  it overwrites. Save commits.
- **Copy from channel…** opens a scene picker, then `fetchDirectorConfig` stages everything except
  `skipNonce` / `activeSlideId`. It is client-only, with no new route.
- `POST /api/scenes` already clones a source channel's whole config at creation (break-ins
  included). The card hint says so.

### 7.4 New group: Viewers `[chat][cmd]`

Add `SettingsGroupId` `"viewers"` (rail label "Viewers", blurb "What the audience may
change from live chat") with one card:

| Card id | Title | `fields` (control bucket) |
|---|---|---|
| `chat` | Chat commands | `chat` |

It sits in its own group because it governs music and palette as well as the camera. It stages the complete
`chat` object. The sections, each greyed out with its reason when a switch above it is off, are:

1. **Monitor chat** (`chat.enabled`) and promote-to-ticker.
2. **Viewer commands**: the master switch, who (all / mods / owner), per-user cooldown, reply in
   chat (with the quota cost stated), on-air chip, queue cap.
3. **Music**: a checkbox per mode, hold and max, skip and shuffle toggles, skip cooldown.
4. **Palettes**: rows of label + base preset + optional "use this scene's current
   overrides", seeded with the three built-in presets.
5. **Map looks**: a checkbox per look, hold and max. Requests wait for the next shot change.
6. **Viewers may steer the director**: boundary vs immediate, allowed ops, kinds,
   places (countries / areas / cities), hold and max, `everyS`, queue cap.

The card may need a sibling file (`ChatDirectorPolicy.tsx`) to stay under 200 lines.

---

## 8. Operator desk (`/control`)

- **`DirectorCommandBar.tsx`** (inside `DirectorPanel`, auto mode) `[cmd]`:
  - **Take to air** on the operator globe's SELECTED card. The click-to-select already builds a
    `Segment` with a real id, so this sends `cut { target: { type: "segment", id } }`.
    This is the headline operator win.
  - **Go to…** is a typeahead over countries, areas, cities and `upNext`, plus a row of kind buttons
    (Quake, Storm, Volcano, Flight, Ship, Ocean, Space, Round-up).
  - **Hold +30 s**, **Pause / Resume**, **Skip** (now the `skip` op), **Clear queue**.
  - **Command log**: the last N commands with status and note, viewer ones included.
- **Readouts** `[brk][cmd]`: `DirectorOnAirReadout` shows
  `⚡ BREAK-IN · interrupted <previous title>` and "last break-in Xm ago", the break-in queue
  ("3 more warnings waiting"), the command queue, and PAUSED on the countdown.
- **`ViewerRequestsPanel`** (next to `LiveChatPanel`, shown whenever commands are enabled,
  live or not) `[chat]`:
  - active music and theme picks with a countdown and **Clear**;
  - the queue with **Drop**;
  - **Clear all** (`POST /api/scenes/:id/viewer/clear`);
  - the **chat simulator** box (author, mod checkbox, text).
  Bot replies appear inline in the chat tail.
- **Link**: `DirectorPanel`'s settings drawer gains "Channel settings live on
  /admin/scenes/:id#director ↗". `DirectorHolds` / `DirectorTuning` stay as the live
  desk and edit the same fields. `[cfg]`
- **Interrupt mode is deliberately not on `/control`.** It is staged per channel in admin. `[brk]`

**Routes** (`proxy.ts` already gates non-GET `/api/director/**` to admins):

| Route | Purpose |
|---|---|
| `POST /api/director/:scene/commands` | validate the op, stamp the operator source, `expiresAt = now + 10 min`, refuse when the director is off |
| `GET /api/director/:scene/commands?since=` | command log |
| `DELETE /api/director/:scene/commands/:id` | drop one |
| `GET /api/scenes/:id/viewer` | `ViewerState` cold start (token/admin gated like the scene GET) |
| `POST /api/scenes/:id/viewer/clear` | admin → job |
| `POST /api/scenes/:id/chat-sim` | admin → simulator job |

Client helpers: `public/src/lib/director-commands.ts` (`sendCommand`, `fetchCommands`,
`dropCommand`) and `public/src/lib/viewer.ts`.

---

## 9. As-run log and the per-video record `[brk][cmd]`

Break-ins and commands ride the existing chain: `AirEntry` → `loadAsRunTimeline`
(`shared/src/vod-bundle.ts`) → `/admin/runs`, `/admin/streams/:id`, the YouTube
description chapters (`worker/src/stream/chapters.ts`) and public `/vod/:videoId`.

**`AirEntry` gains** (strict schema in `air-log-model.ts`, so every path must be declared, plus repo and parity tests):

| Field | Why |
|---|---|
| `breakIn?: { reason; interrupted }` | separates "jumped the queue" from "cut a shot short", and records why |
| `breakInItems?: { segmentId; title; subtitle? }[]` | the other members of a grouped cut |
| `command?: { source: "operator" \| "viewer"; author?: string }` | who ordered the cut |

The existing `breaking: boolean` stays as the coarse flag that drives chapter ranking.

**`AirRun` counters:** `breakIns`, `grouped`, `commands`, `viewerRequests` and `queueDropped` are added with a
`$inc` on the existing per-cut write, so a header can read "47 cuts · 6 break-ins · 3 viewer requests".

**Where it shows:**

- `RunTimelineEntry` gets chips: "⚡ break-in · new warning (· interrupted)", "👤 operator",
  "💬 @rich". A grouped cut lists its members in the existing collapsible area.
- Chapters need no new logic: `buildChapters` already ranks `breaking` first, and `chapterLabel`
  adds ⚡. Grouped labels carry the count.
- A queue age-out or drop writes a worker ring line (`queue-logs`) instead of a phantom `AirEntry`.
- A "top requesters" panel on `/admin/streams/:id` is phase 7 polish.

---

## 10. Persistence

| Store | Change | Rule |
|---|---|---|
| `director-config-model.ts` | nested typed path schemas for `rotation`, `pools`, `tours`, `tempo`, `breakIn` (fixed shape, so typed paths with defaults rather than `Mixed`) | **new strict-mode parity test `director-config-model.test.ts` for the whole config.** It has never had one, and a typo'd field drops silently |
| `director_commands` (new) | `director-command-{model,repo}.ts`; indexes `(sceneId, status, createdAt)`; TTL drops terminal rows 7 days after `expiresAt` | repo: `enqueue`, `pending`, `settle`, `clearQueued`, `recent`; strict + parity |
| `viewer_state` (new) | `viewer-state-model.ts` + repo, keyed by scene | strict + parity |
| `broadcast-state-model.ts` | `chat.commands` paths | **strict schema + persist-parity test** |
| `air-log-model.ts` | `breakIn`, `breakInItems`, `command`, run counters | strict + repo/parity |
| repos | `alerts.createdSince`, `volcanoes.statusChangedSince`, roundups `generatedSince`, `cities.searchByName` | + indexes where absent |

Run `./update-shared` after each shared change.

---

## 11. Build order

Each phase ships green on its own (`./test`) and is mergeable by itself. The first
three change nothing on air at defaults.

| # | Phase | Deliverable | From | Depends on | Visible change |
|---|---|---|---|---|---|
| **1** | **Foundations** | tuning buckets + defaults + merges + model + **config parity test**; worker reads them; `Segment.tempo` + client honours it; `breakIn` config + `mergeBreakIn` + `qualifiesAsBreakIn`; `Candidate.breakIn` replaces `breaking`; `selectPriority` parameterised; **single-item builders**; **`performCut` extraction** | cfg T0, brk 0 (contract + worker half) | — | none (defaults = constants) |
| **2** | **Director cards** | catalog entries + Pacing, Pools & rotation, Tours & round-ups, Looks, **Break-ins** cards; rename "Auto-director content" to "Content"; `/control` link | cfg T1, brk 0 (card) | 1 | operators can tune everything per channel; nothing changes until Save |
| **3** | **Operator commands** | commands contract + model/repo + routes + loop drain (`cut` by segment/kind, skip, hold, pause/resume, clear); `DirectorCommandBar` with **Take to air**; command log; `DirectorState.paused/queued` | cmd C0 | 1 | Take / Hold / Pause from `/control` |
| **4** | **Break-in interrupt + queue + grouping + as-run** | `fresh.ts`, `reconcilePending` / `selectBreakIn`, `*Since` repos, interrupt branch, `buildGroupSegment`, `AirEntry`/`AirRun` fields, `RunTimelineEntry` chips, `break-in-items` slide, queue readouts | brk 1 + 1b | 1 (3 for the shared `AirEntry.command` field, or add it here) | "Interrupt the current shot" works; bursts group and drain; everything is readable per video |
| **5** | **INCOMING reticle** | `lib/incoming.ts`, `EventOverlay`, `BroadcastCard` badge, `eventPulse` gating, `BREAK_IN_LABEL` | brk 2 | 4 | pre-roll + lock on breaking cuts |
| **6** | **Places + round-ups** | `place` / `roundup` targets, `resolvePlaceQuery`, `cities.searchByName`, `leadSlide`, Go-to typeahead; round-up break-ins (`fresh.ts` round-up queries, `candidateForFresh` round-up branch, lead-slide rule) | cmd C1, brk 3 | 3, 4 | Go to Japan; favourite round-ups break in |
| **7** | **Chat foundation** | `ViewerState` model/repo/event; `chat.commands` policy + persistence; `handleChatBatch`; simulator route + job; sweep; `useViewerState`; `AuroraBed.skip/reseed`; `ViewerPickChip`; Viewers group + **Chat commands** card (switches, music, palettes); `ViewerRequestsPanel` | chat P0 | — (independent of 1–6) | viewers pick music and palette; testable via the simulator |
| **8** | **Viewers steer the director** | `parseOp` grammar; `director` + `mapType` policy sections; viewer arbitration (boundary/immediate, `everyS`, cooldowns, cap); `requestedBy` on air; refusal replies; `mapType` target + `Segment.mapTypes` pin + worker availability | cmd C2 + C3, chat P1 | 6, 7 | `:show japan`, `:roundup uk`, `:mode aurora` |
| **9** | **Templates + polish** | `director-templates.ts`, Apply / Copy from channel; `replyInChat` confirmations; `viewer` ticker kind; top requesters; Twitch/Kick once pollers exist | cfg T2, chat P2 | 2, 8 | starting points per stream type; chat niceties |

**Phase 1 as built:**
- The cut routine lives in `worker/src/director/runner.ts` (`performCut`, `previewNext`,
  `SceneRunner`). The boundary pick is `pickAtBoundary` in `loop.ts`.
- The tuning types live in `shared/src/director-tuning.ts`; the break-in config,
  `mergeBreakIn` and `qualifiesAsBreakIn` are in `shared/src/director-break-in.ts`.
- `breakIn.minQuakeMag` / `minAlertSeverity` default to the pool bar, so every
  channel breaks in exactly as before.
- `selectPriority` and the "up next" preview share `breakInCandidate`.
- The new config parity test found that `kindHoldSeconds.region` / `.point` and
  `kinds.point` were missing from the Mongo schema, so a saved area hold was
  silently dropped. Both are fixed.

**Critical path:** 1 → 3 → 4 → 6 → 8. Phase 7 can run in parallel with phases 1–6. Phases 2, 5 and 9
can slot in whenever their dependencies are done. If only one phase gets built, phase 1 is still worth it:
it turns every hard-coded number into a per-channel field with no behaviour change.

---

## 12. Tests

All verification is unit tests plus typecheck; there are no servers in CI. The worker restart and
flipping a channel live are done by the operator.

**shared**
- Tuning merges clamp and fall back per field. `DEFAULT_DIRECTOR_*` equal the old constants, as a pinned table.
- `mergeBreakIn`: clamps, defaults, unknown-key drop and the **pool-floor clamp in both directions**.
- `qualifiesAsBreakIn` per reason: window and threshold edges, `volcanoMin`, favourites, `worldRoundup`.
- **`reconcilePending` burst case:** four events in one tick all survive; entries de-dupe by key;
  age-out works; the `maxPending` trim reports what it dropped (lowest score, not oldest); **an event not picked this
  tick is still there next tick.**
- `selectBreakIn`: gates, ad never interrupted, paused, exclusions, reason precedence,
  group vs single at the `clusterMin` / `clusterWindowSeconds` edges.
- `selectPriority` on `Candidate.breakIn`, including `enabled: false`.
- `parseOp` table (aliases, minutes, prefixes, chatter → null) and `parseCommand` with arguments.
- `resolvePlaceQuery`: aliases, fuzzy matching, ambiguity → population, cities gated.
- `arbitrate`: expiry; pause blocks expiry and break-ins; hold extends; operator > break-in > viewer;
  viewer boundary vs immediate; `everyS` / per-user / cap; off-mode.
- `mergeControlState` sanitises `chat.commands`.
- `DIRECTOR_TEMPLATES` touch only allowed keys.
- Model parity tests: director config, commands, viewer state, broadcast state, air log.

**worker**
- Builders honour `pools` / `tours` / `rotation` from an injected config, and `make()` stamps `tempo`.
- The single-item builders reproduce `buildCandidates` output (snapshot the existing tests through them).
- `FreshEventWatch` with a fake clock: hwm starts at start and advances; ring expiry; `nudge`.
- `buildGroupSegment` framing: a tight cluster frames the centroid, scattered items fall back to the top item; phrasebook titles.
- `performCut` bookkeeping and the interrupt branch: the air log gets `breakIn`, the outgoing entry's
  hold is shorter than nominal, counters increment, and grouped cuts write `breakInItems`.
- `resolveTarget` per target, including refusals. The drain settles rows and stamps `requestedBy` /
  `AirEntry.command`. Queued rows survive a restart.
- `handleChatBatch` policy table; grant/queue/promote/expire; the sim path sends no YouTube reply;
  director ops enqueue; a `mapType` cut yields to a break-in.

**public**
- Each new card stages a complete object through `renderInDraft`; Reset to defaults; slide-type-off
  warnings; greying out with the reason shown.
- The catalog parity test covers the new keys and the new group.
- Apply-template confirm plus staged keys; Copy-from leaves out excluded keys.
- `useMapStep` uses `segment.tempo` and falls back to the constants.
- `incomingPhaseAt` table; `EventOverlay` shows the eyebrow, then the title after the flip (fake timers).
- `modeSlides` lead-slide rule; `break-in-items` slide; `REQUESTED BY` eyebrow.
- `useViewerState` composition and expiry timer; `AuroraBed.skip/reseed` at bar boundaries; chip render.
- Routes (admin gate, op validation, off-mode refusal); `DirectorCommandBar` and the Take button call
  `sendCommand`; `ViewerRequestsPanel` actions; `RunTimelineEntry` chips.

---

## 13. Decisions taken (change here if wrong)

1. One `DirectorConfig` doc. Admin is canonical, `/control` is the live desk, and nothing is removed from `/control`.
2. Constants become **top-level** buckets `rotation` / `pools` / `tours` / `tempo` with today's
   values as defaults. They are top-level rather than one `tuning` key because of the catalog's one-owner rule.
3. Client tempo, break-in state, lead slide, requester and pinned look ride the cut, not a config fetch.
4. Templates cover content, pacing and pools, are applied into the draft, and are never a live link.
5. Naming: "break-ins" (`breakIn` on config, segment and as-run).
6. Break-ins default to boundary mode with today's windows. Immediate mode is a per-channel opt-in.
7. The break-in bar is clamped never to sit below the pool bar.
8. Bursts of the same reason (≥3 within 3 min) air as one grouped cut. The break-in queue drains and
   overflows lowest-score-first, and every drop is logged.
9. Ads always finish. An interrupted shot is not resumed.
10. Round-up break-ins are favourites-only, plus the optional world round-up.
11. One command queue with two writers (operator route, worker chat handler) and one consumer (the loop).
    Break-ins are not commands.
12. Precedence is operator > break-in > viewer > rotation; `pause` freezes everything.
13. Viewer cuts are boundary-only by default and credited on air. Operator cuts are unmarked.
14. Cities are off by default as viewer targets; countries and areas are on.
15. Viewer music and palette picks are a separate worker-owned layer (`ViewerState`), never writes to
    operator state. Map looks go through the director queue.
16. Chat has three opt-in switches per channel. Viewer policy lives on the Chat commands card in a
    new Viewers group, not on a director card.
17. Acknowledgement is on air by default; chat replies are opt-in (50 quota units each).
18. Arbitration is FIFO with per-user cooldowns. Voting is deferred.
19. Admin card titles have no "Director:" prefix; the Programme rail group supplies it.
20. A viewer map-look request (`:mode`) always waits for the next shot change and needs
    only the Map looks switch, not full director steering.
21. A viewer look cut short by a break-in is not resumed (same rule as any interrupted shot).

## 14. Assumptions to confirm

- **Volcano break-ins default to eruptions only**, using the 6 h status-flip window. `usgsAlertLevel`
  only covers US-monitored volcanoes, so status is the universal signal.
- **"Every event shot" incoming mode** also covers flights and ships, labelled `EVENT DETECTED`.
- **Grouped members** can still get their own shot later through rotation.

## 15. Later / out of scope

- An **audio sting** on break-in, keyed on `segment.breakIn`.
- **Resuming the interrupted shot** with its remaining hold.
- **`WatchedEvent` beats** (GDACS red upgrade, Copernicus activation), wildfires and tides as break-in reasons.
- A **BREAKING crawl line**. `LiveAlertPanel` already covers just-issued warnings.
- **Voting** on viewer requests.
- **LLM chat / presenter**, still parked (see the `presenter-llm-plan` memory).
- **Operator hand-typed chat replies.**
