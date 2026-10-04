# Crossword channel — plan

> **Status: PROPOSED** (2026-10-04). Nothing built. Planned on Fable; the work packages
> in §11 are sized to hand to Opus sub-agents one at a time, as with
> [short-video-plan.md](./short-video-plan.md).
> Source material: the February prototype in `../crosswords` (§1).
> Shares the chat seam with [chat-interaction-plan.md](./chat-interaction-plan.md) (§6.4).
> Open questions for the operator are in §13.
> Revised the same day: the encoder is picked at go-live (§10), and the February word
> bank, measured on the local database, is the word source (§7.2).

A crossword channel is a scene whose watch page shows a crossword game where the other
channels show the globe. The worker hosts the game. It lays out a puzzle, puts one clue
in the spotlight at a time, leaks hint letters, and finally fills the answer in itself,
so a puzzle always finishes even with nobody watching. Viewers answer in YouTube chat;
the first correct answer takes the word and its points.

Everything around the game is reused: scenes and watch tokens, the encoder registry,
runs, go-live announcements, the theme tokens and the music bed. The operator starts a
crossword stream on an encoder they pick, as for shorts (§10).

Three terms used throughout:
- **Surface**: what a scene's watch page renders, `globe` or `crossword`. The code says
  "surface" because "mode" already means three things here (director mode, audio mode,
  and the map looks the `:modes` chat command lists).
- **Host**: the worker's game loop. It is also the name credited when nobody solves a word.
- **Stock**: the puzzles that are built, approved and waiting to be played.

## 1. What comes from `../crosswords`, and what stays there

| Prototype piece | Verdict |
|---|---|
| Layout generator (`src/crossword.ts`) | **Port and fix** into the worker. Its "backtracking" never backtracks: a word that cannot be placed is skipped and the recursion still reports success, so the first candidate always sticks and the 500 attempts run once. `maxSize: 50` is silently clamped to 26. |
| Guess logic (`applyGuess`, A1 cell refs) | **Rewrite** as pure rules in `shared`. Viewers get standard numbering (7 Across) and bare-word answers, not spreadsheet refs. |
| SVG renderer | **Drop.** The board is React DOM on `/watch`, so letters can animate and the scoreboard is its own panel. |
| Socket game server, the Next custom server, `parseGameMessage` | **Drop.** The worker runner and the existing worker-event relay replace them. |
| `data.json` (43 space words with clues) | **Keep as the first seed set**, after a human read-through. |
| Word pipeline (`python/words-tools`: Wiktionary/Kaikki → Mongo → hunspell validation → vLLM clue enrichment) | **Stays in that repo** as offline GPU tooling. Its output, a bank of about a million words with 38,989 checked and clued, is imported and becomes the main word source (§7.2). |
| XTTS + Whisper speech service | **Not used.** Spoken clues, if wanted, go through the presenter plan's OpenRouter speech path. |
| `python-audio` ambient generator | **Not used.** Superseded by the audio bed engine here. |
| Murder mystery generator and engine | **Out of scope.** The `surface` field leaves room for it as a later mode. |

## 2. Facts that shape the design

Checked in code on 2026-10-04 unless noted.

- A scene is one broadcast-state document. `name`, `hidden` and `watchToken` sit beside
  the `ControlState` fields as scene metadata, and `db.listScenes()` returns them.
  `GET /api/scenes` is ungated (the token is stripped for anonymous callers).
- `public/src/app/watch/[scene]/page.tsx` mounts the director hooks and the globe
  `WatchSurface` unconditionally.
- Encoder provisioning builds `/watch/<sceneId>?token=…`. Keeping that URL shape means
  slots, runs and announcements need no change.
- A run can already name its encoder (`encoderId` on `POST /api/streams`). But
  `provisionEncoderScene` takes the scene from the encoder's own binding, not from the
  run, so a crossword run on a picked encoder would air that encoder's usual channel.
  The short-video plan found the same thing (its §6.3) and has not built the fix yet.
- The socket relay fans every worker event out to **every** browser (`PUBLIC_ROOM`).
  Anything emitted is public, so an answer must never be in an emitted payload.
- The chat poller (`worker/src/stream/chat.ts`) is one in-process monitor per live run.
  It skips the first (backlog) page, then hands fresh messages to `commandReplies`.
  `listChat` already returns `authorChannelId` and the message's publish time;
  `ChatMessage` keeps the time (`ts`) but drops the channel id.
- Chat cadence is set by quota, not by YouTube. With the defaults (10,000 units a day,
  1,500 reserved, 60 % share, 5 units a poll) one live chat run gets about 1,020 polls a
  day: **one poll every 85 seconds**. Four runs with chat on (three constant streams plus
  this one) get one poll each every 5 min 40 s.
- `liveBroadcasts.insert` sets no `latencyPreference`, so broadcasts use YouTube's
  default (normal) latency.
- YouTube has a push alternative, `liveChatMessages.streamList`: a server-streaming
  connection that sends messages as they are posted and resumes from a page token. Its
  quota cost is not documented. One open-source project measuring it guesses about 5
  units per connection. Not tried with this project's key.
- The worker is one process, so a long synchronous layout search would stall the
  director tick and the game's own timers.
- OBS Chromium has no emoji font, so emoji in a viewer's display name would render as
  boxes on air.
- A crossword scene has no director cuts, so the as-run log, YouTube chapters and the
  public home card's now/next have nothing to show for it.

## 3. A scene gets a surface

```ts
// shared/src/control.ts
export type SceneSurface = "globe" | "crossword";
export interface SceneMeta { /* …existing… */ surface: SceneSurface }
```

- Stored on the scene document as metadata, the same way `hidden` is. It is not a
  `ControlState` field. Add it to `BroadcastStateSchema` (strict Mongoose drops unknown
  keys), to the `listScenes` projection, and to `createScene`'s options. Missing means
  `globe`, so no migration. The main scene is always `globe`.
- `POST /api/scenes` accepts `surface`; the New scene form on `/admin/scenes` gets a
  type picker.
- `/watch/[scene]/page.tsx` resolves the scene's metadata first (it already calls
  `listScenes()` for the name), then renders one of two dynamically imported bodies:
  the existing page body moved unchanged into `GlobeWatch`, or the new `CrosswordWatch`.
  A crossword channel never loads deck.gl or MapLibre, and a globe channel never loads
  the game.
- A crossword scene still has a `ControlState`. It uses `broadcastTheme`,
  `themeOverrides`, `audio`, `chat` and `youtube` from it and ignores the rest. Its
  director config stays `off`.

## 4. The game

All types and rules below live in `shared/src/crossword.ts` as pure functions with
tests. The worker runs them; public uses the types and the on-air helpers only.

### 4.1 Puzzle (stored, holds the answers)

```ts
export interface CrosswordEntry {
  id: string;                 // "7A", "12D" — standard crossword numbering
  num: number;
  dir: "across" | "down";
  row: number; col: number;
  answer: string;             // A–Z only. Never leaves the worker or admin.
  clue: string;
}
export interface CrosswordPuzzle {
  id: string;
  title: string;              // "Volcanoes"
  theme: string;
  width: number; height: number;
  entries: CrosswordEntry[];
  status: "draft" | "ready" | "rejected";
  source: "seed" | "bank" | "themed";
  model?: string;             // the model that polished or wrote the clues, if one did
  createdAt: number;
  plays: { sceneId: string; startedAt: number; endedAt?: number }[];
}
```

### 4.2 Game (one per scene, worker-owned)

```ts
export type CrosswordPhase = "idle" | "intro" | "playing" | "finale";
export interface CrosswordGame {
  sceneId: string;
  puzzleId: string;
  puzzleNo: number;           // running count per scene, shown on air
  seq: number;                // bumps on every change
  phase: CrosswordPhase;
  phaseEndsAt: number;
  spotlight: { entryId: string; startedAt: number; endsAt: number } | null;
  hints: { row: number; col: number; at: number }[];      // letters the host leaked
  solved: Record<string, { by: string; name: string; at: number; points: number; late?: boolean }>;
  scores: Record<string, { name: string; points: number; words: number }>;
  paused: boolean;
  pub: CrosswordPublicState;  // the projection below, stored so public only serves it
}
```

### 4.3 What goes on the wire

`toPublicState(puzzle, game)` builds the only thing that is emitted or served. A cell
carries its letter only if a hint showed it or its entry is solved. An entry carries its
clue and length but never its answer. One test pins exactly that.

```ts
export interface CrosswordPublicState {
  sceneId: string; seq: number; serverNow: number;
  phase: CrosswordPhase; phaseEndsAt: number;
  puzzleNo: number; title: string;
  width: number; height: number;
  rows: string[];             // "#" block, "." empty, a letter = shown
  entries: { id: string; num: number; dir: "across" | "down"; row: number; col: number;
             length: number; clue: string;
             solved?: { name: string; points: number; late?: boolean } }[];
  spotlight: { entryId: string; startedAt: number; endsAt: number } | null;
  scores: { name: string; points: number; words: number }[];   // this puzzle, sorted
  today: { name: string; points: number }[];
  feed: { at: number; text: string }[];                        // the last few solves
  inputLive: boolean;         // a live run with chat is attached to this scene
}
export const CROSSWORD_STATE = "crossword:state";   // full state, on every change
export const CROSSWORD_BEAT  = "crossword:beat";    // { sceneId, seq, serverNow } every 5 s
```

The full state goes out on each change (roughly every 10–15 seconds, about 4 KB). The
beat is tiny; a client whose `seq` differs from the beat's refetches the state route.
Countdowns are drawn client-side from `phaseEndsAt` and `spotlight.endsAt`, corrected by
`serverNow`.

### 4.4 The host loop

`worker/src/crossword/runner.ts`: one runner per crossword scene whose config is
enabled, on its own 500 ms timer (the pattern `script-runner.ts` uses, so it never waits
behind a director pool build). State is saved on every change and reloaded at boot, so
a worker restart resumes mid-puzzle.

The host plays while the scene has a live run. Streams are started by hand on a picked
encoder (§10), so playing around the clock would spend the stock with nobody watching.
A go-live starts a fresh puzzle on its intro card; when the run ends the game parks and
keeps its state. The config's `playOffAir` switch keeps the host playing with no run,
which is how the channel is watched and tested on a local box.

| Phase | What airs | Default length |
|---|---|---|
| `intro` | Title card: puzzle number, theme, word count | 12 s |
| `playing` | One clue in the spotlight; hint letters appear; the answer lands | 60 s a clue |
| `finale` | Finished grid, podium, how many the host had to solve | 30 s |
| `idle` | Holding card. Only when there is no puzzle to play | until stock arrives |

- **Spotlight order**: the unsolved entry with the most letters already showing, ties to
  the lowest number. The first pick is the longest word. This is how a person solves, and
  it is deterministic, so it is testable.
- **Hints**: none for the first 40 % of the clue time, then letters appear at even
  intervals until at most half the word shows.
- **Auto-reveal**: when the clue time runs out, the host fills the word (credited to
  the host, no points), holds for 6 seconds, and moves on.
- **A viewer solves the spotlight word**: 4-second beat, then the next spotlight.
  Solving any other word fills it at once and leaves the spotlight alone.
- **Ceiling**: a puzzle still open after 20 minutes is finished by the host. Unattended,
  14 words take about 15 minutes, which is roughly 96 puzzles a day.
- **Next puzzle**: the oldest ready puzzle this scene has not played; failing that, the
  ready puzzle played longest ago, as long as it is not one of the last 30. Failing that,
  `idle`.

Every number above is a field on `CrosswordConfig` (one document per scene, the pattern
`DirectorConfig` uses) with these values as defaults.

### 4.5 Answering

`parseGuess(text)` in shared:
- Ignore messages over 40 characters.
- Strip an optional leading ref (`7a`, `7 across`, `12-down`), uppercase the rest and
  drop everything that is not A–Z.
- The result must equal an unsolved answer exactly. The ref is only a habit viewers
  have; the word is matched against every open entry either way.
- Wrong guesses get no on-air response.

Rules in the runner:
- The earliest message time wins a word.
- A player is `youtube:<authorChannelId>`. More than 5 guesses in 10 seconds from one
  player and the excess is ignored.
- Hidden players are ignored.
- Names are cleaned before they air: control characters and emoji stripped, 16
  characters at most, checked against the blocklist (§7.3). A name that fails airs as
  "Player 1234".

### 4.6 Scoring, late credit and stream delay

- **Points** for a word = its letters not yet showing when the answer was typed,
  minimum 1. Long words and fast answers pay more; letters filled by crossings count
  as showing.
- **Stream delay**: a viewer sees the board some seconds late. `streamDelayS` (default
  10) shifts the "what was showing" test back by that much, so a hint the viewer could
  not have seen yet does not cost them.
- **Late credit**: chat arrives late (§6). If the host revealed a word and a correct
  answer then arrives that was typed before the reveal (plus the stream delay), the word
  passes to that player, flagged `late`, and the feed says so. Between two players the
  first one processed keeps it; polls arrive in time order, so that is the earlier one.
- **Leaderboards**: this puzzle (in the game document), today, and all-time, the last
  two aggregated from an append-only `crosswordSolves` log.

## 5. On air

```
┌───────────────────────────────────────────────────────────────────────┐
│ BRAND · CROSSWORD          Puzzle 42 · Volcanoes         7 of 14 solved │
├────────────────────────────────┬──────────────────────────────────────┤
│                                │ NOW SOLVING     7 ACROSS · 6 letters  │
│                                │ Opening that vents lava               │
│             GRID               │ C R _ T _ _              ▓▓▓▓░░  0:24 │
│         13 × 13 at most        ├───────────────────┬──────────────────┤
│                                │ ACROSS            │ DOWN             │
│                                │ 1 …               │ 2 …              │
│                                │ 7 … ✔ rich +4     │ 3 …              │
│                                ├───────────────────┴──────────────────┤
│                                │ THIS PUZZLE         TODAY            │
├────────────────────────────────┴──────────────────────────────────────┤
│ Type your answer in the chat — the first correct answer takes the word │
└───────────────────────────────────────────────────────────────────────┘
```

- Components in `public/src/components/crossword/`, one small file each: `CrosswordWatch`
  (data + audio), `CrosswordSurface` (layout), `Grid`, `SpotlightCard`, `ClueList`,
  `Scoreboard`, `SolveFeed`, `IntroCard`, `FinaleCard`, `HowToStrip`.
- House rules apply: flat plates with no shadows, the seven theme ink tokens, every blur
  written `var(--panel-blur, …)`, the OBS render mode honoured, nothing auto-scrolls,
  no card rotates its own content.
- **Fit is guaranteed by the puzzle, not the layout.** The clue list never scrolls, so
  the caps in §7.1 and §7.3 (16 words, 48-character clues, 13 columns) are what make it fit.
  Starting sizes to tune on the real frame: 64 px cells, 40 px spotlight clue, 24 px list.
- DOM and CSS transitions only: no canvas, no WebGL, no rAF loop. This is the cheapest
  page an encoder will render.
- `HowToStrip` reads from `inputLive`. With no live chat attached it says the host is
  playing a demo round.
- **Audio**: the existing `BroadcastBed` with the scene's `audio` settings and no
  segment (its idle energy). It gains one optional `pulseKey` prop so a finished puzzle
  fires the riser. A solve chime is later work (§11 WP13).

## 6. Chat is the input, and its delay is the main risk

### 6.1 The problem

On today's quota a viewer's answer is read up to 85 seconds after they send it with one
live chat run, and several minutes after with four. The game stays *fair* at that delay,
because answers are ordered by the time they were typed and late credit corrects the
host's reveals. It does not stay *fun*: you type the answer and nothing happens.

Polling at the current quota is good enough to prove the feature on a test run. It is
not good enough to launch on.

### 6.2 The fix to try first: `streamList`

A push connection would deliver answers within a second or two. Whether it is
affordable is unknown until it is measured.

**WP7 is a probe, not a build**: `worker/src/scripts/chatStreamProbe.ts`
(`yarn youtube:chat-stream <runId>`), run by the operator against a live run. It opens
the stream with the account's token, prints each message's delay (now minus publish
time), how long a connection lasts and how it resumes, and the operator reads the
project's quota graph before and after an hour. The gRPC endpoint and proto come from
Google's Streaming Live Chat guide; neither has been checked here.

- If a connection costs about what one poll costs: WP8 replaces polling with a stream
  reader, for crossword runs first, then every run. It goes through `apiCall` with its
  own cost entry in `quota.ts`.
- If not: WP8 becomes weighted pacing (a crossword run takes a larger part of the chat
  budget than a globe run), and the real fix is a quota extension from Google.

### 6.3 Cheap help either way

- Crossword broadcasts ask for low latency (`contentDetails.latencyPreference`), so the
  picture is seconds behind, not tens of seconds.
- No chat replies by default. Each costs 50 units; the board is the acknowledgement.
- `:modes` and `:mode` are skipped on a crossword scene. They describe the globe.

### 6.4 Where it plugs in

`chat.ts` gets one more consumer beside `commandReplies`: if the run's scene is a
crossword scene, the fresh messages go to `crossword/chat.ts`, which enqueues nothing
and calls the runner directly (same process). `ChatMessage` gains `authorChannelId`, as
does the chat-log model. When the chat-interaction plan's scene-scoped `handleChatBatch`
lands, this becomes one of its consumers; neither plan blocks the other.

## 7. Puzzles

### 7.1 Layout

`worker/src/crossword/layout.ts`, ported from the prototype and fixed:
- Seeded random restarts inside a time budget, keeping the best layout by score: words
  placed, then crossings, then a compact near-square box within `maxSize`.
- Standard numbering in row order.
- A layout below `minWords` (10) fails; the build reports it.
- It is `async` and yields to the event loop between attempts. If a single attempt
  measures over 20 ms on a 60-word candidate list, it moves to the bake pool instead.

The style is criss-cross (every word crosses at least one other, no word touches another
side by side), as in the prototype. A dense newspaper grid needs a very different fill
algorithm and a much larger vetted word list; it is not planned.

### 7.2 The word bank

The February prototype left a word bank in the local `crossword` Mongo database.
Measured on 2026-10-04:

| | Count |
|---|---|
| Words ingested from Wiktionary | 1,011,999 |
| Checked as real words (hunspell, WordNet, SCOWL, word frequency) | 51,070 accepted, 41,190 for review, 77,109 not yet checked |
| Accepted and given clues | 38,989 |
| Of those: 3–12 letters, no adult, vulgar or offensive flag | 33,314 |
| Of those: words most viewers know (frequency score 3 or more) | 12,158, about a quarter of them names and places |
| Clues | 878,152 across 185,328 answers, about five a word |

**The answers are good.** Each is a real word checked against four sources, carries a
frequency score that works as a difficulty dial, and keeps its raw Wiktionary
definitions (WRECK has 21).

**The clues are not airable as they stand.** A 7B local model wrote them. In a sample of
22 familiar words (about 110 clues) roughly half would pass. The faults:
- most end in a letter count that is wrong ("Work remuneration (5)" for WAGE);
- wrong sense ("Dairy product" for MILKY);
- a name or place sense of an ordinary word ("City in Iowa" for GRAY);
- the answer or its stem inside the clue ("Judicial probation"; 3 % contain the answer
  verbatim);
- too vague to solve ("Do fast" for SNATCH).

The stored clue difficulty is no use (65 % are "3"), and the 9,666 category slugs are
noisy.

So the bank supplies the **words**, and each puzzle's clues are polished when it is
built (§7.3).

Getting it into this app:

1. **The operator imports the raw bank into this app's database** (operator's decision,
   2026-10-04). Only two of the prototype's collections are needed, and they land under
   prefixed names in the house style so nothing generic sits among the app's own
   collections: `words` → `crosswordbankwords`, `clues` → `crosswordbankclues`. From
   the February dump that is one command (dry-run checked on 2026-10-04; `weather` is
   the local database name):

   ```
   mongorestore --uri "mongodb://127.0.0.1:27017" \
     --nsInclude 'crossword.words' --nsInclude 'crossword.clues' \
     --nsFrom 'crossword.words' --nsTo 'weather.crosswordbankwords' \
     --nsFrom 'crossword.clues' --nsTo 'weather.crosswordbankclues' \
     /home/rich/code/thronix/dump
   ```

   It adds about 1.5 GB (1,011,999 words, 878,152 clues).
2. **`yarn crossword:bank-build`** (worker CLI, also a button on `/admin/jobs`) reads
   those two collections through the app's own connection and writes the trimmed set to
   `db.crosswordWords`: accepted, with clues, unflagged, 3–12 letters, not a name, place
   or proper noun. Each document holds the word, length, frequency score, parts of
   speech, category slugs, up to six definitions and its cleaned candidate clues.
   Expect about 25,000 words; the build prints the count. It is idempotent, so it can be
   re-run after a fresh import.
   - The raw clues have no index, so the build first creates one on
     `crosswordbankclues.answerId`.
   - The raw collections get no Mongoose model. Only this CLI reads them, through the
     native driver; everything else uses `db.crosswordWords`.
   - `cleanClue` (shared, tested) runs here: strip a trailing "(N)", drop a clue that
     contains the answer or the answer with a common ending removed, drop clues under 8
     or over 48 characters, drop duplicates.
3. After the build nothing reads the raw collections again. The operator can drop them,
   and a box that only needs to play can be given `crosswordwords` alone (tens of MB).
- The sources (Wiktionary via Kaikki, WordNet, SCOWL, hunspell, wordfreq) go in
  [external-sources-register.md](./external-sources-register.md) with their licences
  before anything derived from them airs.

Growing the bank (the 41,190 review words, the 530,285 words with no clues yet) is the
prototype repo's GPU tooling, not this app's. Its newer scripts are on that repo's
`0.1` branch. Import again and re-run the build when it grows.

### 7.3 Building a puzzle

Job `crossword.generate` (`{ sceneId, theme? }`), background queue:

1. **Pick candidates.** About 60 words from the bank at or above the scene's `minZipf`
   (default 3.5, which leaves about 5,800 words of 4–9 letters), with a spread of
   lengths, none used in the scene's last 20 puzzles. Seeded, so a build is repeatable.
2. **Lay out** (§7.1). 12–16 words are placed.
3. **Polish the clues.** One `callOpenRouter` call covering the placed words only. For
   each word it sends the definitions and the candidate clues, and asks for one clue of
   at most 48 characters, for the word's most common sense, not containing the answer:
   the best candidate, or a new one written from the definitions. The definitions are
   the facts; the model supplies the wording. Model: `CROSSWORD_MODEL`, falling back to
   `OPENROUTER_MODEL`. One call a puzzle, which should be well under a cent at the
   default model; confirm from the first real calls.
4. **Validate.** `validateClue` (pure, tested) rejects a clue under 8 or over 48
   characters, one that contains the answer or its stem, and one that hits the
   blocklist (a built-in list plus the operator's own). A rejected clue falls back to
   the word's best stored clue. A word left with no usable clue is dropped and the grid
   is laid out again without it. Fewer than `minWords` and the build fails.
5. **Store** the puzzle as `draft`, or `ready` under auto-approve (§7.4).

With no OpenRouter key, step 3 is skipped and the best stored clue is used. The clues
are weaker, but the whole path runs on a local box and in tests.

**Themed puzzles.** The bank is general vocabulary and thin on the network's own
subjects: 141 words tagged weather, 8 meteorology, 215 geology, 367 astronomy, 1,051
geography. So a themed puzzle starts from a model: it proposes about 30 theme words
with clues, each answer must be in the bank (which proves it is a real word) or it is
dropped, and bank words fill in when the themed set will not interlock. The scene's
config lists the themes and sets `themeEvery` (0 = never, 3 = every third puzzle).

**Seed set.** `shared/src/crossword-seeds.ts` keeps the prototype's 43-word space set
for tests and for a box with no bank imported.

### 7.4 Approval

None of the checks can tell whether a clue is *true*. So a built puzzle is `draft` until
an operator approves it on `/admin/crosswords`, unless the scene's `autoApprove` is on.
`autoApprove` starts off. A stream left on all day plays about 96 puzzles unattended,
which nobody will approve by hand, so the review gate is for learning how good the
polished clues are; once they are trusted, auto-approve is where the channel ends up.
Until then the channel replays its approved stock.

### 7.5 Stock

A repeatable `crossword.topUp` (every 30 minutes, staggered) builds one puzzle for each
enabled crossword scene whose unplayed stock is below `stockTarget` (6). It is also a
button on `/admin/jobs`.

## 8. Operator and admin

One new admin page, `/admin/crosswords` (MUI admin theme), four tabs:

| Tab | What it does |
|---|---|
| Channels | Per crossword scene: the live board in small, **Go live** (§10), Pause/Resume, Skip clue, Reveal word, Next puzzle, and a **simulator** ("say as viewer": name + text) |
| Puzzles | The stock: status, theme, source, plays. Open one to see the grid with answers, edit a clue, drop a word (re-lays the grid), approve or reject. Generate now, with a theme |
| Players | Totals per player; hide and unhide |
| Settings | The scene's `CrosswordConfig`: enabled, play off air, pacing, difficulty (`minZipf`), themes and how often, limits, auto-approve, stream delay |

- The simulator is how the whole game is exercised before any stream exists. A simulated
  message goes through the same handler as a YouTube one, marked `sim`, and is not
  written to the chat log.
- `/admin/scenes/:id` for a crossword scene shows only the cards that apply (theme,
  music bed, YouTube, about) and a link to the crossword settings. `SettingsCardDef`
  gains `surfaces?: SceneSurface[]`. Moving the settings onto that page as a third Save
  bucket is deferred until the scene-settings refinement work has settled.

Routes, all under `public/src/app/api/crossword/`, all wrapped in `withApiLog`. Public
holds no game logic: it reads Mongo or enqueues a foreground job.

| Route | Gate | Does |
|---|---|---|
| `GET :scene/state` | watch token or admin | serves the stored `pub` projection |
| `POST :scene/sim` | admin | enqueues `crossword.inject` with a simulated message |
| `POST :scene/command` | admin | enqueues `crossword.inject` with pause, resume, skipClue, reveal or nextPuzzle |
| `GET`/`PATCH :scene/config` | admin | the scene's config; the runner re-reads it each tick |
| `GET puzzles`, `PATCH puzzles/:id` | admin | list, edit, approve, reject |
| `POST generate` | admin | enqueues `crossword.generate` |
| `GET players`, `PATCH players/:id` | admin | list, hide |

## 9. Data

| Collection | Facade | One per | Holds |
|---|---|---|---|
| broadcast states (existing) | — | scene | + `surface` |
| `crosswordconfigs` | `db.crosswordConfig` | scene | enabled, `playOffAir`, pacing, themes, limits |
| `crosswordpuzzles` | `db.crosswordPuzzles` | puzzle | §4.1 |
| `crosswordgames` | `db.crosswordGames` | scene | §4.2, including `pub` |
| `crosswordsolves` | `db.crosswordSolves` | solve | scene, puzzle, entry, player, points, time |
| `crosswordplayers` | `db.crosswordPlayers` | player | name, hidden, first and last seen |
| `crosswordwords` | `db.crosswordWords` | word | word, length, frequency score, categories, definitions, candidate clues |
| `crosswordbankwords`, `crosswordbankclues` | none (native driver, build CLI only) | raw word, raw clue | the prototype's documents as imported by the operator |

Plus `db.crosswordScenes()`. Models and repos follow the existing typed pattern
(`short-script-model.ts` / `short-script-repo.ts`). `shared/src/db/index.ts` is being
edited by the short-video work: add lines, never rewrite. No blob namespaces.

Jobs: `crossword.inject` (foreground), `crossword.generate` and `crossword.topUp`
(background). The runner itself is not a job.

## 10. Streaming

**The operator picks the encoder at go-live, as for shorts.** No encoder is dedicated
to crosswords and none is added: there are several registered, and the picker shows
what each is doing so a busy one is never taken.

- **Go live** on the Channels tab opens the run form with the crossword scene filled in:
  encoder, YouTube channel, privacy, title, and a duration or open-ended. It posts the
  same `POST /api/streams` a one-off run does, with `encoderId` set.
- The encoder select is the short-video plan's `EncoderSelect` over its
  `encoderOccupancy` helper (free, live, held by a slot, booked, disabled). A live or
  held encoder cannot be chosen.
- `provisionEncoderScene` gains the `sceneId` override the short-video plan specifies,
  so the picked encoder shows `/watch/<crossword scene>` for the run and goes back to
  its own scene when the run ends.
- Both pieces belong to short-video WP5, which is not built. Whichever plan reaches
  them first builds them, to that plan's spec, and the other reuses them.
- An always-on crossword stream stays possible later: a slot already stores an
  `encoderId`, and the same picker would choose it. It is not part of this plan.

`yarn seed:crossword-scene` creates the scene only (surface `crossword`, music bed on,
chat on).

A crossword run with chat on is one more reader on the chat budget in §6.1, which is
one more reason the probe comes early.

## 11. Phases and work packages

Each package ships its own tests and leaves `./test` green. After any `shared/src` edit,
run `./update-shared`; never while another agent is testing.

### P0 — playable locally with the simulator (no YouTube; the LLM is optional)

| WP | Owns | Builds | Needs |
|---|---|---|---|
| 1 | `shared/src/crossword*.ts`, `shared/src/db/crossword-*`, the `surface` lines in `control.ts`, `broadcast-state-model.ts`, `db/index.ts` | Types, `parseGuess`, numbering, scoring, hint schedule, spotlight pick, late credit, `toPublicState`, name cleaning, `cleanClue`, `validateClue`, the seed set, models, repos (including `crosswordWords`), `surface` | — |
| 2 | `worker/src/crossword/{layout,pick,build}.ts`, `worker/src/scripts/crossword*.ts` | `crossword:bank-build` (§7.2), candidate pick, layout search, puzzle build with stored clues (§7.3 steps 1, 2, 4, 5), `yarn crossword:build`, `yarn seed:crossword-scene`, the sources registered | 1 |
| 3 | `worker/src/crossword/{runner,inject,state}.ts`, the crossword lines in `worker/src/index.ts` | Host loop, persistence and resume, emit and beat, `crossword.inject` job | 1 |
| 4 | `public/src/components/crossword/`, `public/src/lib/crossword.ts`, `watch/[scene]/page.tsx`, `api/crossword/[scene]/state` | Surface switch, `GlobeWatch` extraction, the on-air components, `useCrosswordState` (cold start + resync), `BroadcastBed` `pulseKey` | 1 |
| 5 | `public/src/app/admin/crosswords/`, `public/src/components/admin/crosswords/`, the other `api/crossword` routes, scene create form, `catalog.ts` `surfaces` | Admin page with all four tabs, simulator, commands, config | 1 |

WP1 first, then freeze `shared/`. WP2 and WP3 can run together; WP4 and WP5 can run
together. The operator's import of the raw bank (§7.2 step 1) comes before WP2's build
can be run for real; WP2's tests use a small fixture.

**Milestone M0**: with `playOffAir` on, `/watch/crossword` plays puzzles built from the
imported bank on a local box; the operator answers through the simulator and takes
words from the host; a worker restart mid-puzzle resumes it; the wire payload has no
unsolved answer in it.

### P1 — on YouTube

| WP | Builds | Needs |
|---|---|---|
| 6 | Chat hookup: `authorChannelId` through `ChatMessage` and the chat log, `crossword/chat.ts`, rate limit, players, today and all-time boards, `inputLive`, `:modes` skipped | M0 |
| 7 | The `streamList` probe script (§6.2). The operator runs it and reads the quota graph | — (can start now) |
| 8 | Chat transport: the stream reader if the probe passes, weighted pacing if not | 7 |
| 9 | Clue polish through OpenRouter (§7.3 step 3), themed puzzles checked against the bank, the `crossword.generate` job, `crossword.topUp`, the review flow on the Puzzles tab | M0 |
| 10 | Going live (§10): the Go live dialog with the encoder picker, the provision `sceneId` override and restore, low-latency preference on crossword broadcasts, a line for the public home card ("Puzzle 42 · Volcanoes · 7 of 14"), title and description defaults | M0; shares `EncoderSelect`, `encoderOccupancy` and the override with short-video WP5 |

**Milestone M1**: an unlisted run on the TEST box, on an encoder picked in the dialog,
with real chat (WP6 and WP10).
**Launch gate**: answers land within about 10 seconds of being sent (WP8).

### P2 — depth

| WP | Builds |
|---|---|
| 11 | A bigger bank: import again after the prototype repo clears its review words and clues more of them; tidy the category slugs enough to theme straight from the bank |
| 12 | An as-run entry per puzzle, so chapters and the VOD page work |
| 13 | Solve chime and finale riser in the bed; spoken clues once the presenter plan's voice path exists |
| 14 | Puzzles themed from the pipeline's own facts (today's warnings, quakes, named storms): facts from Mongo, wording from the model |
| 15 | A second-screen play page off a QR code. It is a public write surface, so it needs its own abuse plan first |

## 12. Tests

- **shared**: `parseGuess` (refs, punctuation, long messages); numbering; scoring with
  crossings and stream delay; hint schedule; spotlight pick; late credit; name cleaning;
  `cleanClue` and `validateClue`; `toPublicState` leaks no unsolved letter; schema parity for
  `surface`.
- **worker**: the bank build trims and cleans a fixture and is idempotent; the candidate
  pick honours `minZipf` and the no-repeat window; layout places the seed set, is
  deterministic for a seed and yields;
  runner phase transitions on a fake clock; first answer wins; auto-reveal; the ceiling;
  resume from a stored game; next-puzzle choice and the no-repeat window; inject from
  the simulator writes no chat log; the generate job with a mocked OpenRouter reply
  (good clues, bad JSON, a leaking clue falling back to the stored one, too few
  survivors) and with no key at all.
- **public**: the watch page picks the right body per surface; grid renders shown letters
  only; countdown from `serverNow`; state hook refetches on a `seq` gap; every route's
  gate; admin tabs stage and save.

## 13. Decisions taken, and questions for the operator

Decisions (change here if wrong):
1. Crossword is a scene **surface**, not a director mode and not a new route.
2. The worker owns the game; public only draws it. The solution never goes on the wire.
3. Viewers answer with the bare word; a ref is optional.
4. The host solves what nobody answers, so the channel never stalls.
5. Game settings live on `/admin/crosswords` for now, not as scene-page cards.
6. Clues are polished through OpenRouter and start behind an approval gate.
7. No chat replies; no avatars on air, names only.
8. The prototype's Python stays in its own repo; only its exported data is imported.
9. The operator picks the encoder at go-live, as for shorts. No encoder is dedicated to
   crosswords (operator, 2026-10-04: there are several, so one is always free to pick).
10. The February word bank is the word source from the first milestone. The operator
    imports its raw collections into this app's database; a worker build trims them.
    Its stored clues are candidates, never aired unpolished except with no LLM key on a
    dev box.
11. Difficulty comes from word frequency (`minZipf`), not from the bank's stored clue
    difficulty.

Questions:
1. **Subject matter.** The bank is general vocabulary, so the plan makes general
   puzzles the default and on-brand themed ones (weather, earth, space, geography) an
   every-so-often special written with a model's help. Is that the right mix, or should
   the channel be themed only?
2. **Auto-approve**: is starting behind review and switching to auto once the clues are
   trusted acceptable, given the channel will replay puzzles until then?
3. **The committed `.env` in `../crosswords`** holds five provider keys and is pushed to
   its remote. They should be rotated whether or not this plan goes ahead.
