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
- **Two bars, never crossed.** A channel already has a *pool* bar (what may air
  at all: `minQuakeMag`, `minAlertSeverity`, volcano = not dormant). The
  break-in bar is a second, higher one — a channel can show M4.5 quakes in
  rotation and only interrupt for M6+. `mergeBreakIn` clamps the break-in bar
  up to the pool bar so a setting can never promise a cut for something the
  pool filters out.
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
- **Breaking arrives in bursts, so the pending set is an ARRAY, and nothing in
  it is silently dropped.** A met service issuing four severe warnings in one
  publish is the normal case, not an edge case (it is exactly what
  `ALERT_COUNTRY_CAP` already exists to tame in the pool). Three rules follow:
  a burst of the same reason **groups into one break-in** that names all of
  them rather than four interruptions in a row; anything not aired **stays
  queued** and drains at the following shot boundaries; an item leaves the
  queue only by airing, by being covered by a group, or by ageing out past the
  freshness window. "We picked a different one this tick" must never discard an
  event — that was the failure mode of the original single-slot draft.
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
  /**
   * Per-reason "how big does it have to be" thresholds. These are the BREAK-IN
   * bar, which is separate from — and never below — the channel's POOL bar
   * (`DirectorConfig.minQuakeMag` / `minAlertSeverity`, "what may air at all").
   * A channel can air M4.5 quakes in rotation but only interrupt for M6.0+.
   * `mergeBreakIn` clamps each to at least its pool counterpart, so a config
   * can never promise a break-in for something the pool filters out.
   */
  minQuakeMag: number;        // default = DEFAULT_DIRECTOR_CONFIG.minQuakeMag (4.5)
  minAlertSeverity: SeverityRank;  // 0–4, SEVERITY_LABELS; default = minAlertSeverity (3 = Severe)
  /** Volcano bar: "erupting" = new/continuing eruptive activity only (default);
   *  "unrest" also breaks in when a volcano flips into unrest. Mirrors the
   *  existing VOLCANO_LEVELS split that `volcanoHoldSeconds` already uses. */
  volcanoMin: VolcanoLevel;   // default "erupting"
  /** How fresh a quake/alert must be, minutes (was the hard-coded 20). Volcanoes
   *  keep their own 6 h status-flip window — the source is a weekly bulletin. */
  windowMinutes: number;      // default 20, min 1
  /** Immediate mode only: never interrupt a shot younger than this, seconds. */
  guardSeconds: number;       // default 6, min 0
  /** Immediate mode only: minimum gap between two event break-ins, seconds. */
  cooldownSeconds: number;    // default 120, min 10
  /**
   * Burst grouping. When this many or more qualified events of the SAME reason
   * are pending within `clusterWindowSeconds`, they air as ONE break-in naming
   * all of them instead of interrupting once each. 0 disables grouping (every
   * event gets its own cut, queued and drained one at a time).
   */
  clusterMin: number;            // default 3, max 10
  clusterWindowSeconds: number;  // default 180
  /** How many pending break-ins the channel keeps queued at once; the lowest-
   *  scored fall off the end (recorded as `dropped`, never silently lost). */
  maxPending: number;            // default 12, min 1
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
/** Why this cut jumped the queue — absent on an ordinary rotation cut.
 *  `items` is present on a GROUP cut (a burst of warnings aired as one shot):
 *  every event the cut covers, so the deck can list them and the as-run log can
 *  record all four rather than only the one the camera framed. */
breakIn?: {
  reason: BreakInReason;
  /** it cut the previous shot short */
  interrupted: boolean;
  items?: { segmentId: string; title: string; subtitle?: string }[];
};
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

/** One qualified, not-yet-aired event waiting its turn — the channel's break-in
 *  QUEUE. Four warnings issued together put four of these in the array. */
export interface PendingBreakIn extends FreshEvent {
  queuedAt: number;
  /** Set when a group cut aired it alongside others, so it is never re-offered. */
  coveredBy?: string;
}

export interface BreakInRunnerView {
  now: number;
  current: { id: string; kind: SegmentKind; startedAt: number; areaKey?: string } | null;
  seen: ReadonlySet<string>;      // segment ids aired this session
  /** Keys already DEALT WITH: aired, covered by a group cut, aged out, or
   *  dropped off the end of a full queue. Never "we picked another one this
   *  tick" — an unpicked event stays queued and gets its turn. */
  handled: ReadonlySet<string>;
  lastBreakInAt: number;
  lastRoundupBreakInAt: number;
  favourites: { countries: ReadonlySet<string>; regions: ReadonlySet<string> };
}

/** Pure: fold this tick's fresh events into the queue — qualify, de-dupe by
 *  `key`, drop entries past the freshness window, sort by score, trim to
 *  `maxPending`. Returns what fell off so the caller can log it as `dropped`. */
export function reconcilePending(
  pending: readonly PendingBreakIn[],
  fresh: readonly FreshEvent[],
  cfg: BreakInConfig,
  r: BreakInRunnerView,
): { pending: PendingBreakIn[]; aged: PendingBreakIn[]; dropped: PendingBreakIn[] };

/** Pure: what breaks in NOW — one event, or a GROUP of them when a burst of the
 *  same reason is waiting. Null in boundary mode or when no gate is satisfied. */
export function selectBreakIn(
  pending: readonly PendingBreakIn[],
  cfg: BreakInConfig,
  r: BreakInRunnerView,
):
  | { type: "single"; item: PendingBreakIn }
  | { type: "group"; reason: BreakInReason; items: PendingBreakIn[] }
  | null;

/** Pure: does this event qualify as breaking for this channel (used by BOTH the
 *  boundary builders and the queue) — reason enabled, threshold met, inside
 *  the window (volcano: `volcanoMin` + 6 h), round-up: favourite (or worldRoundup). */
export function qualifiesAsBreakIn(ev: FreshEvent, cfg: BreakInConfig, favourites, now): boolean;
```

`selectBreakIn` rules, in order:

1. **Gates** (any failure = null, queue untouched): `enabled && interrupt ===
   "immediate"`; a current shot exists and is not `ad`; `now -
   current.startedAt ≥ guardSeconds`; per-reason cooldown (`cooldownSeconds`
   for events, `roundupCooldownMinutes` for round-ups).
2. **Eligibility** within the queue: not `handled`, not `coveredBy`; event
   reasons additionally not `seen`, not the current segment, and not the
   current shot's `areaKey` (don't interrupt Japan-the-country with a Japan
   quake the deck is already showing — that one airs at the boundary instead).
3. **Group or single.** Take the first reason in `BREAK_IN_REASONS` with any
   eligible entries. If `clusterMin > 0` and that reason has `≥ clusterMin`
   entries whose `at` values span `≤ clusterWindowSeconds`, return a **group**
   of them (highest score first, capped at `clusterMin * 2` named items).
   Otherwise return the highest-scored **single**.

Everything eligible but not returned stays in the array. In immediate mode the
cooldown means the rest cannot interrupt again straight away — they drain
through the boundary tier (`selectPriority` reads the same queue), so a burst
of four becomes one interruption plus three normal-boundary cuts, or one
grouped interruption naming all four.

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

- `SceneRunner` gains `pending: PendingBreakIn[]` (the queue), `lastBreakInAt`,
  `lastRoundupBreakInAt`, `handled: Set<string>` (capped like `seen`).
- Extract the existing ~100-line cut block into `performCut(r, next, pool, meta)`
  (bookkeeping + emit + air log). The current boundary path calls it unchanged.
- New branch **before** the `expired || skipRequested` check on every tick —
  the queue is reconciled every tick whether or not anything airs, so a burst
  that lands during a long shot is all still waiting when the shot ends:

```ts
const { pending, aged, dropped } = reconcilePending(r.pending, fresh.since(), cfg.breakIn, viewOf(r, cfg, now));
r.pending = pending;
for (const ev of [...aged, ...dropped]) r.handled.add(ev.key);   // recorded, not silently lost

const pick = selectBreakIn(r.pending, cfg.breakIn, viewOf(r, cfg, now));
if (pick) {
  const items = pick.type === "group" ? pick.items : [pick.item];
  const seg = pick.type === "group"
    ? await buildGroupSegment(db, cfg, pick.reason, items)   // one shot naming all of them
    : (await candidateForFresh(db, cfg, pick.item))?.segment ?? null;
  // Only what actually aired (or failed to build) leaves the queue.
  for (const ev of items) r.handled.add(ev.key);
  r.pending = r.pending.filter((p) => !r.handled.has(p.key));
  if (seg) {
    stamp(seg, { reason: pick.reason, interrupted: true, items }, cfg);
    r.lastCutWasPriority = true;      // keeps the existing one-normal-cut cooldown
    (pick.reason === "roundup" ? r.lastRoundupBreakInAt = now : r.lastBreakInAt = now);
    await performCut(r, seg, pool /* stale upNext is fine */, { breakIn: true, now });
    continue;
  }
}
```

- `buildGroupSegment` frames the burst rather than one member: camera on the
  centroid of the items' centres at a zoom that fits their span, falling back
  to the top-scored item's own framing when the span is wider than a hemisphere
  (scattered warnings are not one picture). Title comes from the phrasebook —
  "4 NEW SEVERE WARNINGS", subtitle the leading area plus a count ("Bavaria and
  3 more") — so source CAP strings still never reach air. `segment.id` is
  `breakin:<reason>:<earliest key>` so the as-run log and the `seen` tally have
  something stable to key on.
- The boundary path is unchanged in shape but now reads the same queue: it asks
  `selectPriority` over candidates whose `breakIn` is set, which is exactly the
  set still sitting in `r.pending`. That is what drains the remaining three
  warnings of a burst over the following cuts.
- `stamp()` sets `segment.breakIn` and `segment.incomingMs` per
  `cfg.breakIn.incoming` (`"breakIns"` → only when `breakIn` is set;
  `"allEvents"` → every `isTargetedEvent` kind, with `breakIn` absent;
  `incomingSeconds || transitionSeconds`). Boundary-mode priority picks get
  `breakIn = { reason, interrupted: false }` via the same helper so the on-air
  treatment is identical in both modes.
- **Operator readout.** `DirectorState` gains `breakInQueue: { reason: BreakInReason;
  title: string; at: number }[]` (the first few of `r.pending`) so `/control`
  can say "3 more warnings waiting" instead of the operator wondering where the
  other three went. Readout only, like `lastShownAt`.
- **As-run log** — see §5; every break-in, every member of a grouped one, and
  every queue drop is recorded.

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

**A grouped break-in** (four warnings in one cut) keeps the same treatment and
uses the deck to carry the count: the reticle caption reads the group title
("4 NEW SEVERE WARNINGS"), and the deck leads with a `break-in-items` slide
listing each `segment.breakIn.items` entry — area, hazard, severity — before
the normal slides for the framed one. One shot, four events named, no
four-cuts-in-a-row.

**Control page** — `DirectorOnAirReadout` shows `⚡ BREAK-IN · interrupted
<previous title>` when `segment.breakIn?.interrupted`, and "last break-in Xm
ago" from `DirectorState` (add `lastBreakInAt?: number` to the state; readout
only, like `lastShownAt`). Beneath it, the **break-in queue**
(`DirectorState.breakInQueue`) lists what is still waiting — "3 more warnings"
— so a burst is visibly draining rather than apparently lost.

### 4. Admin card — `public/src/components/admin/scenes/BreakInSettings.tsx` (new)

This is the operator-facing answer to "when a new warning / eruption / quake
lands, what does this channel do?". On `/admin/scenes/:id` the card is headed
**Director: break-ins** — one of the director family the
[per-channel config plan](./director-channel-config-plan.md) §5 defines (that
plan owns the card names and order). It is the partner of that family's
**Director: pools & rotation** card: pools holds the bar for what may air at
all, break-ins holds the bar for what interrupts, and each row here prints the
pool bar beside its own so the pair reads as one decision.

Same contract as every other card on the page:
`useSceneDraft().stageDirector(sceneId, { breakIn: <complete object> })`,
refetch on `epoch`, own file, nothing live until Save. Layout, top to bottom:

1. **Cut to breaking events** — master switch, plus the channel's Auto/Off
   director chip (a break-in can only happen while the director is driving).
2. **When** — radio: *At the next shot change* (boundary, today's behaviour) /
   *Interrupt the current shot* (immediate). Immediate reveals **Guard** (s —
   "never cut a shot shorter than this") and **Cooldown** (s — "at most one
   break-in per cooldown"), with the fixed rule stated as helper text: a
   commercial break always finishes.
3. **What breaks in** — one row per reason, each a checkbox + its threshold.
   The threshold reads in words, not a raw rank, and each row states the
   channel's pool bar underneath so the relationship is visible:

   | Row | Threshold control | Helper line |
   |---|---|---|
   | **Earthquakes** | magnitude select, `QUAKE_MAGNITUDE_BANDS` labelled — M4.5 *Light* … M8 *Great* | "This channel airs M{pool}+ · breaking in at M{breakIn}+" |
   | **Weather warnings** | severity select, `SEVERITY_LABELS` — Moderate / Severe / Extreme | "This channel airs {label}+ warnings · breaking in at {label}+" |
   | **Volcanoes** | status select, `VOLCANO_LEVELS` — *Eruptions only* (default) / *Eruptions and unrest* | "Status changes are read from the weekly bulletin, so the window is 6 hours" |
   | **Round-ups** | place scope, fixed to this channel's favourites + a *World round-up too* sub-checkbox, and its own **cooldown** (minutes) | "A new round-up for {n} favourite countries / {m} areas" |

   A threshold select never offers a value below the channel's pool bar (the
   clamp in `mergeBreakIn`, surfaced as disabled options with "below this
   channel's pool threshold"). Each row shows an `info` Alert when its slide
   type is off under *Which slide types air* — "Earthquakes are off in
   Director: programme, so they can't break in" — mirroring the existing
   favourites warning, with a link up to that card.
4. **Freshness window** — minutes (quakes and warnings; volcanoes use their own
   6 h status-flip window and say so). Helper: "an event older than this is
   news, not breaking — it still airs through normal rotation".
5. **On air** — *Incoming reticle*: Off / Breaking cuts only / Every event
   shot; *Length*: seconds (0 = match the channel's transition time).

A **Reset to defaults** button stages `DEFAULT_BREAK_IN`, same as the other
tuning cards in that group.

`DIRECTOR_PRESETS` stay content-only (they don't touch `breakIn`);
`POST /api/scenes` clones the whole config, so new channels inherit the source
channel's break-in settings — document in the card hint.

### 5. As-run log and the per-video record

Everything the director does on its own initiative has to be readable
afterwards **against the video it went out on**. That chain already exists and
break-ins ride it rather than building anything new: `AirEntry` per cut →
`loadAsRunTimeline` ([vod-bundle.ts](../shared/src/vod-bundle.ts), the ONE
loader both surfaces share) → `/admin/runs`, `/admin/streams/:id`, the YouTube
description chapters ([chapters.ts](../worker/src/stream/chapters.ts)) and the
public `/vod/:videoId` page.

**`AirEntry` gains** (strict schema in
[air-log-model.ts](../shared/src/db/air-log-model.ts), so each needs its path
declared or it silently drops — plus repo/parity test):

| Field | Why it is not enough to keep `breaking` alone |
|---|---|
| `breakIn?: { reason: BreakInReason; interrupted: boolean }` | separates "jumped the queue at a shot change" from "cut the previous shot short", and records WHY — new quake, new warning, eruption, round-up |
| `breakInItems?: { segmentId: string; title: string; subtitle?: string }[]` | the other three warnings a **grouped** cut covered; without it the log shows one cut and three events vanish |
| `command?: { source: "operator" \| "viewer"; author?: string }` | → [commands plan](./director-commands-plan.md): who ordered this cut |

The existing `breaking: boolean` stays as the coarse flag (it already drives
chapter ranking); `breakIn` is the detail beside it.

**`AirRun` gains counters** alongside `cuts` / `kindCounts`: `breakIns`,
`grouped`, `commands`, `viewerRequests`, `queueDropped` — one `$inc` on the
write that already happens per cut, so a run header can read "47 cuts · 6
break-ins · 3 viewer requests" without scanning every entry.

**Where it surfaces:**

- **`/admin/runs` and `/admin/streams/:id`** — `RunTimelineEntry.tsx` adds a
  "⚡ break-in · new warning" chip (with "· interrupted" when it cut a shot
  short) beside the existing "⚡ breaking", and "👤 operator" / "💬 @rich" for
  commanded cuts. A grouped cut lists its members in the row's existing
  collapsible area — the one `details` already opens — so one row says
  "4 severe warnings" and expands to name all four.
- **YouTube chapters** — no new logic: `buildChapters` already ranks `breaking`
  entries far above the rest and `chapterLabel` already prefixes ⚡, so
  break-ins win chapter slots for free in a character-capped description. A
  grouped cut's label carries the count ("⚡ 4 severe warnings · Bavaria"),
  which is one line instead of four.
- **Public `/vod/:videoId`** — same loader, same rows, so the public as-run
  page credits break-ins identically.
- **Nothing aired = no `AirEntry`.** A queue age-out or drop writes a worker
  ring line instead (`queue-logs`, with the event key and reason), so "why did
  we never show that one" stays answerable without inventing phantom cuts.

### 6. Persistence

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
| 1 | Immediate interrupt + the pending QUEUE | worker `fresh.ts`, `loop.ts` (`performCut` extraction + branch + `r.pending`), `reconcilePending`/`selectBreakIn`, repo `*Since` methods + tests; `DirectorOnAirReadout` + queue readout | "Interrupt the current shot" works for quake/storm/volcano; a burst queues and drains instead of being dropped. Worker restart (user). |
| 1b | Burst grouping + as-run log | shared `air-log-model.ts` (`breakIn`, `breakInItems`, `command`, run counters) + parity/repo tests; worker `buildGroupSegment`, `airlog.ts`; public `RunTimelineEntry` chips + member list, `break-in-items` slide | Four simultaneous warnings air as one cut naming all four; every break-in is readable on `/admin/streams/:id`, in the video's chapters and on `/vod/:videoId`. |
| 2 | INCOMING reticle | public `lib/incoming(.test).ts`, `EventOverlay.tsx`, `BroadcastCard.tsx`, `eventPulse` gating, `kinds.ts` `BREAK_IN_LABEL` | Pre-roll + lock on breaking cuts (and optionally all event shots). |
| 3 | Round-ups | worker `fresh.ts` round-up queries, `candidateForFresh` roundup branch, place-roundup/event-summary `generatedSince`; public `mode-slides.tsx` lead-slide rule | Favourite-place / world round-ups break in with the deck badge treatment. |

Each phase ships green on its own (`./test`), Phase 0 first because it removes
the hard-coded windows the later phases would otherwise duplicate.

## Tests

- **shared**: `mergeBreakIn` clamps/defaults/unknown-key drop, **including the
  pool-floor clamp** (a `breakIn.minQuakeMag` below the channel's
  `minQuakeMag` is raised to it, same for severity — test both directions so a
  later "simplification" can't drop it); `qualifiesAsBreakIn` per reason
  (window edge, threshold edge, `volcanoMin` erupting vs unrest, round-up
  favourite gating, `worldRoundup`); **`reconcilePending` (the burst case: four
  events in one tick all survive, de-dupe by key, age-out past the window,
  `maxPending` trim reports what it dropped, and an event NOT picked this tick
  is still in the array next tick — the regression this plan exists to
  prevent)**; `selectBreakIn` (boundary mode → null, guard, both cooldowns,
  ad-never-interrupted, seen/handled/current/same-area exclusions, reason
  precedence, score tie-break, group vs single at the `clusterMin` /
  `clusterWindowSeconds` edges); `selectPriority` on
  `Candidate.breakIn` incl. `enabled:false`; config model parity test.
- **worker**: single-item builders produce the same segments `buildCandidates`
  did (snapshot the existing candidates tests through them); `FreshEventWatch`
  with an injected db + fake clock (hwm starts at start, advances, ring
  expiry, `nudge`); `buildGroupSegment` framing (tight cluster → centroid,
  scattered → top item's own frame; title/subtitle from the phrasebook); loop:
  extract-and-test `performCut` bookkeeping and the interrupt branch with a
  stubbed `fresh` (air log gets `breakIn`, outgoing entry's actual hold <
  nominal, `AirRun` counters increment, a grouped cut writes `breakInItems`
  for every member).
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
- A burst of three or more of the same reason inside three minutes airs as ONE
  grouped cut naming them all, rather than three interruptions; the members
  stay in the pool and can still get their own shot later through rotation.
- A queue that overflows `maxPending` drops its lowest-scored entries, not its
  oldest — a magnitude 7 that lands during a warning storm must not be pushed
  off the end by a dozen moderate warnings.
- Round-up break-ins are favourites-only (plus the optional world round-up);
  the 12-hourly batch therefore yields at most one break-in per
  `roundupCooldownMinutes`, biggest-alert-count place first.
- Volcano break-ins default to eruptions only (a flip to *unrest* airs through
  rotation unless the channel opts in), reusing the existing 6 h status-flip
  window. A finer bar off `usgsAlertLevel` / `usgsColorCode` / `reportVei` is
  possible later, but those fields are only populated for US-monitored
  volcanoes, so status is the one signal every volcano has.
- "Every event shot" incoming mode also applies to flights/ships (they are
  targeted kinds); the label there is `EVENT DETECTED`, not `INCOMING`.
