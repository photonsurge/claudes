# Scripted short videos — plan

> **Status: IN PROGRESS** (2026-10-04). WP1-4 are built and green: round-up scripts
> generate and preview on `/admin/shorts`, and it has run against local data. Two
> tracks follow: **formats** (§5, WP5-6, a cloud agent) and **getting a video onto
> YouTube on a schedule** (§6 and §8, WP7 and WP9). Planned on Fable, built by Opus sub-agents, one
> work package at a time (§11).
> WP5 (formats, shared and worker) is built: `db.shortFormats`, scene `kind`, duplicate and
> copy-look helpers, `/api/shorts/formats`, generate by `formatId`, round-up depth.
> WP6 (formats, public) is built: the Formats section on `/admin/shorts` and the editor at
> `/admin/shorts/formats/:id` — its own card list, one Save for look, director and short
> settings, the YouTube video card with the token picker and preview, Play sample, Copy look from.
> WP10 (several places) is built: the `places` scope through sanitiser, template, values, render-queue
> freshness and chapters, with the ordered place list (and "Main areas" quick-fill) on Generate and the format's Template card.
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
| Main areas round-up | area `europe`, country `usa`, area `asia`, country `australia`, area `africa`, area `south_america`, one after another | 5-8 min |

`usa` and `australia` are countries, not areas: there is no `usa` or `australia` in
`REGION_SHOTS` (the US is split into bands, Australia sits in `oceania`). `uk` is both a
country and an area; the UK video uses the country, whose round-up is keyed `gb`.

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
  /** How much of the round-up the panel shows (§4). To add in WP5. */
  roundupDepth?: "summary" | "full";
  /** Cached for the UI; it is what will air. */
  label: { title: string; subtitle?: string; icon?: string };
}

export type ShortPlace =
  | { type: "country"; id: string }   // a COUNTRY_SHOTS id
  | { type: "area"; id: string };     // a REGION_SHOTS id

export type ShortScope =
  | ShortPlace
  | { type: "globe" }
  /** Several places in one video, in this order (§4). Built in WP10: the
   *  sanitiser keeps catalog ids only, deduped, at most MAX_SHORT_PLACES (12). */
  | { type: "places"; places: ShortPlace[] };

export interface ShortInclude { alerts: boolean; quakes: boolean; volcanoes: boolean }

export interface ShortScript {
  id: string;
  /** The format this video is made in (§5). To add in WP5. */
  formatId: string;
  template: "lineup";
  scope: ShortScope;
  include: ShortInclude;
  /** A working title for the admin list. The video's title comes from the format. */
  title: string;
  /** Values for the title codes, stamped at generate (§6.8). To add in WP7a. */
  values?: Record<string, string>;
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
- **Depth (not built yet, WP5).** `summary` shows and times only the round-up's summary.
  `full` shows all of it: summary, state of play, city outlooks and advice. The clip
  carries the depth to the on-air panel (`ShortClip.roundupDepth`,
  `Segment.roundupDepth`), and the opener's length follows from what is shown. Today
  there is no depth: `roundupText` in `script-template.ts` times the whole round-up,
  which is `full`.
- **Freshness is not checked at generate.** The place opener takes
  `latestForPlace(...)` whatever its age. Only the schedule's rule (§8) guards against
  a stale round-up, so a manual Generate or Render now can air an old one. The
  generate form should show the round-up's age and warn past the format's limit.

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
- The operator picks the places and their order. The list can mix countries and areas
  freely: USA the country or North America the area, Australia or Oceania.
- How much of each round-up is shown is a format setting: the summary only (about two
  minutes for six places) or the full round-up (five to eight).
- The world round-up can open the video. That is a format setting too, off by default.
- A place with no round-up is left out and named in the result. With none left, it is
  an error.
- It closes on a world spin.
- It is round-up only. The event switches don't apply to it yet (they are ignored).
- The as-run chapters give the video one YouTube chapter per place. A video render's
  chapter labels drop the shot's caption, so each reads as the place ("🇺🇸 United
  States"); the closing spin is under YouTube's 10 s floor and drops out.
- Built (WP10): generate returns the places it left out (`skipped`), and the Generate
  form names them. Title codes: `%{place}` is the names joined with ", ",
  `%{placeId}` the scope's place ids joined with `-` (stable when a place is left
  out), `%{places}` the count, `%{flag}` and `%{headline}` empty, `%{asOf}` the
  oldest round-up's time in London. The render queue's freshness rule checks every
  place: under `refresh` each stale place is rewritten; under `skip` a stale place is
  left out and named, and the video is skipped only when no place is left.
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
| about card | the channel YouTube card (a format has its own, §6.8) |
| look per shot type, transition time, alert and quake thresholds | |

**Its short settings.** A new document, keyed by the same id:

```ts
// shared/src/short-format.ts
export interface ShortFormat {
  /** Also the id of the scene this format owns. */
  id: string;
  name: string;
  /** What Generate starts from. A request can override any of it. */
  template: {
    scope?: ShortScope;
    include: ShortInclude;
    budgetMs: number;
    /** Several places: open on the world round-up before the first place. */
    openWithWorld: boolean;
  };
  opener: {
    /** Open the deck on the round-up. */
    leadWithRoundup: boolean;
    /** How much of a place round-up is shown: its summary, or all of it. */
    roundupDepth: "summary" | "full";
    /** Fly the tour, or hold one framed shot. */
    tour: boolean;
    minTourDwellMs: number;
    /** With events on: the opener's share of the budget (0.4). */
    budgetShare: number;
  };
  close: { enabled: boolean; ms: number };
  /** Everything YouTube is told about the video (§6.8). Templates take the date
   *  codes the live titles use, plus the video's own values. */
  video: {
    title: string;              // "%{place} round-up · %A %e %B"
    description: string;
    /** Zone the date codes resolve in: an IANA zone, or "place" for the video's
     *  own place. Default "Europe/London", as live titles. */
    timezone: string;
    thumbnail: { source: "image"; url: string } | { source: "frame"; atMs: number };
    tags: string[];
    categoryId: string;
    playlistId?: string;
    publishAs: YoutubePrivacy;
    chapters: boolean;
  };
  /** Timing around the script inside the broadcast. */
  timing: { leadInMs: number; leadOutMs: number };
  /** What the render form and schedules start from. */
  render: { encoderId?: string; accountId?: string };
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
  template. Thresholds, holds and reading pace come from its scene. `opener` and
  `close` shape the script. Generate also stamps the script's values for the title
  codes (§6.8).
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
| Video | Template · Opener and close · YouTube video · Timing · Render defaults |
| Layout | On-air widgets · Report · Deck slides · Crawl |
| Presentation | Theme · Camera · Music bed · Reading pace · Looks and thresholds |
| Identity | About card |

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

- **Encoder:** the operator picks it. Encoders assigned to videos (§6.6) come first and
  the first of them is preselected. The picker shows what each one is doing (§6.2).
- **YouTube channel:** the same connected-account select the streams form uses. Shorts
  go on the same channel as the live streams unless another is picked.
- **Publish as:** public, unlisted or private. It starts from the format's setting and
  is applied when the run ends (§6.3).
- **Title:** shown resolved, from the format's template. It can be changed for this one
  video (§6.8).
- **Mode:** *Offline test* (§7) or *Live*.
- **When:** *Now*, or *At* a date and time. Repeating runs live on schedules (§8).
  Either way the video joins that encoder's queue (§6.6). It doesn't have to wait for
  the encoder to be free.

### 6.2 "This encoder is in use"

Today the form's encoder select is a bare list and the busy check only fires on submit.
Add a pure helper `encoderOccupancy(encoders, runs, slots, schedules, now)` in `shared`,
returned per encoder by the `/api/streams` snapshot:

| State | Shown as |
|---|---|
| free | "free" |
| live | "live: Main channel, since 14:02" plus "until 14:32" when the run is bounded |
| held | "held by always-on slot Main". An enabled slot owns its encoder even between runs |
| rendering | "rendering: Europe round-up, 2 more queued" |
| booked | "free, batch booked 18:00" for the next schedule within 24 hours |
| disabled | greyed out |

A new `EncoderSelect` component renders it and replaces the bare select on
`/admin/streams` too. A live or held encoder can't be chosen for a video. A rendering
one can: the video queues behind it. The form is advisory; the queue checks again when
the video reaches the front.

### 6.3 What YouTube sees

- **The video is the VOD of a short live broadcast.** It carries a "Streamed live" label,
  and YouTube files it with the channel's past live streams, not its uploads. A true
  upload needs a recorded file (phase 2).
- **Going live in public pings subscribers** with "is live now" for a stream that ends
  two minutes later. So a render always streams **unlisted**, and the chosen privacy is
  applied when it ends. A public video then appears finished, with no live blip.
- **The VOD starts when the broadcast goes live.** The script starts 3 s after that and
  the run ends 5 s after the script does, so nothing is clipped. Those few seconds show
  the format's idle globe. Both are format settings.
- **Title, description, thumbnail, tags, category, playlist:** all from the format's
  YouTube video card (§6.8).
- **Chapters:** the existing as-run chapter job writes them when the run ends, if the
  format has them on. YouTube shows chapters only with three or more, so they appear on
  the main areas video and not on a single-place one.
- **Quota:** about 400 units a video (create, bind, two transitions, thumbnail,
  description, privacy), of 10,000 a day.
- **No chat.** A video is not a live show, even though it is made through a broadcast.
  This reuses the chat switch live runs already have (`Run.chat`, the Chat toggle on
  the streams form and slots): the queue creates every render's run with
  `chat: { enabled: false, promoteToTicker: false }`, and the Render form doesn't offer
  the toggle. So the worker never polls or posts to chat, and chat commands can't steer
  the director. Nothing is announced (`announce` off, no
  hydra post). That switch only covers our side. It doesn't turn off YouTube's own chat
  on the broadcast, so a video may still show a chat replay. Turn that off on the
  broadcast if the API allows it, otherwise in YouTube Studio's live defaults for the
  account. Check this on the first render.

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

1. **Start.** When a video reaches the front of its encoder's queue (§6.6), the queue
   creates the `Run` (title and description resolved from the format, §6.8; privacy unlisted, `durationMs` as a safety
   cap of script length plus two minutes) and calls `goLive`.
2. **On live.** `transitionToLive` calls `onScriptRunLive(run)`, which starts the script
   on its scene after the 3 s lead-in, with `record: true`, and stores the nonce on the
   run. An offline run (§7) never reaches `transitionToLive`: `goLive`'s no-YouTube
   branch sets it live directly, so that branch must call `onScriptRunLive` too.
3. **On script end.** The runner calls `onScriptPlayEnded(sceneId, play)`. It finds the
   run by scene and nonce. A finished play ends the run after the 5 s lead-out
   (`finishRun(runId, "auto")`), then applies `publishAs`. A stopped play fails it.
4. **Deadline.** The run's monitor tick fails a script run still waiting for ingest
   after 2 minutes.
5. **Restart.** `rearmLiveRuns` already restores monitors at boot. For a live script run
   whose play was cut short by the restart, it ends the run and marks it failed. The
   safety cap ends anything else.
6. **Next.** When a run ends or fails, the queue records the result and starts the next
   video on that encoder.

`/admin/streams/:id` already shows the result, joined by scene and time window.

### 6.6 An OBS assigned to videos, and the render queue

**Assigning.** An encoder gets a use: `channels` (today's behaviour) or `videos`. It is
set on the encoders card on `/admin/streams`, where encoders are registered.
- A video encoder is not bound to a channel. Its browser source is pointed at each
  video's scene as that video starts.
- The channel go-live form and the slot form don't offer it, so a channel can't take
  it by accident.
- The operator still chooses. The form and each schedule pick a named video encoder or
  **Any video encoder**. A free channel encoder can be chosen too, with a warning.
- Three OBS instances on gds1 are available for this.

**The queue.** One OBS instance makes one video at a time, so each encoder has a queue
and works through it in order. This is what makes a batch possible: three videos due
at 07:00 run back to back on the assigned OBS.

With several video encoders, a video queued for **Any video encoder** goes to whichever
is idle first, so a batch can run side by side. Two limits apply:
- **One video per format at a time.** A format plays on its own scene, so two videos
  in the same format can't render together. They run one after the other even with
  encoders free. A batch only runs in parallel across different formats.
- Each render is another `/watch` page drawing on the encoder host, next to the
  always-on channels. Try three at once on gds1 before relying on it.

```ts
// shared/src/short-render.ts
export interface ShortRender {
  id: string;
  /** A named encoder, or "any" for the first idle video encoder. */
  encoderId: string | "any";
  /** A saved script, or a request to generate one when this reaches the front.
   *  `auto` scope is resolved at the front too, like the rest of generate (§8). */
  what:
    | { type: "script"; scriptId: string }
    | {
        type: "generate";
        formatId: string;
        scope: ShortScope | { type: "auto"; of: "country" | "area" };
        include?: ShortInclude;
      };
  publishAs: YoutubePrivacy;
  offline: boolean;
  /** The YouTube account; absent = the format's render default. */
  accountId?: string;
  /** This video's overrides of the format's YouTube settings: the Render form's
   *  title, or a schedule's `ScheduledVideo.video`. */
  video?: Partial<ShortFormat["video"]>;
  /** How fresh the round-up must be (§8). Checked at the front of the queue. */
  roundup?: { maxAgeHours: number; ifStale: "refresh" | "skip" };
  /** Carried from the schedule; checked at the front with the rest. */
  skipIfQuiet?: boolean;
  scheduleId?: string;
  /** Set when a schedule queued several videos together. */
  batchId?: string;
  status: "queued" | "preparing" | "live" | "done" | "skipped" | "failed" | "cancelled";
  /** Give up if it hasn't started by then. */
  startBy?: number;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  scriptId?: string;
  runId?: string;
  videoUrl?: string;
  note?: string;
}
```

- **Generated at the front, not when queued.** The freshness check, the round-up
  refresh and the script generation happen as the video reaches the front, so the
  third video of a batch isn't made from data that was current when the first started.
- **One failure doesn't stop the batch.** A failed or skipped video is recorded with
  its reason and the queue moves on.
- **`startBy`.** A video still waiting past its `startBy` is marked `skipped: too late`.
  Scheduled videos get the schedule's time plus an hour. Render now has none.
- **Paused.** Each encoder's queue can be paused. A paused queue finishes the video
  that is live and starts nothing new.
- A channel run on the same encoder blocks the queue until it ends. The queue never
  pre-empts it.
- The queue lives in `worker/src/stream/render-queue.ts`. It advances when a video is
  queued, when a run ends, and on the 60 s ticker, so nothing is lost across a restart.

### 6.7 Controls, like the live stream page

A render is a `Run`, so it reuses what `/admin/streams` already has: the status badge,
the OBS and YouTube health readout, the socket updates, End stream, the as-run page.
`/admin/shorts` gets a **Renders** section that reads the same way as the runs list on
the streams page.

| Control | Where | Does |
|---|---|---|
| Render | a script's row; the generate form | queue it on a chosen encoder |
| Run batch now | a schedule's row | queue all its videos now |
| Status | each queue row | queued (position), preparing, awaiting ingest, live with clip 2 of 3 and time left, done, skipped, failed |
| Health | the live row | OBS bitrate and dropped frames, YouTube ingest, the same readout as a channel run |
| Stop | the live row | end this video now; it fails, the queue continues |
| Cancel | a queued row | remove it |
| Retry | a failed or skipped row | queue it again |
| Pause, Resume | the encoder's queue header | hold the queue after the current video |
| Watch, As-run | a done row | the YouTube link; `/admin/streams/:id` |

- The preview pane shows the live render, because it plays on the same scene.
- On `/admin/streams`, video renders are labelled as such and can be filtered out, so
  the channel runs stay readable.
- Recent renders stay listed with their outcome and reason.

### 6.8 Titles and the rest of what YouTube is told

Live broadcasts already take a title template with date codes (`%d`, `%B`, `%H:%M`),
resolved by `formatStreamTitle` in London time. Videos use the same codes and add the
video's own values, written `%{name}`. The existing codes are single letters, so the
braces can't clash with them.

| Code | Value | Example |
|---|---|---|
| `%d` `%B` `%A` `%H` … | every date code a live title takes | `08`, `September`, `Tuesday`, `14` |
| `%{place}` | the scope's name; for several places, the list | `Europe` · `United Kingdom` · `World` |
| `%{places}` | how many places | `6` |
| `%{flag}` | a country's flag | 🇬🇧 |
| `%{kind}` | what the video is | `round-up` · `alerts and earthquakes` |
| `%{format}` | the format's name | `Country round-up` |
| `%{duration}` | the video's length | `1:45` |
| `%{asOf}` | when the round-up was written, local to the place | `06:00` |
| `%{headline}` | the round-up's first sentence | |
| `%{roundup}` | the round-up's text, for descriptions | |
| `%{alerts}` `%{quakes}` `%{volcanoes}` | active counts in the scope | `12` |
| `%{top}` | the top event's on-air title | `Red wind warning` |
| `%{n}` | this schedule's running number | `214` |

- **Time zone is a setting.** Date codes resolve in London time by default, as live
  titles do. A format can name another zone, or "the place's own", so an Australia
  video is dated in Australian time. A video of several places has no single place and
  uses London.
- **One resolver.** `shared/src/video-text.ts`: the code list (name, label, example) and
  `formatVideoText(template, values, date, timezone)`. It handles `%{name}` and the date codes
  in one pass, so a value containing a `%` is never expanded again. `formatStreamTitle`
  keeps its behaviour and shares the date table.
- **Values are stamped on the script** when it is generated (`ShortScript.values`), so
  the editor can preview a title with real values and the render resolves it without
  recomputing anything. `%{duration}` and the date codes are filled at render time.
- **Resolved at render, used as written.** The queue resolves title and description and
  puts them on the run. `goLive` uses them as they are for a script run and does not
  run them through the channel's title template again.
- **Limits.** A title over YouTube's 100 characters is cut at a word with an ellipsis.
  A description over the limit is cut the way live descriptions are. The preview shows
  both before anything is rendered.
- **The same field as live titles.** The title and description fields reuse the token
  picker the stream title field has, with a second group of chips for the video's
  values and a live preview against the format's most recent script.

The **YouTube video** card on a format:

| Setting | Notes |
|---|---|
| Title | template, required |
| Description | template; the site link and chapters are appended as they are for live |
| Time zone for date codes | London by default; another zone, or the place's own |
| Thumbnail | an image (URL or site path, itself a template: `/thumbs/%{place}.png`), or a frame of the video at a set second, taken from OBS during the render |
| Tags | list |
| Category | YouTube category |
| Playlist | add the finished video to it |
| Publish as | public, unlisted or private, applied when the run ends |
| Chapters | on or off |

Tags and category can't be set when a broadcast is created. They go on with the privacy
change at the end, in one `videos.update`. A playlist add is one more call.

A schedule's video can override any of these for itself (`ScheduledVideo.video`), and
the Render form can override the title for a one-off.

### 6.9 Nothing fixed in code

Every number and string in this plan that shapes a video is a setting, with the value
given here as its default. Where each lives:

| On the format | On the schedule | On the deployment |
|---|---|---|
| look, widgets, deck, crawl, theme, music, reading pace | time, days, timezone | go-live deadline (2 min) |
| template: scope (the places and their order), switches, budget, world round-up first | encoder, YouTube channel | safety cap on a run (script length + 2 min) |
| opener: round-up leads, round-up depth, tour, minimum dwell (8 s), opener share (40%) | the videos and their order | ticker interval (60 s) |
| close: on or off, length (6 s) | round-up freshness (14 h), refresh or skip | missed-schedule window (10 min) |
| YouTube video card (above) | start-by window (1 h) | |
| timing: lead-in (3 s), lead-out (5 s) | per-video overrides | |
| render defaults: encoder, YouTube channel | offline test or live | |

The deployment column is env with a default, like the existing `VOD_LEAD_MS`. Those
protect the system and aren't creative choices.

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
/** One video in a schedule's batch. */
export interface ScheduledVideo {
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
  /** Overrides of the format's YouTube video settings for this one video. */
  video?: Partial<ShortFormat["video"]>;
}

/** A time, an encoder, and the videos to make then, in order. */
export interface ShortSchedule {
  id: string;
  name: string;                 // "Morning batch"
  enabled: boolean;
  when:
    | { type: "once"; at: number }
    | { type: "weekly"; days: number[]; time: string; tz: string };  // "07:30", IANA zone
  encoderId: string | "any";
  accountId?: string;
  offline: boolean;
  /** Skip a video not started this long after the schedule's time. Default 1 h. */
  startByMs: number;
  videos: ScheduledVideo[];
  /** Fires so far; the value of `%{n}`. */
  fireCount: number;
  nextAt: number | null;
  lastFire?: { at: number; batchId?: string; outcome: "queued" | "missed"; note?: string };
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
  yesterday's news. So each schedule says how old a round-up may be (default 14 h, §13) and
  what to do otherwise: `refresh` writes a new one for that place first (one LLM call),
  `skip` records the run as skipped. The single-place entry point for `refresh` is
  `refreshPlaceRoundup` in `worker/src/placeRoundups/refresh.ts`. The world round-up
  has no such entry, so a stale globe video with `refresh` fails with a note saying so.
  For a `places` scope the rule applies per place.
- The schedule form shows when each place's round-up is next written, so the operator
  can put the video after it.
- **A schedule is a batch.** It queues its videos, in order, on its encoder (§6.6). The
  daily Europe video alone is a batch of one.
- **One ticker, state in Mongo.** `short-video.tick` is a 60 s repeatable job, the same
  pattern as `stream.reconcile`. It fires every enabled schedule with `nextAt <= now` by
  queuing its videos, then sets the next `nextAt`. A once schedule disables itself.
  Editing a schedule is a Mongo write; nothing touches BullMQ.
- **Missed runs are not caught up.** If a schedule is more than 10 minutes overdue it is
  marked `missed`. The test box is powered off for about three hours every day, and a
  burst of stale videos on boot is worse than a gap.
- **A busy encoder is waited for, never pre-empted.** The videos wait in the queue. One
  that hasn't started within an hour of the schedule's time is skipped as too late.
- **Each video's outcome is on its render**, not on the schedule. The schedule row links
  to its last batch.
- **Render now** and **Run batch now** queue directly, without waiting for the ticker.
- `nextFireAt(when, afterMs)` is a pure helper in `shared`, timezone-aware, with tests
  across both DST changes.
- **Order of work.** The ticker only queues. Freshness, the round-up refresh and the
  script generation happen as each video reaches the front of the queue.
- **UI:** a Schedules section on `/admin/shorts`. It lists next run, last outcome and
  an enable switch, and edits through the render form plus a repeat picker (days, time,
  timezone). Bookings feed the encoder picker's "booked" state.

### 8.1 Walkthrough: the morning batch

Once, by an operator:
1. Assign an OBS instance to videos on `/admin/streams`.
2. Switch country and region round-ups on at `/admin/place-roundups` (the switch is
   per kind, not per place; default slots are 06:00 and 18:00 local).
3. Have a format for each video (the default one will do to start).
4. Add a schedule "Morning batch": every day at 07:00 London time, on the video
   encoder, with three videos in order: Europe, UK, main areas. Each has a round-up no
   older than 14 h, refreshed if stale. Titles, descriptions and public or unlisted come
   from each video's format.
5. Press Run batch now once with everything unlisted, and watch the results. That needs
   a "publish as" override on Run batch now; a schedule otherwise takes privacy from
   each video's format.

Every day at 07:00:
1. The ticker queues the three videos on the video encoder.
2. Europe reaches the front. Its round-up is an hour old, so it is used as it is. A
   script is generated. The run goes live unlisted, the script plays, the run ends, and
   the video is set public.
3. The UK video does the same, then the main areas video. That one refreshes any place
   whose round-up is too old before it generates.
4. The Renders section shows each video's outcome and link. About fifteen minutes
   after 07:00 all three are up.

What can go wrong, and what is recorded:

| Problem | Outcome |
|---|---|
| Worker down at 07:00, back by 07:10 | the batch runs late |
| Worker down past 07:10 | the schedule records `missed` |
| The encoder is busy with something else | the videos wait; any not started by 08:00 is `skipped: too late` |
| No round-up and the refresh fails | that video `failed`, with the generator's reason; the batch continues |
| OBS unreachable, or no ingest in 2 minutes | that video `failed`, its broadcast deleted; the batch continues |
| YouTube quota spent or sign-in expired | that video `failed` before anything is created; the batch continues |

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
| 5 (cloud agent) | Formats, shared and worker (§5.2-5.4, §5.6). Its `ShortFormat` now has `video` and `timing` in place of `titlePattern` and `render.privacy` | 4 | a second format made from a channel generates and plays in its own look |
| 6 (cloud agent) | Formats, public: the format editor (§5.5), including the YouTube video card with the token picker and preview (§6.8) | 5 | an operator duplicates a channel into a format, changes it, saves once and sees the preview change |
| 7-pre | `shared/src/video-text.ts`: the code list and `formatVideoText`, sharing the date table with `formatStreamTitle`; tests (§6.8) | none | every code resolves; a `%` inside a value is left alone; live titles are unchanged |
| 7a | Render core, shared and worker: `Run.script`, `sceneIdForScript`, provision override and restore, busy guard, `script-run.ts` hooks, deadline, failure clean-up, publish at end; encoder `use`; `ShortRender` and `render-queue.ts` (queue, pause, cancel, retry, `startBy`, freshness and generate at the front); values stamped at generate, title and description resolved onto the run, tags, category, playlist and privacy applied at the end; `encoderOccupancy` (§6.3-6.6, §6.8) | 4, 7-pre | tests cover live, script end, a stopped play, the deadline, a restart, every clean-up path, and a three-video queue with one failure |
| 7b | Render UI: assign an encoder to videos on `/admin/streams`; Render form and `EncoderSelect`; the Renders section with the §6.7 controls; renders labelled on the streams page (§6.1-6.2, §6.7) | 7a | **a round-up is on YouTube**, queued, watched and stopped from `/admin/shorts` |
| 9a | Scheduling core, shared and worker: `ShortSchedule` with its batch, `nextFireAt`, `tick` job, single-place round-up refresh (§8) | 7a | tests cover due, late, missed and a batch queued in order |
| 9b | Schedules UI on `/admin/shorts`, with Run batch now | 9a, 7b | **the Europe and UK round-ups publish daily**, as one batch |
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
- An OBS instance can be assigned to videos. The operator still chooses which, or
  "any". Three are available.
- One video per format at a time, whatever encoders are free.
- Videos queue per encoder and run one at a time. A schedule is a batch.
- One failed video doesn't stop a batch.
- Renders get the same controls as channel runs, on `/admin/shorts`.
- Video titles and descriptions use the live titles' date codes plus `%{name}` codes
  for the video's own values.
- A format has its own YouTube video card. It does not use the channel YouTube card.
- Nothing that shapes a video is fixed in code (§6.9).
- A schedule's time is the operator's. Date codes default to London time and can be set
  to another zone or the place's own.
- The places in a several-places video, their order, the round-up depth and whether the
  world round-up opens it are all settings.

Open:
- Which settings matter first on the Video cards, beyond the list in §5.2?
- Should a channel's later look changes ever flow to a format automatically? The plan
  says no: only Copy look from.
- Phase 2: how does a file recorded by OBS on gds1 reach the worker?
- When does the morning batch run, given the quota day resets at 08:00 London (§13)?
- What does an idle video encoder show between videos (§13)?

## 13. Review notes (2026-10-04)

The plan was checked against the code on `singleVideos`. The clear errors are fixed
in place above. This section lists what each work package has to handle and what the
first real render should check.

**YouTube quota at 07:00 London (affects WP9, §8.1).** The quota day resets at
midnight Pacific, which is 08:00 London. A 07:00 batch runs in the last hour of the
quota day, after the always-on live channels' chat polling has spent most of it (the
videos themselves poll no chat, §6.3). The meter keeps
`YOUTUBE_QUOTA_RESERVE` (1,500) for go-live and end, and that reserve is shared with
the live channels' own recycles. Three videos at about 400 units each take 1,200 of it.
Options: schedule the batch after 08:00 London, raise the reserve, or have the queue
check the meter before creating the broadcast. That check is §8.1's "quota spent"
row, made explicit. `playlistItems.insert` is also missing from `BASE_COST` in
`youtube/quota.ts` and needs adding.

**Round-up freshness default (WP9a).** With the default slots of 06:00 and 18:00 local,
a round-up can be about 12 h old just before its next slot, plus up to an hour of
ticker lag. At 07:00 London, Australia's latest round-up is close to that limit, so
a 12 h `maxAgeHours` turns into a daily refresh and an extra LLM call. 14 h covers
every place for the 07:00 batch. Refresh can reuse `runForPlace` in
`jobs/placeRoundups.ts`, which only needs exporting.

**Run pipeline facts the plan relies on (WP7a).**
- `goLive` calls `encoderBusyWith` only when the run has YouTube. Changing
  `activeRunForEncoder` is not enough for offline runs: the guard has to run on the
  no-YouTube branch too.
- `resolveEncoderScene` falls back to the main channel when an encoder has no
  `sceneId`. An encoder assigned to videos is unbound, so "re-provision the encoder's
  own scene" would point it at the main channel's `/watch` page, which keeps a third
  globe drawing on gds1. Give video encoders an idle state (a blank page, or no browser
  source) instead.
- The thumbnail job (`stream/thumbnail.ts`) reads the channel's YouTube settings. The
  format's thumbnail (§6.8) needs a change there, and no work package lists it. A frame
  thumbnail needs `GetSourceScreenshot`, which is WP8. Either move that call into WP7a,
  or ship image thumbnails first and add frames with WP8.
- Chapters are switched on or off for the whole deployment (`YOUTUBE_CHAPTERS`), not per
  format. The chapter job's opening label is the scene name, so the format's hidden
  scene needs a name fit for a video description.
- The chapters job reads the video's snippet and writes it back 30 s after the finish,
  with retries. The end-of-run `videos.update` for tags and category also rewrites the
  snippet. Run them in one place, in order (tags, category and privacy first, then
  chapters), or one can overwrite the other.
- §6.7's Stop goes through `finishRun(id, "manual")`, which records `stopped`, not
  `failed`. Decide which status the Renders list shows for it.

**Timing at the head and tail (first unlisted render).** `run.startAt` is stamped when
the worker's transition call returns. YouTube's own `actualStartTime` can be later,
because the broadcast passes through `liveStarting`. If that gap is more than the 3 s
lead-in, the opener is clipped. `stampVideoTimes` already records both values, so
compare them on the first render. The same applies to the end: `VOD_LEAD_MS` is
untuned (0), and the 5 s lead-out must exceed the real pipeline delay.

**Queue semantics to pin down (WP7a).**
- **Any video encoder.** Each encoder has its own queue, but a video for "any" needs a
  shared pool that idle encoders take from. Videos run in parallel then, so a batch's
  order holds only on a named encoder.
- **Blocked first video.** If the next video on an encoder is in a format that is
  rendering elsewhere, decide whether the encoder waits or takes the next video in the
  queue. Waiting is simpler; taking the next one keeps the batch moving.
- **Booked state.** `encoderOccupancy`'s "booked" state has no single encoder to show a
  schedule set to "any".

**Title codes (WP7-pre).** `%{place}` is a display name ("United Kingdom"), so the
thumbnail example `/thumbs/%{place}.png` gives a path with spaces. Add `%{placeId}`.
`%{asOf}` has no single value for a several-places video. Define it as the oldest
round-up's time, or leave it blank there.

**Status header.** It names WP5-6, WP7 and WP9. WP7-pre, WP8 and WP10 are also still to
do for milestone 1. (WP10 is now built; see the status header.)
