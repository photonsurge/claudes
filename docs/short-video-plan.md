# Scripted short videos — plan

> **Status: IN PROGRESS** (2026-10-04). WP1-4 built and green (round-ups generate and
> preview on `/admin/shorts`); not yet run against real data. Next: WP5 render. Planned on Fable, executed
> by Opus sub-agents: the work packages in §10 are handed over one at a time.
> Phase 1 is landscape video through a live run. Phase 2 is Shorts (§9).
> Shares two refactors with [director-break-in-plan.md](./director-break-in-plan.md) and
> [director-commands-plan.md](./director-commands-plan.md) (see §3). Whichever lands
> first does them; the other reuses them.

A routine makes a short, finite video. It opens on a place (a country, an area or the
whole globe) with its lineup and round-up, then cuts through what is active there:
alerts, earthquakes and volcanoes. Then it ends.

**Round-ups first.** The first thing shipped is the round-up video on its own: the
world round-up, an area round-up or a country round-up, with no event clips. The event
switches are built but default to off, and they and the timeline editor come after
render and scheduling (§10). An operator can open the script
in a timeline editor, test it offline, and render it now or on a schedule. YouTube
Shorts (portrait) are phase 2 and need a new on-air UI.

## 1. What exists and what doesn't

- The director (`worker/src/director/loop.ts`) is an endless picker. Its only outside
  input is `skipNonce`. A short needs a fixed sequence that ends.
- The country kind only covers the `COUNTRY_SHOTS` catalog (about 30 countries), so
  that is v1's subject list. A country without a computed tour airs as one framed shot.
- Output is RTMP to YouTube through OBS. Nothing records to a file, and there is no
  ffmpeg anywhere.
- `/watch` has no portrait layout.
- Every scene in `/api/scenes` shows on the public home page.
- An encoder's browser source shows the encoder's own bound scene, whatever scene the
  run names.
- The one-run-per-encoder guard only counts runs that publish to YouTube.
- A run's `scheduled` status means "go-live is queued now". Nothing can be booked for
  a later time.

## 2. The script is a saved list of references

A script stores what to show and for how long. It does not store built `Segment`s.
The worker builds the segments when the script plays, from live data.

```ts
// shared/src/short-script.ts
export interface ShortClip {
  id: string;
  /** A director segment id: "country:japan", "storm:<source>:<identifier>",
   *  "quake:<id>", "volcano:<id>". Same form as the commands plan's
   *  CommandTarget { type: "segment" }. */
  target: string;
  durationMs: number;
  /** Look override for this clip, same shape as DirectorConfig.kindLooks. */
  look?: KindLook;
  /** Country and region clips: fly only the first N tour stops. */
  maxStops?: number;
  /** Country and region clips: open the deck on the place round-up, not the
   *  nation card. Same field the commands and break-in plans add to Segment. */
  leadSlide?: "roundup";
  /** Cached for the editor only; refreshed on every resolve. */
  label: { title: string; subtitle?: string; icon?: string };
}

/** Where a video looks. */
export type ShortScope =
  | { type: "country"; id: string }   // a COUNTRY_SHOTS id
  | { type: "area"; id: string }      // a REGION_SHOTS id
  | { type: "globe" };

/** Which kinds of active event the template pulls in. */
export interface ShortInclude { alerts: boolean; quakes: boolean; volcanoes: boolean }

export interface ShortScript {
  id: string;
  template: "lineup";
  scope: ShortScope;
  include: ShortInclude;
  title: string;
  clips: ShortClip[];
  status: "draft" | "ready";
  /** The latest play per scene, so a preview can't overwrite a render's record. */
  plays?: {
    sceneId: string;
    playNonce: number;
    startedAt: number;
    endedAt?: number;
    stopped?: boolean;
    runId?: string;
    clips: { id: string; startMs: number; durationMs: number }[];
    skipped: { id: string; reason: string }[];
  }[];
}
```

Why references:
- A saved alert can expire before the render. Resolving at play time skips it, so a
  dead warning never airs.
- The editor never needs the worker to add a clip. It reads countries, alerts, quakes
  and volcanoes from Mongo as the rest of admin does, and writes a target string.
- The document stays small and the Mongoose schema stays simple.

Clip start times are derived from order and duration, never stored. Pure helpers in
the same file: `clipStarts`, `scriptDurationMs`, `clipAt(clips, elapsedMs)`.

Persistence: `shared/src/db/short-script-{model,repo}.ts`, exposed as `db.shortScripts`.

`plays` belongs to the runner. The API sanitiser never accepts it, and saving an edited
script leaves the stored value alone. Read one with `playFor(script, sceneId)`.

A clip can also carry `tourDwellMs`. The live channel parks 40 s on each tour stop;
a scripted tour spreads its stops evenly across the clip (at least 8 s a stop).

## 3. Script mode in the director

`DirectorMode` becomes `"off" | "auto" | "script"`. `DirectorConfig` gains:

```ts
script?: { scriptId: string; fromClip: number; playNonce: number; record: boolean };
```

Setting mode to `script` and bumping `playNonce` starts a play. This is the same
Mongo-polled pattern as `skipNonce`, so the editor (public) and the render job
(worker) start a play the same way. Both new fields must go in
`director-config-model.ts` (the enum on line 23 and the new sub-document), or strict
Mongoose drops them.

**A separate runner, not a branch in `tick()`.** New file
`worker/src/director/script-runner.ts` with its own 250 ms interval:
- The auto loop's tick is 1 s and is held up whenever a candidate pool build is slow.
  A script must not wait behind another scene's pool build.
- Cuts follow an absolute schedule: clip *i* starts at `t0 + sum of earlier durations`.
  Lateness never accumulates, so the total length is exact to one tick.
- On start it resolves every clip up front (`resolveClip`), drops the ones whose
  subject is gone, and records them in the play record's `skipped`.
- `upNext` is the next few real clips, so `/watch` pre-warms their focus bundles.
- It heartbeats every 2.5 s like the auto loop.
- At the end it emits inactive, sets the scene's mode back to `off`, and stamps
  the play record.
- `record: false` (editor previews) skips the as-run log. Otherwise every preview
  would add an `AirRun` to `/admin/runs`.
- **Stopping.** Setting the scene's mode to `off` stops a play. The runner sees the
  scene leave script mode, emits inactive, and stamps the play record's `endedAt` with
  `stopped: true` so the render job can tell a stop from a finish. The leftover
  `script` object on the config is inert; `mode` alone decides whether a script plays.
- **Switching from auto.** The auto loop emits inactive when a scene leaves auto. If the
  new mode is `script` it must skip that emit, or it can land after the script's first
  cut. The two seeded scenes are never in auto, so this only guards operator error.

**Shared refactors** (pure, no behaviour change, existing tests stay green):
- Extract the cut bookkeeping in `loop.ts` (lines 330-401: `spinEpoch`,
  `cutTransitionMs`, seq, `endsAt`, emit, `airLogCut`) into `performCut(r, next, pool,
  meta)`. That is the signature the break-in plan specifies.
- Factor single-item builders out of `candidates.ts`: one per kind the template
  uses, named as the break-in plan names them (`countryCandidate`, `regionCandidate`,
  `stormCandidate`, `quakeCandidate`, `volcanoCandidate`, `summaryCandidate`), each
  called by the existing loop it came from. **Done:** they live in
  `worker/src/director/builders.ts`; `performCut` lives in `cut.ts`.
- `performCut` writes `spinEpoch` and `cutTransitionMs` onto the segment it is given,
  so `resolveClip` must return a fresh segment for every airing.
- `resolveClip(db, cfg, clip)` in `worker/src/director/script-resolve.ts` splits the
  target with `focusSubjectOf`, loads the one document, calls the builder, then applies
  `durationMs`, `look` and `maxStops`.

**Fixed scenes, not one per script.** Two seeded scenes, `shorts` (render) and
`shorts-preview` (editor), modelled on `seedSimpleScenes.ts`. Their ControlState and
DirectorConfig carry the shorts' brand, look, widgets and transition pace, all editable
on `/admin/scenes/:id`. They need a flag that keeps them off the public home page and
the channel launcher.

The on-air client needs no change. It reacts to `director:state` for its scene id. The
operator surfaces do, because they all treat any mode but `auto` as off:
- `DirectorPanel.tsx` lines 82, 101 and 111: script mode shows as off, and the toggle
  would switch a playing script to auto.
- `admin/scenes/DirectorSettings.tsx` lines 52-53: the chip shows a grey "Off".
- `app/control/page.tsx` line 86: the settings form opens as if the director were off.
- `app/api/scenes/route.ts` line 81: cloning a scene copies the source's `script`
  object. Strip it.
Each should show "playing a script" with a Stop button.

## 4. The lineup template

One template, `buildLineup(db, cfg, scope, include, budgetMs)` in
`worker/src/director/script-template.ts`. The scope and the include switches give
every variant: a country's alerts, an area's quakes and volcanoes, a global round-up
of everything.

**1. The opener, by scope.**

| Scope | Opening clip | What it carries |
|---|---|---|
| country | `country:<id>` | the national tour and the country deck |
| area | `region:<id>` | a tour of the area's top countries and the region deck |
| globe | `global:roundup` | the world round-up spin: the narrative and its hotspot stops |

- A tour's natural length is `stops x (transition + dwell)`, which can pass a minute on
  its own. `maxStops` is set so the opener takes about 40% of the budget.
- A one-country area (the UK, a US band) has no tour. It airs as one framed shot.
- `global:roundup` is a new target that resolves to the freshest world round-up. With
  none fresh, it is a plain world spin.

**2. The events, by scope and by the include switches.**

| Kind | What counts as active | In a country | In an area | Globe |
|---|---|---|---|---|
| alerts | active, at or above the scene's `minAlertSeverity`, with a polygon | `alertCountryCode` matches | matches a member country | all |
| quakes | inside the 48 hour live window, at or above `minQuakeMag` | inside the country polygon, or offshore inside its bbox and in no other country | inside the region bbox | all |
| volcanoes | erupting or in unrest | same test as quakes | inside the region bbox | all |

- Thresholds come from the `shorts` scene's director config, so they are tuned where
  the live channels' are.
- Country polygons are on the Country docs and `shared/src/geo/pointInPolygon.ts`
  exists. Filter by bbox first so only a few points reach the polygon test.
- Regions are bbox-only, so an area's quakes and volcanoes can include a neighbour's
  near the edge. Alerts don't have this problem.

**3. Picking and ordering.** Events are ranked by the director's own scores (quake
`40 + mag x 10`, alert and volcano `50 + severity x 12`):
- the best event of each included kind goes in first, so a kind with anything active
  always appears;
- then the rest by score, taking one per hazard type before a second of the same type;
- area and globe videos take at most three events per country, the cap the live pool
  uses, so one busy met service can't fill the video;
- the budget is the only limit on how many. The editor lists everything left out.

**4. The close.** A wide shot of the scope: the country or area framed with
`maxStops: 0`, or a world spin.

**Round-ups.** A country or region shot already shows its place round-up as the deck's
second slide, when that place has `roundupEnabled` and a round-up exists. The world
round-up already rides the global spin. So every scope airs its round-up today with no
new on-air work. Two additions make it a proper round-up video:
- `leadSlide: "roundup"` on a country or area opener, set by the template when a
  round-up exists, so the prose leads. The clip's floor then includes its read time.
- Place round-ups regenerate on a 12 hour cycle, so a scheduled video can show one
  that is hours old. A schedule can ask for a fresh one first (§8).

**Round-up only** (no include switch on) is the default and the first release:
- The video is the opener, leading with the round-up, then the close.
- The opener runs its natural length: the longer of its tour and the round-up's read
  time (`shared/src/reading-pace.ts`). The budget never cuts a round-up short. It only
  limits how many event clips are added.
- A country or area with no round-up, or a globe with no fresh world round-up, is an
  error with a reason, not a video. Place round-ups are switched on per place at
  `/admin/place-roundups`.

**A quiet scope.** With switches on but nothing active, the video is the opener and
the close, and the opener gets the unused budget back. A schedule can choose to skip
those days (§8).

Default budget is 75 s (`DEFAULT_SHORT_BUDGET_MS`). It is a parameter of the generate
job and, later, a field on the schedule; it is not a scene setting. No narration in v1. The audio
bed plays, and the presenter LLM comes later (presenter-llm-plan).

## 5. Timeline editor: `/admin/shorts` and `/admin/shorts/:id`

One track of clips in v1.
- **Track:** blocks with width proportional to duration. Drag to reorder, drag the
  right edge to resize, duplicate, delete. Total length and budget shown above.
- **Add clip:** a picker by kind. Countries come from `COUNTRY_SHOTS`. Alerts, quakes
  and volcanoes come from the existing Mongo-backed routes, filtered to the script's
  scope by default.
- **Inspector:** duration, look override and `maxStops` for the selected clip.
- **Preview:** `/watch/shorts-preview` in an iframe. "Play from here" patches the
  preview scene's director config (`fromClip`, bumped `playNonce`, `record: false`).
  The playhead follows `director:state` (`seq` and `startedAt`).
- **Minimum duration:** a country clip's floor is its tour length for the chosen
  `maxStops`. Other kinds use the deck's read time when it can be estimated. A clip
  under its floor shows a warning, not a block. This is the open shot-budget problem
  from deck-scroll-pacing-plan.
- **Stale clips:** a clip whose subject is no longer in Mongo is flagged in place.
- **Regenerate:** rebuild from the template, after a confirm.
- **Save:** staged edits and one Save, like the scene settings Save bar.
- **Render:** opens the render form (§6.1) for an offline test or a live run, now or
  at a set time.

No free scrubbing. The director only runs forward, so "play from clip N" is the honest
preview.

Conventions: MUI v9 with `src/theme/` tokens; track, clip block, inspector, picker and
preview each in their own file; routes wrapped in `withApiLog` and admin-gated.

Later tracks, added only when a template needs them: captions, audio mood, narration,
sponsor slot.

## 6. Render

Three ways to get a video out:

| Option | What it is | Cost |
|---|---|---|
| C. Bounded live run | Go live on a chosen encoder with the `shorts` scene, play the script, end the run. The YouTube VOD is the video. | Small. Reuses `goLive`, `finishRun`, the thumbnail, chapters and the as-run pages. |
| A. OBS record | `StartRecord` on an encoder, no broadcast, then upload the file. | New OBS calls, a way to get the file off gds1, an upload step. |
| B. Playwright | Headless Chrome records `/watch/shorts`. | webm needs ffmpeg; headless WebGL may render in software. |

**Phase 1 is C.** It needs no new infrastructure. A VOD has a few seconds of slop at
the head and tail that the API can't trim, and a live VOD is not a Short. **Phase 2 is
A**, because Shorts need an uploaded portrait file (§9). B is dropped.

### 6.1 The render form

One dialog, opened from the editor's Render button and from a schedule (§8):

- **Encoder:** the operator picks it. The picker shows what each one is doing (§6.2).
- **YouTube channel:** the same connected-account select the streams form uses. Shorts
  go on the same channel as the live streams unless another is picked.
- **Privacy:** public, unlisted or private. Default unlisted.
- **Mode:** *Offline test* (§7) or *Live*.
- **When:** *Now*, or *At* a date and time. Repeating runs live on schedules (§8).

### 6.2 "This encoder is in use"

Today the form's encoder select is a bare list and the busy check only fires on submit.
Add a pure helper `encoderOccupancy(encoders, runs, slots, schedules, now)` in `shared`,
returned per encoder by the `/api/streams` snapshot (it already loads all four inputs
but schedules):

| State | Shown as |
|---|---|
| free | "free" |
| live | "live: Main channel, since 14:02" plus "until 14:32" when the run is bounded |
| held | "held by always-on slot Main". An enabled slot owns its encoder even between runs |
| booked | "free, short booked 18:00" for the next schedule within 24 hours |
| disabled | greyed out |

A new `EncoderSelect` component renders it and replaces the bare select on
`/admin/streams` too. For *Now*, a live or held encoder can't be chosen. For *At*, it
can, with a warning. The form is advisory: the render job checks again when it fires.

### 6.3 Changes the run pipeline needs

- **`Run.script?: { scriptId: string; scheduleId?: string; offline: boolean }`**, added
  to the run model.
- **The encoder shows its own scene, not the run's.** `provisionEncoderScene(encoderId)`
  resolves the scene from the encoder's binding. Give it a `sceneId` override, pass
  `shorts` for script runs, and re-provision the encoder's own scene when the run
  finishes.
- **The busy guard only counts YouTube runs.** `activeRunForEncoder` and
  `encoderBusyWith` must also count runs with `script` set, so an offline test holds
  its encoder.
- Script runs go out with chat off and announce off.
- An offline run must not appear as live on the public home page.

### 6.4 The render job

`worker/src/jobs/short-video.ts`, `render({ scriptId, encoderId, accountId, privacy, offline, scheduleId })`:
1. Refuse if the encoder is busy or the script resolves to no clips. The reason is
   recorded and shown, never silent.
2. Create the `Run` on scene `shorts`: title from the script, `durationMs` as a safety
   cap (script length plus two minutes).
3. `goLive(runId)`, then wait for the run to report live.
4. Start the script with `record: true`.
5. When `playFor(script, "shorts")` for this play's nonce has `endedAt`, call
   `finishRun(runId, "auto")`. A play marked `stopped` fails the render.

The job polls Mongo while it waits, so it holds no CPU. It goes in the `mid` tier.
`/admin/streams/:id` already shows the result, joined by scene and time window.

## 7. Offline test

The same render with YouTube switched off. It is the same job and the same code path,
so a pass means something.

1. **Preflight report**, no side effects:
   - clips resolved and clips skipped, each with its reason;
   - total length against the budget, and clips under their floor;
   - encoder reachable (`probe`);
   - the chosen YouTube account usable (no stamped `authError`, quota not blocked).
     Read from what the worker already records, with no API call.
2. **Rehearsal.** A `Run` with `script.offline: true`. In `goLive` that branch points
   the encoder's browser source at `/watch/shorts` and marks the run live. It creates no
   broadcast, sets no stream key and never calls `StartStream`.
3. **Evidence.** One screenshot per clip, taken from OBS itself (`GetSourceScreenshot`,
   a new call in `obs/client.ts`) at the clip's midpoint. They show on the timeline
   blocks and the run page. This is what a browser preview can't prove: OBS has had
   missing fonts, software rendering and blur problems before.
4. **Finish.** The encoder goes back to its own scene.

The operator can watch a rehearsal live in the editor, because every browser on
`/watch/shorts` sees the same cuts OBS does.

The runner's play record (`playFor(script, "shorts")`) holds the real schedule, which
is what the job screenshots against. Screenshots go in a new blob namespace (add it to `BLOB_NAMESPACES`), keeping
only the latest test per script.

A test that also exercises YouTube is *Live* mode with privacy set to private.

## 8. Scheduling

```ts
// shared/src/short-schedule.ts
export interface ShortSchedule {
  id: string;
  name: string;
  enabled: boolean;
  what:
    | { type: "script"; scriptId: string }
    | {
        type: "template";
        /** A fixed scope, or "auto": pick the country or area with the most going on. */
        scope: ShortScope | { type: "auto"; of: "country" | "area" };
        include: ShortInclude;
      };
  /** Regenerate the scope's place round-up before rendering (one LLM call). */
  refreshRoundup?: boolean;
  /** Make no video when nothing is active in the scope. */
  skipIfQuiet?: boolean;
  when:
    | { type: "once"; at: number }
    | { type: "weekly"; days: number[]; time: string; tz: string };  // "07:30", IANA zone
  encoderId: string;
  accountId?: string;
  privacy: YoutubePrivacy;
  offline: boolean;
  nextAt: number | null;
  lastFire?: {
    at: number;
    runId?: string;
    outcome: "started" | "skipped" | "missed" | "refused" | "failed";
    note?: string;
  };
}
```

- **A fixed script runs once. A template repeats.** A repeating schedule generates a
  fresh script each time, because yesterday's alerts are gone. "Every morning, the
  globe, alerts plus quakes plus volcanoes" is one repeating schedule.
- **`auto` scope:** the country or area with the highest summed event score, skipping
  any made in the last few runs.
- **`skipIfQuiet`:** with no active event in scope, the run is recorded as `skipped`
  and nothing renders.
- **`refreshRoundup`:** the render job first runs the place round-up for that one
  country or area, then renders. The `placeRoundups` job needs a single-place entry
  point for this. If the place has round-ups switched off, or the scope is the globe,
  the flag does nothing.
- **One ticker, state in Mongo.** `short-video.tick` is a 60 s repeatable job, the same
  pattern as `stream.reconcile`. It fires every enabled schedule with `nextAt <= now` by
  enqueuing `render`, then sets the next `nextAt`. A once schedule disables itself.
  Editing a schedule is a Mongo write; nothing touches BullMQ.
- **Missed runs are not caught up.** If a schedule is more than 10 minutes overdue it is
  marked `missed`. The test box is powered off for about three hours every day, and a
  burst of stale videos on boot is worse than a gap.
- **A busy encoder is waited for, never pre-empted.** The ticker retries each minute
  inside the 10 minute window, then records `missed: encoder busy`.
- **Render now** skips the ticker and enqueues `render` directly, so the button doesn't
  wait up to a minute.
- `nextFireAt(when, afterMs)` is a pure helper in `shared`, timezone-aware, with tests
  across both DST changes.
- **UI:** a Schedules section on `/admin/shorts`. It lists next run, last outcome and
  an enable switch, and edits through the render form plus a repeat picker (days, time,
  timezone). Bookings feed the encoder picker's "booked" state.

## 9. Phase 2: Shorts (portrait)

The 16:9 on-air chrome can't be squeezed into 9:16. Phase 2 builds a new on-air UI.

- **A new portrait surface.** `WatchSurfacePortrait`, chosen by a scene setting
  (`ControlState.layout: "landscape" | "portrait"`, which must also go in
  `broadcast-state-model.ts`). The URL stays `/watch/:scene`, so OBS provisioning and
  the editor preview don't change. Designed at 1080x1920:
  - the globe fills the frame;
  - a title plate at the top;
  - one stacked deck in the lower part, reusing the existing slide components;
  - no ticker and no right column;
  - YouTube's own Shorts overlay covers the bottom strip and the right edge, so nothing
    important sits there.
  The standing on-air rules still apply: no sub-slides inside a card, no plate shadows,
  scroll pace from `readPaceCps`.
- **Camera framing.** Tour frames and segment zooms are computed for a wide frame. A
  country that fills 16:9 is a sliver in 9:16. The client needs an aspect-aware fit.
- **A portrait encoder.** One OBS instance with a 1080x1920 canvas. The browser source
  already follows the canvas size.
- **A file, not a VOD.** `startRecord` / `stopRecord` / `getRecordStatus` in
  `obs/client.ts`. The file lands on gds1, so it needs a path the worker can read.
- **Upload.** `videos.insert` through `apiCall`. It costs 1,600 quota units of the
  default 10,000 a day, so a handful of Shorts a day is the ceiling next to the live
  streams.
- **Editor.** The preview takes its aspect from the scene. Templates get a shorter
  default budget.

Phase 2 gets its own plan when phase 1 is in. Recorded files also remove the head and
tail slop from landscape videos, so the live-run render can then be retired.

## 10. Work packages

Each is one Opus sub-agent (or two in parallel where the files don't overlap). After
any `shared/src` edit run `./update-shared`. Every package ends with `./test` green.
The worker needs a restart by the user after WP3, WP5, WP6 and WP7.

**Milestone 1: round-up videos, rendered and scheduled.**

| WP | Scope | Depends on | Done when |
|---|---|---|---|
| 1 (done) | Shared contract: `short-script.ts` and helpers, model, repo, `db.shortScripts`, `DirectorMode` `script`, `DirectorConfig.script`, config model fields, schema parity test | none | helpers unit-tested; a script round-trips through Mongo with no dropped fields |
| 2 (done) | Worker refactors: `performCut` and the six single-item builders (§3). No behaviour change | none | existing candidates tests pass untouched |
| 3 (done) | Worker only. 3a: `script-resolve.ts`, `script-runner.ts`. 3b: `script-scope.ts`, `script-template.ts` (round-up only by default; event switches built but off), `generate` job. One-shot CLIs to generate and play a script | 1, 2 | fake-timer tests cover the schedule, a skipped dead subject, `fromClip`, end of script, and no as-run when `record` is false |
| 4 (done) | Round-ups on a preview scene: the two seeded scenes and the hide-from-public flag; the deck honours `leadSlide`; `script` mode on the operator surfaces (§3); `/api/shorts`; a plain `/admin/shorts` page (generate a round-up for the globe, an area or a country; preview; delete) | 3 | an operator generates a round-up and watches it play on `/watch/shorts-preview`, round-up leading |
| 5 | Render: `Run.script`, provision override and restore, busy guard, `render` job, render form, `encoderOccupancy` and `EncoderSelect` (§6) | 4 | a round-up goes live on a chosen encoder and ends itself; a busy encoder shows as busy and is refused with a reason |
| 6 | Offline test: offline branch in `goLive`, preflight report, OBS screenshots (§7) | 5 | a test holds the encoder, never contacts YouTube, and leaves a screenshot per clip |
| 7 | Scheduling: `ShortSchedule`, `nextFireAt`, `tick` job, Schedules UI, "booked" in occupancy (§8) | 5 | a once schedule fires within a minute of its time; an overdue one is marked missed |

**Milestone 2: event clips and the timeline editor.**

| WP | Scope | Depends on | Done when |
|---|---|---|---|
| 8 | The alert, quake and volcano switches in the UI; `/admin/shorts/:id` read-only timeline with "play from here" (§5) | 4 | a lineup with events plays from any clip |
| 9 | Editing: reorder, resize, add, delete, inspector, floors, stale flags, Save | 8 | edits persist and the next play uses them |

**Phase 2: Shorts (§9).** Its own plan once milestone 1 is in.

WP6 and WP7 can run in parallel after WP5. Milestone 2 can run beside WP5-7.

## 11. Decisions

Taken (change here if wrong):
- The operator picks the encoder. Nothing is pre-empted.
- Same YouTube channel as the live streams, through the existing account picker.
- "Offline test" means a full rehearsal on the chosen encoder with no YouTube.
- Missed schedules are skipped after 10 minutes, not caught up.
- Default budget 75 s, default privacy unlisted.
- Round-up videos ship first. Event clips and the timeline editor follow scheduling.

Open:
- Phase 2: how does a file recorded by OBS on gds1 reach the worker?
