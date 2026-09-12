# Director break-ins — cut to breaking events (+ "INCOMING" reticle) — plan

> **Status: PLANNED** (2026-09-12). Nothing shipped yet. Per-channel options on
> `/admin/scenes/:id`; worker loop + on-air reticle changes behind them.
> Companion: [director-commands-plan.md](./director-commands-plan.md) — the
> operator/viewer command queue (Take, Go to, Hold, Pause, chat `:show …`)
> that reuses this plan's single-item builders and `performCut`.

Let each channel's auto-director **break into the current shot** when something
new lands — a fresh earthquake, a just-issued severe warning, a volcano that has
started erupting, and (opt-in) a freshly generated round-up for one of the
channel's favourite places — with an on-air **"INCOMING"** treatment on the
reticle while the camera flies, that then locks on to the event. All of it is
configured per channel from the admin scene page, staged through the existing
Save bar.

## What exists today (and why it isn't this)

- The director loop runs **in the worker only**
  ([director/loop.ts](../worker/src/director/loop.ts)), one `SceneRunner` per
  auto-mode scene, 1 s tick. **A cut only ever happens when the current shot
  has expired or the operator bumped `skipNonce`**
  ([loop.ts:258-259](../worker/src/director/loop.ts#L258-L259)). There is no
  mid-shot interrupt path anywhere.
- "Breaking news" is a **boundary** preempt: `selectPriority`
  ([director-select.ts:230](../shared/src/director-select.ts#L230)) runs before
  fair rotation on every cut but the opener, over `PRIORITY_KINDS =
  quake → storm → volcano`, taking unaired candidates whose `Candidate.breaking`
  flag is not false. Freshness is hard-coded in
  [candidates.ts](../worker/src/director/candidates.ts):
  `BREAKING_NEWS_WINDOW_MS` = 20 min (quake `time`, alert first-seen `created`),
  `VOLCANO_BREAKING_WINDOW_MS` = 6 h on `statusChangedAt` + `erupting`. A
  one-normal-cut cooldown (`r.lastCutWasPriority`) stops it firing every cut.
  None of this is per-channel; nothing about it reaches the client — `Segment`
  and `DirectorState` carry no breaking flag (only the as-run `AirEntry.breaking`).
- The reticle is [EventOverlay.tsx](../public/src/components/broadcast/EventOverlay.tsx):
  a centred, tilted, corner-bracketed DOM/SVG frame with a slow scan sweep,
  coloured by `KIND_COLOR[kind]`, rendered for targeted kinds only
  (`isTargetedEvent` = storm/volcano/quake/flight/ship,
  [kinds.ts:45](../public/src/components/broadcast/kinds.ts#L45)) from
  [BroadcastFrame.tsx:~793](../public/src/components/broadcast/BroadcastFrame.tsx#L793).
  It has one state: locked. The chrome swaps to the new segment the instant the
  cut lands while the globe is still flying for `cutTransitionMs`
  (`transitionSeconds`, default 4 s) — so today, for ~4 s, a locked reticle names
  an event the camera hasn't reached yet. That flight window is exactly where an
  "acquiring" state belongs.
- Round-ups: per-place `CountryRoundup`/`RegionRoundup` docs
  ([place-roundup-repo.ts](../shared/src/db/place-roundup-repo.ts)) are only
  *slides* inside a country/area spotlight
  ([mode-slides.tsx:476,521](../public/src/components/broadcast/mode-slides.tsx#L476));
  the worker emits `PLACE_ROUNDUPS_UPDATED` per generated place
  ([jobs/placeRoundups.ts:107](../worker/src/jobs/placeRoundups.ts#L107)) but the
  director never reacts. The hourly *global* round-up already rides a `global`
  spin via `summaryCandidates` ([candidates.ts:522](../worker/src/director/candidates.ts#L522)),
  aired once per session through fair rotation, never as a headline.
- Per-scene director config is `DirectorConfig`
  ([director.ts:382](../shared/src/director.ts#L382)) — one Mongo doc per scene,
  edited on `/admin/scenes/:id` by
  [DirectorSettings.tsx](../public/src/components/admin/scenes/DirectorSettings.tsx)
  through `useSceneDraft().stageDirector` (complete top-level fields; shallow
  merge at both ends). The worker re-reads it every tick, so no socket plumbing.

## Guiding decisions

- **Naming: "break-ins".** The broadcast term for interrupting the running
  programme. Config key `DirectorConfig.breakIn`, on-air reason on
  `Segment.breakIn`, as-run flag `AirEntry.breakIn`.
- **Defaults reproduce today's show exactly.** `breakIn.interrupt` defaults to
  `"boundary"` (the current priority tier, now parameterised by the same
  config), thresholds default to the pool thresholds, round-ups default off, the
  incoming reticle defaults to *breaking cuts only*. Existing channels change
  nothing until an operator opens the card.
- **One notion of "breaking" per channel.** The channel's `breakIn` config
  decides *which* events count as fresh (kinds, thresholds, window) for BOTH the
  boundary tier and the immediate interrupt. `Candidate.breaking` (a boolean
  with a default-true quirk kept for test back-compat) is replaced by
  `Candidate.breakIn?: { reason, at }`, set by the builders only when the
  channel's config says so. `selectPriority` reads that instead.
- **Detect fresh events with one cheap process-wide poll, not a full candidate
  build per tick.** `buildCandidates` scans 40 quakes + the alert pool + tracks
  + city dossiers per scene; running that every second is out. A single
  `FreshEventWatch` (5 s, indexed `> high-water-mark` queries, shared by all
  scenes) yields a small in-memory list; each scene's decision is a pure
  function over that list. A Segment is built only on a hit, via single-item
  builders factored out of `buildCandidates` so a break-in shot is
  pixel-identical to the same event airing through rotation.
- **High-water mark starts at process start.** A worker restart must not replay
  the backlog as break-ins — the exact failure mode the priority tier had
  (see the `director-priority-tier-fix` note).
- **Interrupt = a normal cut, earlier.** Same bookkeeping (seen/areas/history/
  upNext/air log), same `spinEpoch` + `cutTransitionMs` stamping. The
  interrupted shot is not resumed afterwards (TV moves on); its as-run entry
  already records the real time it held.
- **Ads are never cut short.** A running `ad` segment finishes; the break-in
  fires on the next tick after it ends (that tick is a boundary anyway).
- **On-air timing is clock-derived, never a timer chain.** The incoming phase
  is `patch.spinEpoch + incomingMs`, the same determinism trick as spin/orbit/
  alert-cycle, so /watch, /control and every OBS scene agree without traffic.
- **Round-up break-ins are favourites-only.** A UK channel breaks in for the UK
  round-up, not for all 30 opted-in countries — the natural per-channel scope,
  and it defuses the 12-hourly batch (every enabled place regenerates at once).
- **Client cost ≈ zero.** No new deck layers; the incoming state is CSS
  transform/opacity on the existing DOM reticle (OBS software-render safe, no
  plate shadows — see the on-air rules). The existing `pulseAt` map pulse
  becomes the "lock" beat.

## Design

### 1. Shared contract — `shared/src/director.ts` (+ new `director-break-in.ts`)

```ts
export type BreakInReason = "quake" | "storm" | "volcano" | "roundup";
export const BREAK_IN_REASONS: BreakInReason[] = ["quake", "storm", "volcano", "roundup"]; // priority order

export interface BreakInConfig {
  /** Master switch — off = no breaking tier at all on this channel (pure fair rotation). */
  enabled: boolean;
  /** "boundary" = today's behaviour (jump the queue at the next shot change);
   *  "immediate" = cut into the running shot. */
  interrupt: "boundary" | "immediate";
  /** Which reasons may break in. Round-ups default off. */
  reasons: Record<BreakInReason, boolean>;
  /** Stricter-than-pool thresholds a fresh event must meet to break in. */
  minQuakeMag: number;        // default = DEFAULT_DIRECTOR_CONFIG.minQuakeMag (4.5)
  minAlertSeverity: number;   // default = DEFAULT_DIRECTOR_CONFIG.minAlertSeverity (3)
  /** How fresh a quake/alert must be, minutes (was the hard-coded 20). Volcanoes
   *  keep their own 6 h status-flip window — the source is a weekly bulletin. */
  windowMinutes: number;      // default 20, min 1
  /** Immediate mode only: never interrupt a shot younger than this, seconds. */
  guardSeconds: number;       // default 6, min 0
  /** Immediate mode only: minimum gap between two event break-ins, seconds. */
  cooldownSeconds: number;    // default 120, min 10
  /** Round-ups only: minimum gap between two round-up break-ins, minutes. */
  roundupCooldownMinutes: number; // default 30, min 5
  /** Which cuts get the on-air INCOMING pre-roll on the reticle / deck badge. */
  incoming: "off" | "breakIns" | "allEvents";   // default "breakIns"
  /** Pre-roll length, seconds. 0 = match the channel's transitionSeconds. */
  incomingSeconds: number;    // default 0, max 15
  /** Include the hourly world round-up (EventSummary) under the "roundup" reason. */
  worldRoundup: boolean;      // default false
}

// DirectorConfig gains:
breakIn: BreakInConfig;
```

- `DEFAULT_BREAK_IN` + `mergeBreakIn(base, patch)` (clamps as above, unknown
  keys dropped, `reasons` merged key-by-key like `kinds`) — wired into
  `DEFAULT_DIRECTOR_CONFIG` and `mergeDirectorConfig`
  ([director.ts:1282](../shared/src/director.ts#L1282)). Unlisted keys are
  dropped by that merge, so forgetting this step is the classic silent failure.
- `Segment` gains two optional fields (ride the existing `director:state`
  socket, no ControlState change, so **no `broadcast-state-model.ts` edit**):

```ts
/** Why this cut jumped the queue — absent on an ordinary rotation cut. */
breakIn?: { reason: BreakInReason; /** it cut the previous shot short */ interrupted: boolean };
/** On-air INCOMING pre-roll length, ms, clocked from patch.spinEpoch. Absent/0 = none. */
incomingMs?: number;
/** Which deck slide leads — a roundup break-in sets "roundup" so the round-up is
 *  the first slide. Shared with the commands plan (`:roundup uk` sets it too). */
leadSlide?: "roundup";
```

- `Candidate` ([director-select.ts:61](../shared/src/director-select.ts#L61)):
  **delete `breaking?: boolean`**, add `breakIn?: { reason: BreakInReason; at: number }`.
  `selectPriority` becomes: `if (!cfg.breakIn.enabled) return null;` then for
  each reason in `BREAK_IN_REASONS`, unaired candidates with `breakIn.reason ===
  reason`, `withoutRecentAreas`, highest score. `PRIORITY_KINDS` goes away (the
  "up next" preview in `loop.ts#previewNext` mirrors the same list — update it).
  Test helpers that relied on "omitted = breaking" set `breakIn` explicitly.
- New pure module `shared/src/director-break-in.ts`:

```ts
export interface FreshEvent {
  reason: BreakInReason;
  /** Segment id the event would air as ("quake:us7000abcd", "country:uk", "global:<docId>"). */
  segmentId: string;
  /** Dedupe key — differs from segmentId for round-ups ("roundup:<docId>"), so a
   *  country that already aired this session can still break in with a NEW round-up. */
  key: string;
  at: number;          // event time (quake.time / alert.created / volcano.statusChangedAt / roundup.generatedAt)
  score: number;       // same scoring as the pool (mag/severity)
  areaKey?: string;    // "country:XX" for the same-area guard
  // reason-specific numbers the threshold check needs:
  mag?: number; severityRank?: number; erupting?: boolean;
  placeId?: string; placeKind?: "country" | "region" | "world";
}

export interface BreakInRunnerView {
  now: number;
  current: { id: string; kind: SegmentKind; startedAt: number; areaKey?: string } | null;
  seen: ReadonlySet<string>;      // segment ids aired this session
  handled: ReadonlySet<string>;   // FreshEvent.key already broken-in on (or declined) this session
  lastBreakInAt: number;
  lastRoundupBreakInAt: number;
  favourites: { countries: ReadonlySet<string>; regions: ReadonlySet<string> };
}

/** Pure: which fresh event (if any) should interrupt NOW. Null in boundary mode. */
export function selectBreakIn(fresh: readonly FreshEvent[], cfg: BreakInConfig, r: BreakInRunnerView): FreshEvent | null;

/** Pure: does this event qualify as breaking for this channel (used by BOTH the
 *  boundary builders and selectBreakIn) — reason enabled, threshold met, inside
 *  the window (volcano: erupting + 6 h), round-up: favourite (or worldRoundup). */
export function qualifiesAsBreakIn(ev: FreshEvent, cfg: BreakInConfig, favourites, now): boolean;
```

`selectBreakIn` rules, in order: `enabled && interrupt === "immediate"`; a
current shot exists and is not `ad`; `now - current.startedAt ≥ guardSeconds`;
per-reason cooldown (`cooldownSeconds` for events, `roundupCooldownMinutes` for
round-ups); `qualifiesAsBreakIn`; not `handled`; event reasons additionally
not `seen` and not the current segment; not the current shot's `areaKey`
(don't interrupt Japan-the-country with a Japan quake the deck is already
showing — that quake airs at the boundary instead). Then the first reason in
`BREAK_IN_REASONS` that has a hit, highest score within it.

### 2. Worker — fresh-event watch + single-item builders + interrupt path

**`worker/src/director/fresh.ts` (new)** — process-wide `FreshEventWatch`:

- `start(db)` sets `hwm = Date.now()` and polls every `FRESH_POLL_MS = 5000`
  (env-overridable), each poll running four indexed queries with the global
  floor (the loosest threshold any channel could set — pool minimums):
  - quakes: `time > hwm`, mag ≥ 4.0 → `db.quakes.list({ sinceMs, minMag, limit })`
    (exists; `sinceMs` already supported at [quake-repo.ts:50](../shared/src/db/quake-repo.ts#L50)).
  - alerts: `created > hwm`, active, severity ≥ 2 → new `db.alerts.createdSince(ms, { severityMin })`
    on [alerts-repo.ts](../shared/src/db/alerts-repo.ts) (index on `created` — add if absent).
  - volcanoes: `statusChangedAt > hwm && status === "erupting"` → new `db.volcanoes.statusChangedSince(ms)`.
  - round-ups: `generatedAt > hwm` on both `db.countryRoundups` / `db.regionRoundups`
    → new `generatedSince(ms)` (the `generatedAt` TTL index serves it); world:
    `db.eventSummaries.latest(period)` compared against the hwm.
- Each hit becomes a `FreshEvent` (via the same `quakeSegmentContent`/
  `alertSegmentContent`/… scoring the pool uses) appended to a ring kept for
  `max(windowMinutes across scenes, 60 min)`; `hwm` advances to the newest `at`
  seen. `since()` returns the ring; `nudge()` triggers an immediate poll and is
  called (fire-and-forget) from the quake/alert/volcano/place-round-up jobs at
  their existing emit points, so a real event reaches air within a tick instead
  of up to 5 s later. The poll stays as the source of truth — the nudge is only
  latency sugar.
- Never blocks: four small reads on indexes, no CPU work.

**`worker/src/director/candidates.ts`** — factor the per-item bodies out of
`buildCandidates` into exported single-item builders that both paths share:
`quakeCandidate(q, cfg, now)`, `stormCandidate(a, info, area, cfg, now)`,
`volcanoCandidate(v, cfg, now)`, `countryCandidate(db, shot, cfg)`,
`regionCandidate(db, shot, cfg)`, `summaryCandidate(doc, period, cfg)`. Each
sets `candidate.breakIn` through `qualifiesAsBreakIn` (replacing the
`BREAKING_NEWS_WINDOW_MS`/`VOLCANO_BREAKING_WINDOW_MS` constants — the volcano
6 h stays as a constant inside `qualifiesAsBreakIn`). New
`candidateForFresh(db, cfg, ev): Promise<Candidate | null>` loads the one doc
by id and calls the matching builder; round-up events resolve to the favourite
country/region shot (or the world summary spin) with `segment.breakIn.reason =
"roundup"`.

**`worker/src/director/loop.ts`**:

- `SceneRunner` gains `lastBreakInAt`, `lastRoundupBreakInAt`, `handled: Set<string>`
  (capped like `seen`).
- Extract the existing ~100-line cut block into `performCut(r, next, pool, meta)`
  (bookkeeping + emit + air log). The current boundary path calls it unchanged.
- New branch **before** the `expired || skipRequested` check on every tick:

```ts
const pick = selectBreakIn(fresh.since(), cfg.breakIn, viewOf(r, cfg, now));
if (pick) {
  const cand = await candidateForFresh(db, cfg, pick);
  r.handled.add(pick.key);            // never re-offer, even if the build failed
  if (cand) {
    stamp(cand.segment, { reason: pick.reason, interrupted: true }, cfg);
    r.lastCutWasPriority = true;      // keeps the existing one-normal-cut cooldown
    (pick.reason === "roundup" ? r.lastRoundupBreakInAt = now : r.lastBreakInAt = now);
    await performCut(r, cand.segment, pool /* stale upNext is fine */, { breakIn: true, now });
    continue;
  }
}
```

- `stamp()` sets `segment.breakIn` and `segment.incomingMs` per
  `cfg.breakIn.incoming` (`"breakIns"` → only when `breakIn` is set;
  `"allEvents"` → every `isTargetedEvent` kind, with `breakIn` absent;
  `incomingSeconds || transitionSeconds`). Boundary-mode priority picks get
  `breakIn = { reason, interrupted: false }` via the same helper so the on-air
  treatment is identical in both modes.
- Air log: [airlog.ts:32](../worker/src/director/airlog.ts#L32) takes
  `breakIn: boolean`; `AirEntry` gains `breakIn: { type: Boolean, default: false }`
  ([air-log-model.ts:57](../shared/src/db/air-log-model.ts#L57), strict schema —
  extend the repo test). `RunTimelineEntry.tsx` shows a second chip
  "⚡ cut in" next to the existing "⚡ breaking".

### 3. On-air — the INCOMING reticle

**`public/src/lib/incoming.ts` (new)** — `useIncomingPhase(segment): "incoming" | "locked" | null`:
`null` when `!segment.incomingMs`; otherwise `Date.now() < patch.spinEpoch +
incomingMs ? "incoming" : "locked"` with ONE timeout scheduled for the flip
(no interval). Pure helper `incomingPhaseAt(segment, now)` for tests.
Reduced-motion viewers still get the label, just no animation.

**[EventOverlay.tsx](../public/src/components/broadcast/EventOverlay.tsx)** —
one new prop-less behaviour keyed on `useIncomingPhase`:

- *incoming*: brackets start pushed out ~40 px and at 50% alpha, easing in to
  the frame over the pre-roll (`transform` transition on the SVG group — the
  frame itself doesn't move, so the layout stays stable); the scan sweep runs
  4× faster; a centred **acquiring ring** (a conic-gradient arc rotating,
  `transform: rotate` only, ~64 px) with the eyebrow
  `⚡ INCOMING · EARTHQUAKE` / `NEW WARNING` / `ERUPTION` / `NEW ROUND-UP`
  (from `BREAK_IN_LABEL[reason]`, or `EVENT DETECTED` when `breakIn` is
  absent), in `KIND_COLOR[kind]`. The event title is held back (rendered at
  0 opacity, so nothing reflows).
- *locked*: ring fades (200 ms), brackets snap the last few px with a short
  overshoot, title + subtitle fade in, and the existing map `pulseAt` ring
  fires once — `eventPulse` ([director.ts:280](../public/src/lib/director.ts#L280))
  returns the centre only once the phase is `locked`, so the pulse reads as
  "acquired".
- Everything is `transform`/`opacity`; no `filter` animation, no box-shadow.

**Deck / wide kinds** — a round-up break-in is a `country`/`region`/`global`
shot, which has no reticle. The `BroadcastCard` badge
([BroadcastCard.tsx:51](../public/src/components/broadcast/BroadcastCard.tsx#L51))
gets an optional `breakIn` eyebrow: the same acquiring ring at badge size +
`BREAKING` / `NEW ROUND-UP` text during *incoming*, dropping to a static
`⚡` chip once locked for the rest of the shot. `modeSlides` leads the deck
with the `place-roundup` (or `roundup`) slide when `segment.leadSlide ===
"roundup"` (stamped by `stamp()` for roundup break-ins, and by the commands
plan for `:roundup` requests) — the round-up *is* the story, not the second slide.

**Control page** — `DirectorOnAirReadout` shows `⚡ BREAK-IN · interrupted
<previous title>` when `segment.breakIn?.interrupted`, and "last break-in Xm
ago" from `DirectorState` (add `lastBreakInAt?: number` to the state; readout
only, like `lastShownAt`).

### 4. Admin card — `public/src/components/admin/scenes/BreakInSettings.tsx` (new)

Sibling of `DirectorSettings` on `/admin/scenes/:id`, inserted right after it
in [page.tsx:72](../public/src/app/admin/scenes/%5Bid%5D/page.tsx#L72). Same
contract: `useSceneDraft().stageDirector(sceneId, { breakIn: <complete object> })`,
refetch on `epoch`, own file (keep files small). Layout, top to bottom:

1. **Cut to breaking events** — master switch, plus the Auto/Off mode chip.
2. **When** — radio: *At the next shot change* (boundary) / *Interrupt the
   current shot* (immediate). Immediate reveals *Guard* (s), *Cooldown* (s)
   with the helper text "at most one break-in per cooldown; ads always finish".
3. **What breaks in** — checkbox rows: Earthquakes (min magnitude select,
   4.5–7), Weather warnings (min severity select: Moderate / Severe / Extreme),
   Volcanoes (fixed: eruptions only), Round-ups for favourite places (with
   *World round-up too* sub-checkbox; cooldown minutes). Each row shows an
   `info` Alert when its slide type is off in the content card above ("Earthquakes
   are off under *Which slide types air* — they can't break in"), mirroring the
   existing favourites warning.
4. **Freshness window** — minutes; helper: "an event older than this is news,
   not breaking — it airs through normal rotation".
5. **On air** — *Incoming reticle*: Off / Breaking cuts only / Every event shot;
   *Length*: seconds (0 = match transition time).

`DIRECTOR_PRESETS` stay content-only (they don't touch `breakIn`);
`POST /api/scenes` clones the whole config, so new channels inherit the source
channel's break-in settings — document in the card hint.

### 5. Persistence

- [director-config-model.ts](../shared/src/db/director-config-model.ts): a
  **nested path schema** for `breakIn` (fixed shape, so typed paths with
  defaults — not `Mixed`, which is for the dynamic per-kind maps). Add a
  strict-mode parity test `director-config-model.test.ts` for the WHOLE config
  (mirroring `broadcast-state-model.test.ts`): `DirectorConfig` has never had
  one, and the kind-looks note records that a typo'd field silently drops here.
- No `ControlState` change → no `broadcast-state-model.ts` edit.
- `air-log-model.ts`: `breakIn` boolean (strict; repo test updated).

## Build order

| Phase | Deliverable | Files | Visible change |
|---|---|---|---|
| 0 | Config + admin card + parameterised boundary tier | shared `director.ts`, `director-break-in.ts`, `director-select.ts`, `director-config-model(.test).ts`; worker `candidates.ts` (`breakIn` on candidates, single-item builders); public `BreakInSettings(.test).tsx`, `page.tsx`; `./update-shared` | None at defaults. Operators can now tune window / thresholds / reasons per channel. |
| 1 | Immediate interrupt | worker `fresh.ts`, `loop.ts` (`performCut` extraction + branch), `airlog.ts`, repo `*Since` methods + tests; `RunTimelineEntry` chip; `DirectorOnAirReadout` | "Interrupt the current shot" works for quake/storm/volcano. Worker restart (user). |
| 2 | INCOMING reticle | public `lib/incoming(.test).ts`, `EventOverlay.tsx`, `BroadcastCard.tsx`, `eventPulse` gating, `kinds.ts` `BREAK_IN_LABEL` | Pre-roll + lock on breaking cuts (and optionally all event shots). |
| 3 | Round-ups | worker `fresh.ts` round-up queries, `candidateForFresh` roundup branch, place-roundup/event-summary `generatedSince`; public `mode-slides.tsx` lead-slide rule | Favourite-place / world round-ups break in with the deck badge treatment. |

Each phase ships green on its own (`./test`), Phase 0 first because it removes
the hard-coded windows the later phases would otherwise duplicate.

## Tests

- **shared**: `mergeBreakIn` clamps/defaults/unknown-key drop; `qualifiesAsBreakIn`
  per reason (window edge, threshold edge, volcano erupting-only, round-up
  favourite gating, `worldRoundup`); `selectBreakIn` (boundary mode → null,
  guard, both cooldowns, ad-never-interrupted, seen/handled/current/same-area
  exclusions, reason precedence, score tie-break); `selectPriority` on
  `Candidate.breakIn` incl. `enabled:false`; config model parity test.
- **worker**: single-item builders produce the same segments `buildCandidates`
  did (snapshot the existing candidates tests through them); `FreshEventWatch`
  with an injected db + fake clock (hwm starts at start, advances, ring
  expiry, `nudge`); loop: extract-and-test `performCut` bookkeeping and the
  interrupt branch with a stubbed `fresh` + `candidateForFresh` (air log gets
  `breakIn: true`, outgoing entry's actual hold < nominal).
- **public**: `incomingPhaseAt` table test; `EventOverlay` renders the incoming
  eyebrow then the title after the flip (fake timers); `BreakInSettings` stages
  a complete `breakIn` object on every edit and shows the slide-type-off
  warnings; `modeSlides` leads with the round-up slide on a roundup break-in.
- Verification is unit tests + typecheck only (no servers, per the global
  rules); the operator restarts the worker and flips one channel to
  *Interrupt* to see it live.

## Later / out of scope

- **Audio sting** on break-in from the generative bed (a one-shot hit keyed on
  `segment.breakIn`) — natural follow-up once the visual lands.
- **Resume the interrupted shot** after the break-in (push it back on the rail
  with its remaining hold).
- **Unified `WatchedEvent` beats** as break-in reasons (a GDACS red upgrade, a
  Copernicus activation) — the fresh watch can read `event_timeline_updates >
  hwm` once those beats carry a severity; wildfires/tides likewise.
- **Ticker/crawl** "BREAKING" line for the break-in — the top-right
  `LiveAlertPanel` already surfaces just-issued warnings; revisit if the crawl
  needs it.
- `/control` live toggle for interrupt mode — deliberately NOT on the control
  page (the admin card is the staged, per-channel surface; mode/skip stay live).

## Assumptions to confirm

- Ads always finish; a break-in waits for the ad's end.
- The interrupted shot is not resumed.
- Round-up break-ins are favourites-only (plus the optional world round-up);
  the 12-hourly batch therefore yields at most one break-in per
  `roundupCooldownMinutes`, biggest-alert-count place first.
- Volcano break-ins are eruptions only (a status flip to *unrest* airs through
  rotation), reusing the existing 6 h status-flip window.
- "Every event shot" incoming mode also applies to flights/ships (they are
  targeted kinds); the label there is `EVENT DETECTED`, not `INCOMING`.
