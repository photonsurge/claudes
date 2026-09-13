# Director commands — operator overrides + viewer requests through one queue — plan

> **Status: PLANNED** (2026-09-12). Companion to
> [director-break-in-plan.md](./director-break-in-plan.md) (breaking events)
> and [chat-interaction-plan.md](./chat-interaction-plan.md) (viewer chat
> policy, `ViewerState`, simulator). Nothing built yet.

Today the director takes exactly one external input: `skipNonce` ("cut to the
next shot now"). Everything else it does, it decides for itself. This plan gives
it a **command queue** — one durable, per-scene inbox the loop drains every
tick — so the operator can override it ("take this quake now", "hold this
shot", "pause", "go to Japan") and, under the per-scene chat policy, viewers
can ask for things from live chat (`:show japan`, `:roundup uk`, `:volcano`).
The loop stays the single writer of on-air state; the queue is the only way in.

## Why a queue, and why in Mongo

- **Two writers, one consumer.** Operator commands arrive through a public
  admin route; viewer commands are produced inside the worker by the chat
  handler. A Mongo collection is the one place both can write without the
  public app ever touching worker memory, and the loop already reads Mongo
  every tick (`getOrInitDirectorConfig`) — one more indexed read is nothing.
- **Audit for free.** Every command keeps `who / what / when / what happened`
  (applied at seq N, refused because…, expired). That is the as-run story for
  `/admin/runs`, the "top requesters" idea from the chat plan, and the
  operator's own command log on `/control`.
- **Restart-safe.** A queued viewer request survives a worker bounce; an
  operator pause does too.
- The `skipNonce` mechanism stays as-is for back-compat (it becomes the `skip`
  command's legacy alias); nothing that works today changes.
- Rejected: expressing break-ins as `system` commands on the same queue. A
  break-in is a per-tick decision over runner state (guard, cooldowns, seen);
  forcing it through a persisted queue adds a round-trip and two sources of
  truth. Break-ins stay in the loop's own branch; the queue is for *requests*.

## 1. Shared contract — `shared/src/director-commands.ts` (new)

```ts
export type CommandSource =
  | { kind: "operator"; user: string }                                  // admin session
  | { kind: "viewer"; platform: StreamPlatform | "sim"; author: string; isMod?: boolean }
  | { kind: "system"; job: string };                                     // reserved (schedules, presenter)

/** What to point the camera at. Resolved in the worker (§2.1). */
export type CommandTarget =
  | { type: "segment"; id: string }        // an existing segment id: "quake:us7000abcd", "country:japan", "volcano:gvp:211060", "storm:<src>:<id>", "flight:<hex>"
  | { type: "kind"; kind: SegmentKind }    // "a quake" — the best current candidate of that kind
  | { type: "place"; query: string }       // free text → country / area / city (policy-gated for cities)
  | { type: "roundup"; place?: string }    // latest place round-up (favourite → any enabled), or the world round-up
  | { type: "mapType"; id: string };       // park a look on a global/ocean spin (the chat plan's mapType slot)

export type DirectorOp =
  | { op: "cut";   target: CommandTarget; holdS?: number }   // go there now
  | { op: "queue"; target: CommandTarget; holdS?: number }   // go there at the next boundary
  | { op: "skip" }                                            // = today's skipNonce
  | { op: "hold";  extendS: number }                          // extend the current shot
  | { op: "pause"; untilMs?: number }                         // freeze on the current shot (operator only)
  | { op: "resume" }
  | { op: "clear" };                                          // drop every queued command (operator / mods)

export type CommandStatus = "queued" | "applied" | "refused" | "expired" | "dropped";

export interface DirectorCommand {
  id: string;
  sceneId: string;
  source: CommandSource;
  cmd: DirectorOp;
  status: CommandStatus;
  /** Human-readable outcome ("cut at seq 41", "no quake in the pool", "director is off"). */
  note?: string;
  /** The segment the command resolved to, once applied (id + title for the log). */
  resolved?: { id: string; title: string };
  createdAt: number;
  /** Queued commands lapse on their own — a viewer's "show Japan" from an hour ago must not fire later. */
  expiresAt: number;
  appliedAt?: number;
  appliedSeq?: number;
}
```

Pure helpers, all unit-tested: `parseOp(text)` (the chat grammar, §4),
`arbitrate(pending, view)` (which queued command wins this tick, §2.2),
`resolvePlaceQuery(query, catalogs)` (fuzzy country/area/city match, §2.1).

**Segment additions** (ride `director:state`; no ControlState change):

```ts
/** Who asked for this cut (viewer requests only — operator cuts are editorial and unmarked). */
requestedBy?: { author: string; platform: string };
/** Which deck slide leads — "roundup" makes the place round-up the first slide.
 *  Shared with the break-in plan (a roundup break-in sets it too). */
leadSlide?: "roundup";
```

**Persistence**: `shared/src/db/director-command-{model,repo}.ts`, collection
`director_commands`, indexes `(sceneId, status, createdAt)` and a TTL on
`expiresAt` for terminal rows after 7 days (the as-run link keeps what matters).
Repo: `enqueue`, `pending(sceneId)`, `settle(id, status, note, resolved?)`,
`clearQueued(sceneId)`, `recent(sceneId, since)`. Strict schema + parity test.

## 2. Worker — the loop drains the queue

### 2.1 Resolution (`worker/src/director/commands.ts`, new)

`resolveTarget(db, cfg, target, now): Promise<Segment | { refused: string }>`
— builds the exact segment the director would have built itself, via the
single-item builders the break-in plan factors out of `buildCandidates`:

| target | how |
|---|---|
| `segment` | split the id (`kind:subject`), load the one doc (`db.quakes.get`, `db.alerts.get`, `db.volcanoes.get`, catalog lookup for country/region, track snapshot for flight/ship) → `quakeCandidate` / `stormCandidate` / … |
| `kind` | `buildCandidates` restricted to that kind (add a `kinds` filter option so it doesn't scan everything) → `selectNext` with the runner's history/counts, so "a quake" is the one rotation would have picked |
| `place` | `resolvePlaceQuery` over `COUNTRY_SHOTS` (name / iso2 / demonym aliases), `REGION_SHOTS` (name / group), then — if the policy allows cities — `db.cities.searchByName` (new: case-insensitive prefix on `name`, population-desc, limit 5). Country → `countryCandidate`; area → `regionCandidate`; city → a `point` segment (the sandbox kind: real location, tucked card, no reticle; `PRESETS.point` exists) with `title = city, subtitle = country` |
| `roundup` | `place` resolution as above, then `db.countryRoundups/regionRoundups.latestForPlace` → the country/region segment with `leadSlide: "roundup"`; no place = `summaryCandidate` for the freshest world round-up (a `global` spin with `summary`) |
| `mapType` | the chat plan §2: a `global` (or `ocean` for sst/wave/salinity) segment with `Segment.mapTypes = [id]` pinned; availability checked worker-side (`MapTypeNeed` resolver) |

`holdS` (clamped by policy for viewers, unclamped for the operator) replaces
the kind's configured hold; absent = the normal hold.

### 2.2 Arbitration (`arbitrate`, pure, `shared/src/director-commands.ts`)

Runs every tick, **before** the break-in branch and the expiry check, over
`db.directorCommands.pending(sceneId)` (oldest first):

1. Expire anything past `expiresAt` (settle `expired`).
2. `pause` / `resume` / `hold` / `clear` / `skip` apply immediately whatever the
   source allows (§4 policy decides who may send them): `pause` sets
   `r.pausedUntil` (∞ when absent) — while paused the runner neither expires nor
   accepts break-ins; the shot's `endsAt` is pushed along so `/control`'s
   countdown reads "PAUSED". `hold` adds to `endsAt`. `skip` forces a boundary.
3. Operator `cut` → resolve → `performCut` now (the break-in plan's extracted
   cut path) with `{ command: id }`. No guard, no cooldown — the operator is
   the operator. Ads are still not interrupted mid-play unless the operator
   sends `skip` first (documented in the panel).
4. Viewer `cut` / `queue` → honoured only at a **boundary** by default
   (`policy.director.mode = "boundary"`), or immediately when the scene allows
   it, and only when no break-in is pending this tick: **operator > break-in >
   viewer > rotation.** One viewer cut per `everyS`, per-user cooldown, queue
   cap — the same knobs the chat plan uses for other slots.
5. Everything else waits, still `queued`, and is re-evaluated next tick.

**Bursts.** The queue is an array and it drains; it never collapses to "the
latest request wins". Ten viewers asking for ten different places in one minute
produce ten rows, worked through oldest-first at boundaries under `everyS`,
each one settling `applied` or `refused` with a reason. `maxQueued` caps what a
channel will hold; past it, new viewer requests are refused **at enqueue time**
with "the queue is full, try again in a minute" rather than accepted and
quietly discarded. Operator commands are never queue-capped. The same rule the
break-in plan states for events applies here: a request leaves the queue only
by airing, by being refused with a reason, by expiring, or by an explicit
`clear` — and every one of those outcomes is a row someone can read later.

The loop's boundary path changes in one place: before `selectPriority`, it asks
`arbitrate` for a `queue`d command whose turn it is; if one resolves, that is
the next segment (still subject to the break-in tier ahead of it).

### 2.3 Bookkeeping

- `performCut(..., { command })` settles the command `applied` with
  `appliedSeq` and stamps `segment.requestedBy` for viewer sources; the as-run
  `AirEntry` gains `command?: { source: CommandSource["kind"]; author?: string }`
  and the run gains `commands` / `viewerRequests` counters — the same log
  chain the break-in plan specifies in
  [§5 As-run log and the per-video record](./director-break-in-plan.md), so a
  finished YouTube video's as-run page, its description chapters and the public
  `/vod/:videoId` all show which cuts were ordered and by whom. Whichever plan
  lands first adds the `AirEntry` fields; the other extends them.
- A resolution failure settles `refused` with the reason (`no quake in the
  pool`, `unknown place "narnia"`, `cities not allowed on this channel`,
  `director is off`, `aurora not available right now`). Refusals are what the
  chat reply / on-air chip / operator log show — never silent.
- `DirectorState` gains `paused?: { since: number; until?: number }` and
  `queued: { id; label; source }[]` (the first few pending commands) so
  `/control` renders the queue without a second fetch.
- Director `mode: "off"`: the loop isn't running for that scene, so a public
  route enqueue is answered `refused: director is off` at enqueue time (the
  route reads the config) — same rule the chat plan already states.

## 3. Operator surface — `/control`

A **Director commands** strip inside `DirectorPanel` (own file,
`DirectorCommandBar.tsx`), visible in auto mode:

- **TAKE** — the existing click-to-select on the operator globe
  ([control/page.tsx:97](../public/src/app/control/page.tsx#L97) `selected`,
  built by `select-segment.ts`) already yields a `Segment` with a real id, so
  the ViewingOverlay's SELECTED card grows a **Take to air** button →
  `cut { target: { type: "segment", id } }`. This is the headline operator
  win: click a quake, press Take, the show goes there.
- **Go to…** — one text field with typeahead over countries / areas / cities /
  the current `upNext` rail → `cut { target: place | segment }`; a kind row of
  buttons ("Quake", "Storm", "Volcano", "Flight", "Ship", "Ocean", "Space",
  "Round-up") → `cut { target: kind }`.
- **Hold +30 s**, **Pause / Resume**, **Skip** (the existing button, now the
  `skip` op), **Clear queue**.
- **Command log** — the last N commands with status/note (viewer requests
  included), replacing nothing: it sits beside the existing session log.

Client helper `public/src/lib/director-commands.ts`: `sendCommand(sceneId,
op)`, `fetchCommands(sceneId, since)`, `dropCommand(id)`. Routes:
`POST /api/director/:scene/commands` (admin — `proxy.ts` already gates every
non-GET under `/api/director/**`), `GET …/commands?since=`, `DELETE
…/commands/:id`. The POST validates the op shape, stamps the operator source
from the session, sets `expiresAt = now + 10 min`, and refuses when the scene
is not in auto mode.

## 4. Viewer entry — chat

Builds on the chat plan's scene-scoped `handleChatBatch` (or a thin adapter on
today's `commandReplies` if C2 lands first). New grammar in `parseOp`:

| Chat | Op |
|---|---|
| `:show japan [5]` / `:go alps` / `:show london` | `cut`/`queue` `place` (cities only if allowed) |
| `:show quake` / `:quake` / `:volcano` / `:storm` / `:flight` / `:ship` / `:ocean` / `:space` | `cut`/`queue` `kind` |
| `:roundup [uk]` | `cut`/`queue` `roundup` |
| `:mode aurora [10]` | `cut` `mapType` (the chat plan's slot, now routed here) |
| `:next` | `skip` (mods/owner by default) |
| `:queue` | reply listing what's active / queued (read-only, no op) |
| `:clear` | `clear` (mods/owner) |

### 4.1 Turning chat on and off — three switches, all per channel

Chat integration is opt-in at every level, and each level is a plain checkbox
on the **Chat commands** card on `/admin/scenes/:id` — deliberately the one
card in that part of the page with no "Director:" prefix, because it also
governs the music bed and palette picks; steering the camera is one section
inside it. Turning one off greys out everything below it in the
card with the reason stated, so there is never a setting that looks armed but
cannot fire:

| Switch | Field | Default | What it gates |
|---|---|---|---|
| **Monitor chat** | `ControlState.chat.enabled` (exists today) | on | polling + logging a run's chat at all; off = no commands of any kind, nothing to read |
| **Viewer commands** | `chat.commands.enabled` (chat plan) | off | whether viewer messages are parsed as commands at all (music, theme, help…) |
| **Viewers may steer the director** | `chat.commands.director.enabled` | off | whether those commands can move the camera — the override queue |

So a channel can log chat and answer `:help` while refusing to let anyone touch
the globe, or run fully hands-off with everything off, and the operator's own
Take / Go to / Hold / Pause are unaffected by all three — operator commands
enter the same queue through the admin route, which is gated by the admin
session, not by chat policy.

Policy lives with the rest of the chat policy — `ControlState.chat.commands`
from the chat plan gains a `director` block, edited on the same
`ChatCommandsSettings` card (viewer policy in one place, not on the director
card):

```ts
director: {
  enabled: boolean;                       // default false
  mode: "boundary" | "immediate";         // default "boundary"
  ops: { cut: boolean; roundup: boolean; skip: boolean; clear: boolean };   // skip/clear default mods-only via allowFrom
  kinds: Partial<Record<SegmentKind, boolean>>;   // which `kind` targets viewers may ask for (default: storm/quake/volcano/ocean/global)
  places: { countries: boolean; regions: boolean; cities: boolean };       // default true/true/false
  holdS: number; maxHoldS: number;        // default 60 / 180
  everyS: number;                         // min gap between viewer cuts, default 120
  maxQueued: number;                      // default 5
}
```

On air, a viewer cut carries `requestedBy`, rendered as the `REQUESTED BY
@rich` eyebrow in the same slot the break-in plan uses for `BREAKING` (reticle
caption for targeted kinds, deck badge for wide ones); the chat plan's
`ViewerPickChip` shows the ack + countdown. Chat replies stay opt-in and
quota-metered exactly as the chat plan says; refusals reply only when
`replyInChat` is on.

The **simulator** from the chat plan (`POST /api/scenes/:id/chat-sim`) drives
this path too, so the whole feature is exercisable on LOCAL/TEST with no live
run — the user's standing "not live first" requirement.

## 5. Build order

| Phase | Deliverable | Depends on |
|---|---|---|
| C0 | Contract + model/repo + routes + loop drain for operator ops (`cut` by segment/kind, `skip`, `hold`, `pause`/`resume`, `clear`) + `DirectorCommandBar` with **Take to air** + command log + as-run chips | break-in plan Phase 0/1 (single-item builders, `performCut`) |
| C1 | `place` and `roundup` targets (`resolvePlaceQuery`, `db.cities.searchByName`, `leadSlide`), Go-to typeahead | C0 |
| C2 | Chat entry: `parseOp` grammar, `director` policy block on the chat card, viewer precedence, `requestedBy` on air, refusal replies, simulator | C1 + chat plan P0 (`handleChatBatch`, `ViewerState`, simulator) |
| C3 | `mapType` target replaces chat plan §2's loop-side `viewerState.mapType` read; `Segment.mapTypes` pin | C2 + chat plan P1 |

C0 is useful on its own (operator Take/Hold/Pause) and needs no chat work.

## 6. Tests

- shared: `parseOp` table (aliases, minutes, prefixes, plain chatter → null);
  `resolvePlaceQuery` (name/iso2/alias/fuzzy, ambiguity → best by population,
  cities gated); `arbitrate` (expiry, pause blocks expiry + break-ins, hold
  extends, operator beats break-in beats viewer, viewer boundary vs immediate,
  everyS/per-user/queue cap, off-mode refusal); model parity test.
- worker: `resolveTarget` per target with an injected db (segment ids across
  kinds, kind-restricted candidate build, roundup → `leadSlide`, refusals);
  loop drain settles rows and stamps `requestedBy` / `AirEntry.command`;
  restart keeps queued rows.
- public: routes (admin gate, op validation, off-mode refusal); `DirectorCommandBar`
  and the SELECTED card's Take button call `sendCommand`; `RunTimelineEntry`
  chips; `REQUESTED BY` eyebrow render.
- Verification = unit tests + typecheck; worker restart and a scene flipped to
  auto are the user's.

## 7. Decisions taken (change here if wrong)

1. One queue, two writers (operator route, worker chat handler), one consumer
   (the loop). Break-ins are not commands.
2. Precedence: operator > break-in > viewer > rotation; `pause` freezes
   everything including break-ins.
3. Viewer cuts are boundary-only by default; immediate is a per-scene opt-in.
4. Operator cuts are unmarked on air; viewer cuts are credited (`REQUESTED BY`).
5. Cities as viewer targets are off by default (a `point` cut has no reticle
   and thin cards); countries and areas are on.
6. Viewer policy lives on the chat card, not the director card.
