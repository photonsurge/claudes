# Scripted short videos — plan

> **Status: IN PROGRESS** (2026-10-04). WP1-4 are built and green: round-up scripts
> generate and preview on `/admin/shorts`, and it has run against local data. Two
> tracks follow: **formats** (§5, WP5-6, a cloud agent) and **getting a video onto
> YouTube on a schedule** (§6 and §8, WP7 and WP9). Planned on Fable, built by Opus sub-agents, one
> work package at a time (§11).
> Shares two refactors with [director-break-in-plan.md](./done/director-break-in-plan.md) and
> [director-commands-plan.md](./done/director-commands-plan.md); both are done (§3).

A routine makes a short, finite video. It opens on a place (a country, an area or the
whole globe) with its lineup and round-up, then cuts through what is active there:
alerts, earthquakes and volcanoes. Then it ends.

**Round-ups first.** The first release is the round-up video on its own: the world
round-up, an area round-up or a country round-up, with no event clips. The event
switches are built but default to off.

**Formats.** A short gets its own full set of settings, the same sort of thing a
channel has. It does not borrow a channel's. A format starts as a duplicate of a
channel and is independent from then on (§5).

**The three videos milestone 1 must produce**, each on a daily schedule, each a
normal landscape YouTube video:

| Video | Scope | Rough length |
|---|---|---|
| Europe round-up | area `europe` | 1-2 min |
| UK round-up | country `uk` | 1-2 min |
| Main areas round-up | `europe`, `usa`, `asia`, `australia`, `africa`, `south_america`, one after another | 5-8 min |

YouTube Shorts (portrait) are phase 2 and need a new on-air UI (§10).

## 1. What exists

Constraints found in the code before any of this was built:
- The director was an endless picker with one outside input, `skipNonce`.
- The country kind only covers `COUNTRY_SHOTS` (about 30 countries) and the area kind
  `REGION_SHOTS`, so those are the subject lists.
- Output is RTMP to YouTube through OBS. Nothing records to a file; there is no ffmpeg.
- `/watch` has no portrait layout.
- An encoder's browser source shows the encoder's own bound scene, whatever scene the
  run names.
- The one-run-per-encoder guard only counts runs that publish to YouTube.
- A run's `scheduled` status means "go-live is queued now". Nothing can be booked for
  a later time.

Built so far (WP1-4):

| Where | What |
|---|---|
| `shared/src/short-script.ts` | script and clip types, helpers, sanitisers |
| `shared/src/db/short-script-{model,repo}.ts` | `db.shortScripts` |
| `shared/src/short-scenes.ts` | the two seeded scene ids and their seed look |
| `shared/src/director.ts` | `DirectorMode` `script`, `DirectorConfig.script`, `Segment.leadSlide`, `Segment.tourDwellMs` |
| `worker/src/director/cut.ts`, `upnext.ts`, `builders.ts` | `performCut` and the one-subject builders |
| `worker/src/director/script-{resolve,runner,scope,template,generate}.ts` | the runner and the lineup template |
| `worker/src/jobs/short-video.ts` | `generate`, `seedScenes` |
| `public/src/app/api/shorts/**`, `/admin/shorts` | generate, list, clip list, preview |
| `/admin/jobs`, group "Short videos" | seed the scenes; generate a world round-up |

CLIs in `worker`: `yarn short:generate`, `yarn short:play`, `yarn seed:short-scenes`.

## 2. The script is a saved list of references

A script stores what to show and for how long. It does not store built `Segment`s. The
worker builds the segments when the script plays, from live data.

```ts
// shared/src/short-script.ts
export interface ShortClip {
  id: string;
  /** A director segment id: "country:japan", "region:europe",
   *  "storm:<source>:<identifier>", "quake:<id>", "volcano:<id>",
   *  or "global:roundup" / "global:spin". */
  target: string;
  durationMs: number;
  /** Look override for this clip, same shape as DirectorConfig.kindLooks. */
  look?: KindLook;
  /** Tour clips: fly only the first N stops. 0 = one framed shot. */
  maxStops?: number;
  /** Tour clips: how long the camera parks on each stop. */
  tourDwellMs?: number;
  /** Open the deck on the place round-up. */
  leadSlide?: "roundup";
  /** Cached for the UI; it is what will air. */
  label: { title: string; subtitle?: string; icon?: string };
}

export type ShortPlace =
  | { type: "country"; id: string }   // a COUNTRY_SHOTS id
  | { type: "area"; id: string };     // a REGION_SHOTS id

export type ShortScope =
  | ShortPlace
  | { type: "globe" }
  /** Several places in one video, in this order (§4). To add in WP10. */
  | { type: "places"; places: ShortPlace[] };

export interface ShortInclude { alerts: boolean; quakes: boolean; volcanoes: boolean }

export interface ShortScript {
  id: string;
  /** The format this video is made in (§5). To add in WP5. */
  formatId: string;
  template: "lineup";
  scope: ShortScope;
  include: ShortInclude;
  title: string;
  clips: ShortClip[];
  status: "draft" | "ready";
  /** The latest play per scene. Written by the runner only. */
  plays?: ShortScriptPlay[];
}
```

Why references:
- A saved alert can expire before the render. Resolving at play time skips it, so a
  dead warning never airs.
- The UI never needs the worker to add a clip. It writes a target string.
- The look is not baked in. A script plays in its format's current look.

Clip start times are derived from order and duration, never stored (`clipStarts`,
`scriptDurationMs`, `clipAt`). A play record (`playFor(script, sceneId)`) holds the
schedule that really played, the clips skipped and why, and whether it finished or was
stopped. The API sanitiser never accepts play records.

## 3. Script mode in the director

`DirectorMode` is `"off" | "auto" | "script"`. A scene plays a script when its director
config has `mode: "script"` and

```ts
script: { scriptId: string; fromClip: number; playNonce: number; record: boolean };
```

A new `playNonce` starts a play; `mode: "off"` stops it. This is the same Mongo-polled
pattern as `skipNonce`, so the admin UI and the worker's render job start a play the
same way.

The runner (`worker/src/director/script-runner.ts`):
- runs on its own 250 ms timer, so a script never waits behind the auto loop's pool
  builds;
- resolves every clip up front, drops the ones whose subject is gone, and records why;
- cuts on an absolute schedule, so lateness never accumulates;
- cuts through `performCut`, the same path the live director uses;
- ends by standing the scene down, setting the mode back to `off` and stamping the
  play record;
- writes no as-run log when `record` is false, so previews don't fill `/admin/runs`;
- does not replay after a worker restart: the stored play record holds the nonce.

Operator screens (`/control`, the director panel, the scene settings chip) show
"Playing a script" with a Stop.

## 4. The lineup template

One template, `buildLineup` in `worker/src/director/script-template.ts`. A scope and
three include switches give every variant.

**The opener, by scope.**

| Scope | Opening clip | What it carries |
|---|---|---|
| country | `country:<id>` | the national tour and the country deck |
| area | `region:<id>` | a tour of the area's top countries and the region deck |
| globe | `global:roundup` | the world round-up spin: the narrative and its hotspot stops |

- A scripted tour spreads its stops evenly across the clip, at least 8 s a stop. The
  live channel parks 40 s on each.
- A one-country area (the UK, a US band) has no tour. It airs as one framed shot.

**Round-up only** (no include switch on) is the default and the first release:
- The video is the opener, leading with the round-up, then a short closing wide shot.
- The opener runs as long as the round-up takes to read at the format's reading pace.
  The budget never cuts a round-up short.
- A place with no round-up, or a globe with no fresh world round-up, is an error with
  a reason, not a video.

**With events** (switches on):

| Kind | What counts as active | In a country | In an area | Globe |
|---|---|---|---|---|
| alerts | active, at or above `minAlertSeverity`, with a polygon | `alertCountryCode` matches | matches a member country | all |
| quakes | inside the 48 hour live window, at or above `minQuakeMag` | inside the country polygon, or offshore inside its bbox and in no other country | inside the region bbox | all |
| volcanoes | erupting or in unrest | same test as quakes | inside the region bbox | all |

- The opener takes about 40% of the budget, events fill the rest, and any budget left
  goes back to the opener.
- Events are ranked by the director's own scores. The best of each included kind goes
  in first, then the rest, one per hazard type before a second of the same type.
- Area and globe videos take at most three alerts per country.
- The budget is the only limit on how many.
- Regions are bbox-only, so an area's quakes and volcanoes can include a neighbour's
  near the edge.

**Several places in one video** (`places` scope, the main areas round-up):
- One clip per place, in the order given. Each is that place's opener: its tour, with
  its round-up leading, as long as the round-up takes to read.
- The list mixes countries and areas. "USA" and "Australia" are countries; "Europe",
  "Asia", "Africa" and "South America" are areas.
- A place with no round-up is left out and named in the result. With none left, it is
  an error.
- It closes on a world spin.
- It is round-up only. The event switches don't apply to it yet.
- The as-run chapters give the video one YouTube chapter per place, with no extra work.
- Each place writes its round-up at its own local hours, so some are hours older than
  others when the video is made. The schedule's freshness rule covers this (§8).

Default budget is 75 s. No narration yet: the music bed plays, and the presenter comes
later ([presenter-plan.md](./presenter-plan.md)).

## 5. Formats: a short's own settings

Today every short plays on one seeded scene, `shorts`, and previews on a second,
`shorts-preview`. That gives one look for every video, two scenes to keep in step, and
nowhere to put settings that only a short has.

### 5.1 Duplicated, not bound

A **format** is a named kind of short video: "Country round-up", "World round-up",
later "Portrait alert". It owns everything that decides how its videos look and what
goes in them. A script or a schedule picks one.

- A format is made by **duplicating** a channel or another format. The copy is
  complete, and there is no link back. Changing the channel later changes nothing in
  the format.
- **Copy look from…** re-copies on demand, after a confirm. It is the only way a
  channel's later changes reach a format.
- Binding a short to a channel was the alternative. It was rejected because shorts will
  go their own way: portrait layout, different chrome, different pacing. A shared
  setting would have to be right for both.

### 5.2 What a format owns

**Its own scene.** A hidden scene document and director config, created by the
duplicate. That is the on-air look, and every channel setting that applies to a short
works on it unchanged:

| Applies as it is | Not used by a short |
|---|---|
| on-air widgets, report content, deck slides, crawl | director kinds, weights and favourites (the script picks the content) |
| theme, camera idle motion, music bed, reading pace | stream slots and chat |
| about card, YouTube description and thumbnail | |
| look per shot type, transition time, alert and quake thresholds | |

**Its short settings.** A new document, keyed by the same id:

```ts
// shared/src/short-format.ts
export interface ShortFormat {
  /** Also the id of the scene this format owns. */
  id: string;
  name: string;
  /** What Generate starts from. A request can override any of it. */
  template: { scope?: ShortScope; include: ShortInclude; budgetMs: number };
  opener: {
    /** Open the deck on the round-up. */
    leadWithRoundup: boolean;
    /** Fly the tour, or hold one framed shot. */
    tour: boolean;
    minTourDwellMs: number;
  };
  close: { enabled: boolean; ms: number };
  /** "{place} round-up · {date}". Resolved at generate into the script's title,
   *  which becomes the video's title. */
  titlePattern: string;
  /** What the render form and schedules start from. */
  render: { encoderId?: string; accountId?: string; privacy: YoutubePrivacy };
  /** "portrait" arrives with phase 2. */
  layout: "landscape";
}
```

This is where shorts diverge. Later additions land here without touching channels:
intro and outro cards, captions, a narration voice, a sponsor slot.

**A scene marker.** `SceneMeta.kind: "channel" | "short"`, persisted on the scene
document. Format scenes are `short` and hidden. `/admin/scenes`, the stream form and
the slot form list channels only. `/admin/shorts` lists formats.

### 5.3 Where a short plays

On its format's own scene, for both preview and render. So the preview is exactly what
renders, and `shorts-preview` is retired.

- One play per format at a time.
- A render owns its format while it runs. Preview Play is refused, with the reason.
- A scheduled render that fires during a preview takes over. The preview pane then
  shows the render.

### 5.4 How the rest uses a format

- **Generate** takes `formatId`. Scope, switches and budget default from the format's
  template. Thresholds, holds and reading pace come from its scene. `opener`, `close`
  and `titlePattern` shape the script.
- **Scripts** store `formatId`. A script with none uses the default format.
- **Render** (§6) runs on the format's scene and starts from its render defaults.
- **Schedules** (§8) carry `formatId`.
- A script is not a snapshot of the look. Change a format and its existing scripts
  play in the new look next time.

### 5.5 The format editor

`/admin/shorts/formats/:id`, plus a Formats section on `/admin/shorts` (list, New
format, Duplicate, Delete).

- **New format:** a name and "duplicate from" (any channel or format). From a channel
  the short settings start at defaults. From a format they are copied too.
- **One Save.** The scene settings draft already owns two documents (look and
  director). It gains a third, the short settings, and still saves once.
- **Its own card list**, separate from the channel page's, so the two can diverge. The
  card components are shared. A card that needs to differ for shorts is forked at that
  point, not before.

| Group | Cards |
|---|---|
| Video | Template · Opener and close · Title · Render defaults |
| Layout | On-air widgets · Report · Deck slides · Crawl |
| Presentation | Theme · Camera · Music bed · Reading pace · Looks and thresholds |
| Identity | About card · YouTube |

- **Looks and thresholds** is new on a settings page: transition time, look per shot
  type, minimum alert severity and quake magnitude. Those live on `/control` for
  channels. Reuse that panel's sections.
- **Docked preview.** The format's `/watch` page beside the cards, with Play sample:
  it plays the format's most recent script, or generates one. It shows saved settings;
  staged edits appear after Save.
- **Delete** refuses while scripts or schedules use the format, and says how many. The
  default format can't be deleted.

### 5.6 Moving what's built

- The seed creates the default format on scene `shorts` and stops creating
  `shorts-preview`. An existing `shorts-preview` is left alone, to delete from
  `/admin/scenes`.
- `generate`'s `sceneId` becomes `formatId`.
- `/api/shorts/:id/play` and `/api/shorts/stop` act on the script's format scene.
- The `/admin/jobs` button becomes "Seed default short format".

## 6. Render

Three ways to get a video out:

| Option | What it is | Cost |
|---|---|---|
| C. Bounded live run | Go live on a chosen encoder with the format's scene, play the script, end the run. The YouTube VOD is the video. | Small. Reuses `goLive`, `finishRun`, the thumbnail, chapters and the as-run pages. |
| A. OBS record | `StartRecord` on an encoder, no broadcast, then upload the file. | New OBS calls, a way to get the file off gds1, an upload step. |
| B. Playwright | Headless Chrome records the format's `/watch` page. | webm needs ffmpeg; headless WebGL may render in software. |

**Phase 1 is C.** It needs no new infrastructure. A VOD has a few seconds of slop at
the head and tail that the API can't trim, and a live VOD is not a Short. **Phase 2 is
A**, because Shorts need an uploaded portrait file (§10). B is dropped.

### 6.1 The render form

One dialog, opened from a script's Render button and from a schedule (§8). It starts
from the format's render defaults.

- **Encoder:** the operator picks it. The picker shows what each one is doing (§6.2).
- **YouTube channel:** the same connected-account select the streams form uses. Shorts
  go on the same channel as the live streams unless another is picked.
- **Publish as:** public, unlisted or private. Default unlisted. It is applied when the
  run ends (§6.3).
- **Mode:** *Offline test* (§7) or *Live*.
- **When:** *Now*, or *At* a date and time. Repeating runs live on schedules (§8).

### 6.2 "This encoder is in use"

Today the form's encoder select is a bare list and the busy check only fires on submit.
Add a pure helper `encoderOccupancy(encoders, runs, slots, schedules, now)` in `shared`,
returned per encoder by the `/api/streams` snapshot:

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

### 6.3 What YouTube sees

- **The video is the VOD of a short live broadcast.** It carries a "Streamed live" label,
  and YouTube files it with the channel's past live streams, not its uploads. A true
  upload needs a recorded file (phase 2).
- **Going live in public pings subscribers** with "is live now" for a stream that ends
  two minutes later. So a render always streams **unlisted**, and the chosen privacy is
  applied when it ends. A public video then appears finished, with no live blip.
- **The VOD starts when the broadcast goes live.** The script starts 3 s after that and
  the run ends 5 s after the script does, so nothing is clipped. Those few seconds show
  the format's idle globe.
- **Title:** the script's title. **Description and thumbnail:** the format's YouTube
  card, the same one a channel has.
- **Chapters:** the existing as-run chapter job writes them when the run ends. YouTube
  shows chapters only with three or more, so they appear on the main areas video and
  not on a single-place one.
- **Quota:** about 400 units a video (create, bind, two transitions, thumbnail,
  description, privacy), of 10,000 a day.
- Chat is off and nothing is announced.

### 6.4 Changes the run pipeline needs

- **`Run.script?: { scriptId; scheduleId?; offline; publishAs; playNonce? }`**, added
  to the run model. `publishAs` is the privacy to apply at the end.
- **The encoder shows its own scene, not the run's.** `provisionEncoderScene(encoderId)`
  resolves the scene from the encoder's binding. Give it a `sceneId` override, pass the
  script's scene for script runs, and re-provision the encoder's own scene when the run
  finishes or fails.
- **The busy guard only counts YouTube runs.** `activeRunForEncoder` and
  `encoderBusyWith` must also count runs with `script` set.
- **Unreachable OBS is a failure here.** For a live channel it is a manual handoff: the
  run waits for an operator to paste the key. Nobody is watching a scheduled render, so
  a script run that isn't live within 2 minutes fails.
- **A failed render leaves nothing behind.** It stops OBS, deletes the broadcast that
  never went live (`deleteBroadcast` exists) so the channel has no phantom "upcoming"
  event, and restores the encoder's scene.
- **Which scene a script plays on** comes from one helper, `sceneIdForScript(script)`:
  the script's format when formats are in, `shorts` until then. Render never names a
  scene itself, so it can be built on either side of the formats merge.

### 6.5 The choreography

No job sits waiting for the video to finish. The steps are chained by small hooks, with
the state in Mongo, so a worker restart can't strand a render. They live in one new
file, `worker/src/stream/script-run.ts`.

1. **`short-video.render`** (a short job). Refuse, with a reason, if the encoder is busy,
   the script's scene is already rendering, or the script resolves to no clips.
   Otherwise create the `Run` (title from the script, privacy unlisted, `durationMs` as
   a safety cap of script length plus two minutes) and call `goLive`. The job ends here.
2. **On live.** `transitionToLive` calls `onScriptRunLive(run)`, which starts the script
   on its scene after the 3 s lead-in, with `record: true`, and stores the nonce on the
   run.
3. **On script end.** The runner calls `onScriptPlayEnded(sceneId, play)`. It finds the
   run by scene and nonce. A finished play ends the run after the 5 s lead-out
   (`finishRun(runId, "auto")`), then applies `publishAs`. A stopped play fails it.
4. **Deadline.** The run's monitor tick fails a script run still waiting for ingest
   after 2 minutes.
5. **Restart.** `rearmLiveRuns` already restores monitors at boot. For a live script run
   whose play was cut short by the restart, it ends the run and marks it failed. The
   safety cap ends anything else.

`/admin/streams/:id` already shows the result, joined by scene and time window. The
script's row on `/admin/shorts` lists its renders: status, reason if failed, and the
YouTube link.

## 7. Offline test

The same render with YouTube switched off. It is the same job and the same code path,
so a pass means something.

1. **Preflight report**, no side effects:
   - clips resolved and clips skipped, each with its reason;
   - total length against the budget;
   - encoder reachable (`probe`);
   - the chosen YouTube account usable (no stamped `authError`, quota not blocked).
     Read from what the worker already records, with no API call.
2. **Rehearsal.** A `Run` with `script.offline: true`. In `goLive` that branch points
   the encoder's browser source at the format's `/watch` page and marks the run live.
   It creates no broadcast, sets no stream key and never calls `StartStream`.
3. **Evidence.** One screenshot per clip, taken from OBS itself (`GetSourceScreenshot`,
   a new call in `obs/client.ts`) at the clip's midpoint. They show against the clips
   and on the run page. This is what a browser preview can't prove: OBS has had missing
   fonts, software rendering and blur problems before.
4. **Finish.** The encoder goes back to its own scene.

The operator can watch a rehearsal live in the preview pane, because every browser on
the format's `/watch` page sees the same cuts OBS does.

Screenshots go in a new blob namespace (add it to `BLOB_NAMESPACES`), keeping only the
latest test per script.

A test that also exercises YouTube is *Live* mode with privacy set to private.

## 8. Scheduling

```ts
// shared/src/short-schedule.ts
export interface ShortSchedule {
  id: string;
  name: string;
  enabled: boolean;
  formatId: string;
  what:
    | { type: "script"; scriptId: string }
    | {
        type: "template";
        /** A fixed scope, or "auto": pick the country or area with the most going on. */
        scope: ShortScope | { type: "auto"; of: "country" | "area" };
        /** Absent = the format's switches. */
        include?: ShortInclude;
      };
  /** How fresh the round-up must be, and what to do when it isn't. */
  roundup: { maxAgeHours: number; ifStale: "refresh" | "skip" };
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
  fresh script each time, because yesterday's round-up and alerts are gone. "Every
  morning, the world round-up" is one repeating schedule.
- **`auto` scope:** the country or area with the highest summed event score, skipping
  any made in the last few runs.
- **`skipIfQuiet`:** with no active event in scope, the run is recorded as `skipped`
  and nothing renders. It only applies with an include switch on.
- **Freshness.** Round-ups are written on their own schedule, at each place's local
  hours (the Schedule card on the round-up pages). A video made from a stale one is
  yesterday's news. So each schedule says how old a round-up may be (default 12 h) and
  what to do otherwise: `refresh` writes a new one for that place first (one LLM call),
  `skip` records the run as skipped. The place round-up job needs a single-place entry
  point for `refresh`. For a `places` scope the rule applies per place.
- The schedule form shows when each place's round-up is next written, so the operator
  can put the video after it.
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
- **Fire order.** Check the encoder, check freshness (refresh or skip), generate a
  script from the format's template, then enqueue `render`.
- **UI:** a Schedules section on `/admin/shorts`. It lists next run, last outcome and
  an enable switch, and edits through the render form plus a repeat picker (days, time,
  timezone). Bookings feed the encoder picker's "booked" state.

### 8.1 Walkthrough: the Europe round-up, every day

Once, by an operator:
1. Switch round-ups on for Europe at `/admin/place-roundups`, written at 06:00.
2. Have a format for it (the default one will do).
3. Add a schedule: area Europe, every day at 07:00 London time, an encoder that is
   free at that hour, publish as public, round-up no older than 12 h, refresh if stale.
4. Press Render now once, as unlisted, and watch the result.

Every day at 07:00:
1. The ticker finds the schedule due and the encoder free.
2. Europe's round-up is an hour old, so it is used as it is.
3. A script is generated: the Europe tour with the round-up leading, then a wide shot.
4. The run goes live unlisted. The script plays. The run ends.
5. The video is set public. The schedule records the run and its link.

What can go wrong, and what the schedule records:

| Problem | Outcome |
|---|---|
| Worker down at 07:00, back by 07:10 | runs late |
| Worker down past 07:10 | `missed` |
| Encoder busy past 07:10 | `missed: encoder busy` |
| No round-up and the refresh fails | `failed`, with the generator's reason |
| OBS unreachable, or no ingest in 2 minutes | `failed`; broadcast deleted |
| YouTube quota spent or sign-in expired | `refused`, before anything is created |

The UK video is the same schedule with country `uk`. The main areas video is the same
with the six places.

## 9. Timeline editor (milestone 2)

`/admin/shorts/:id`. A round-up video is two clips, so the timeline waits until event
clips are switched on in the UI.

One track of clips:
- **Track:** blocks with width proportional to duration. Drag to reorder, drag the
  right edge to resize, duplicate, delete. Total length and budget shown above.
- **Add clip:** a picker by kind, filtered to the script's scope by default.
- **Inspector:** duration, look override, `maxStops` and tour dwell for the selected
  clip.
- **Preview:** the format's `/watch` page. "Play from here" starts the script at the
  selected clip. The playhead follows `director:state`.
- **Minimum duration:** a clip under the time its deck needs shows a warning, not a
  block. This is the open shot-budget problem from deck-scroll-pacing-plan.
- **Stale clips:** a clip whose subject is no longer in Mongo is flagged in place.
- **Regenerate:** rebuild from the template, after a confirm.
- **Save:** staged edits and one Save.

No free scrubbing. The director only runs forward, so "play from clip N" is the honest
preview.

Later tracks, added only when a template needs them: captions, audio mood, narration,
sponsor slot.

## 10. Phase 2: Shorts (portrait)

The 16:9 on-air chrome can't be squeezed into 9:16. Phase 2 builds a new on-air UI,
and a portrait short is a **format** with `layout: "portrait"`.

- **A new portrait surface.** `WatchSurfacePortrait`, chosen by the format's layout.
  The URL stays `/watch/:scene`, so OBS provisioning and the preview don't change.
  Designed at 1080x1920:
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
- **Length.** The world round-up runs about 130 s, inside the three minute Shorts
  limit. Portrait formats get a shorter default budget.

Phase 2 gets its own plan when milestone 1 is in. Recorded files also remove the head
and tail slop from landscape videos, so the live-run render can then be retired.

## 11. Work packages

Each is one Opus sub-agent, or two in parallel where the files don't overlap. When two
run together, `shared/` is frozen for both and neither runs `./update-shared`. After
any `shared/src` edit run `./update-shared`. Every package ends with `./test` green.
The worker needs a restart by the user after WP5, WP7 and WP9.

**Milestone 1: the three round-up videos, on YouTube, on a schedule.**

| WP | Scope | Depends on | Done when |
|---|---|---|---|
| 1-4 (done) | Shared contract, director refactors, runner and template, on-air and operator screens, `/admin/shorts`, admin jobs | | round-ups generate and preview |
| 5 (cloud agent) | Formats, shared and worker (§5.2-5.4, §5.6) | 4 | a second format made from a channel generates and plays in its own look |
| 6 (cloud agent) | Formats, public: the format editor (§5.5) | 5 | an operator duplicates a channel into a format, changes it, saves once and sees the preview change |
| 7a | Render core, shared and worker: `Run.script`, `sceneIdForScript`, provision override and restore, busy guard, `script-run.ts` hooks, deadline, failure clean-up, publish at end, `render` job, `encoderOccupancy` (§6.3-6.5) | 4 | tests cover live, script end, a stopped play, the deadline, a restart and every clean-up path |
| 7b | Render UI: Render button and form, `EncoderSelect`, a script's renders with status and link (§6.1-6.2) | 7a | **a round-up is on YouTube**, made from `/admin/shorts` |
| 9a | Scheduling core, shared and worker: `ShortSchedule`, `nextFireAt`, `tick` job, the freshness rule and single-place round-up refresh, fire order (§8) | 7a | tests cover due, late, missed, busy, stale and skipped |
| 9b | Schedules UI on `/admin/shorts` | 9a, 7b | **the Europe and UK round-ups publish daily** |
| 10 | Several places in one video: the `places` scope through sanitiser, template, titles, generate form (§4) | 6 | **the main areas round-up publishes daily**, with a chapter per place |
| 8 | Offline test: offline branch in `goLive`, preflight report, OBS screenshots (§7) | 7a | a test holds the encoder, never contacts YouTube, and leaves a screenshot per clip |

How this runs beside the cloud agent:
- WP7 and WP9 mostly touch `worker/src/stream/`, the run model and new files. Formats
  touch the script model, the template, the generate job and the `/admin/shorts`
  components. The overlap is `/admin/shorts` and `jobs/short-video.ts`, where both add.
- WP7a can start now. WP7b and WP9b add sections to a page the format work is
  restructuring, so they go in after the formats branch merges, or expect a merge.
- WP10 edits the same template and form files as formats. It waits for the merge.

**Milestone 2: event clips and the timeline editor.**

| WP | Scope | Depends on | Done when |
|---|---|---|---|
| 11 | The alert, quake and volcano switches in the UI; the read-only timeline with "play from here" (§9) | 6 | a lineup with events plays from any clip |
| 12 | Editing: reorder, resize, add, delete, inspector, floors, stale flags, Save | 11 | edits persist and the next play uses them |

**Phase 2: Shorts (§10).** Its own plan once milestone 1 is in.

## 12. Decisions

Taken (change here if wrong):
- A short has its own settings, duplicated from a channel, never bound to one.
- A format is the unit of customisation. A script has no look of its own beyond a
  per-clip look override.
- Preview and render play on the format's own scene.
- The operator picks the encoder. Nothing is pre-empted.
- Same YouTube channel as the live streams, through the existing account picker.
- "Offline test" means a full rehearsal on the chosen encoder with no YouTube.
- Missed schedules are skipped after 10 minutes, not caught up.
- Default budget 75 s, default privacy unlisted.
- Round-up videos ship first. Event clips and the timeline editor follow scheduling.
- In a scripted round-up the round-up slide leads the deck, ahead of the lede card.
- A render streams unlisted and takes its real privacy when it ends.
- A render that can't go live in 2 minutes fails and deletes its broadcast.
- Render is chained by hooks with state in Mongo, not by a job that waits.
- A schedule refuses a stale round-up: refresh it or skip the day.

Open:
- Which encoder renders scheduled videos? It must be free at that hour, and the
  always-on slots hold theirs. This needs a spare OBS instance on gds1.
- What time, and public or unlisted, for the daily Europe, UK and main areas videos?
- Main areas: are USA and Australia the countries, or North America and Oceania the
  areas? Does the world round-up open the video?
- Main areas: the full round-up for each place (5-8 minutes in all) or the summary
  only (about 2)?
- Which settings matter first on the Video cards, beyond the list in §5.2?
- Should a channel's later look changes ever flow to a format automatically? The plan
  says no: only Copy look from.
- Phase 2: how does a file recorded by OBS on gds1 reach the worker?
