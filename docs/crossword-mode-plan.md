# Crossword channel — plan

> **Status: PROPOSED** (2026-10-04). Nothing built. Planned on Fable; built by
> sub-agents on other models, chosen per work package, with tests and validation always
> on a strong model (§11, "Who builds").
> Source material: the February prototype in `../crosswords` (§1).
> Shares the chat seam with [chat-interaction-plan.md](./done/chat-interaction-plan.md) (§6.4).
> Open questions for the operator are in §13.
> Revised the same day on the operator's direction: the encoder is picked at go-live
> (§10); the February word bank is imported whole and its words admin ported (§7.2,
> §8.3); the crossword gets its own tokened page and theme, outside `/watch` (§3, §5.1);
> it goes out on a YouTube channel the operator chooses (§10); and both kinds of channel
> are administered from one list (§8). It is joined to the weather product on the admin
> side only and carries no weather content. Words and clues need approval and carry a
> family-friendly tag (§7.4).

A crossword channel is a second kind of channel beside the weather ones: its own page,
its own look and its own YouTube channel, showing a crossword game. The worker hosts the game. It lays out a puzzle, puts one clue
in the spotlight at a time, leaks hint letters, and finally fills the answer in itself,
so a puzzle always finishes even with nobody watching. Viewers answer in YouTube chat;
the first correct answer takes the word and its points.

It is integrated on the admin side, the way the OBS and streaming screens are, and
nowhere else: it shows no weather, and the plan adds none (operator, 2026-10-04: alerts
on it one day, "probably not"). The plumbing that puts a page on air is reused: the
channel record and its token, the encoder registry, runs, go-live announcements and the
music bed. The operator starts a crossword stream on an encoder and a YouTube channel
they pick (§10).

Three terms used throughout:
- **Surface**: which kind a channel is, `globe` (weather) or `crossword`. The code says
  "surface" because "mode" already means three things here (director mode, audio mode,
  and the map looks the `:modes` chat command lists).
- **Host**: the worker's game loop. It is also the name credited when nobody solves a word.
- **Stock**: the puzzles built from approved words and clues and waiting to be played.

## 1. What comes from `../crosswords`, and what stays there

The prototype's real state is its **`0.1` branch** (8 commits ahead of `master`, which is
what a fresh clone checks out). It splits into `game-ui`, `game-server`, `game-shared`,
`ai-manager` and `ai-services`.

| Prototype piece (on `0.1`) | Verdict |
|---|---|
| Words admin (`game-ui`: `/words`, `/words/:id`, `listWords`, `getWordById`) | **Port all of it** into this app's admin (§8.3). It is read-only there; this plan adds the air decisions it lacks. |
| Word bank in Mongo (`words`, `clues`) | **Imported whole** by the operator and kept as this app's word source (§7.2). |
| Word pipeline (`python/words-tools`: Wiktionary/Kaikki → Mongo → validation → vLLM clues) | **Stays in that repo** as offline GPU tooling, with `ai-manager` and `ai-services`. |
| Layout generator (`game-server/src/lib/crossword.ts`) | **Port and fix.** Its "backtracking" never backtracks: a word that cannot be placed is skipped and the recursion still reports success. The stored games show the result: from 300 candidate words, the latest grid placed 5. |
| Game loop (`crossword-game.ts`: games stored in Mongo, restore on restart, `word_solved` and `score_update` events) | **Rewrite** in the worker (§4). Same ideas, plus the host, hints and chat. |
| Guess logic (A1 cell refs, "F2 CATERPILLAR") | **Rewrite** as pure rules in `shared`: standard numbering and bare-word answers. |
| OBS pages (`/obs`, `/obs/chat`, `/obs/scoreboard`, `/obs/presenter`: four separate browser sources, no token) | **Replaced** by one tokened output page (§3, §5). This app provisions one full-canvas source per encoder. |
| SVG board renderer | **Drop.** The board is React DOM. |
| Solve effects (board shake, letters animating in) | **Keep the idea**, redone in CSS on the DOM grid. |
| Presenter phrase bank (`presenter-words.json`: 6 situations, 34–149 wordings each) | **Keep** as the host's feed lines; spoken later (§11 WP15). |
| Animated presenter with moods and lip-sync, StyleTTS / voice generation services | **Later**, with the presenter plan's voice path. Not this plan. |
| Games and messages admin | **Not ported.** Puzzles and plays (§8.3) and the existing chat log cover them. |
| `data.json` (43 space words) | **Keep as the seed set** for tests. |
| Murder mystery generator and admin | **Out of scope.** |

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
- A run carries the YouTube account it publishes to, and the go-live forms have a
  select for it. But a channel stores no account of its own, and a run started without
  one falls back to **the most recently connected account**. With a second YouTube
  channel connected, that fallback can put a stream on the wrong one.
- The YouTube quota is per Google Cloud project, not per YouTube channel. A separate
  channel for crosswords does not bring its own quota.
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

## 3. A crossword channel: its own page, its own look, a shared channel record

**`/watch` is the weather product's.** The crossword is a different product on its own
page, with its own theme, and it goes out on its own YouTube channel (operator,
2026-10-04). What the two share is the plumbing that puts a page on air.

```ts
// shared/src/control.ts
export type SceneSurface = "globe" | "crossword";
export interface SceneMeta { /* …existing… */ surface: SceneSurface }
/** "/watch/<id>" for a weather channel, "/crossword/<id>" for a crossword one. */
export function outputPath(scene: { id: string; surface?: SceneSurface }): string;
```

- **The output page is new and is not a watch page**: `/crossword/:id?token=…`, in
  `public/src/app/crossword/[channel]/page.tsx`. Nothing under `public/src/app/watch/`
  is touched, and the crossword page never loads deck.gl, MapLibre or the weather
  chrome.
- **Tokened like the weather one.** Each channel has a secret token; the page and its
  state route refuse without it. Copy and Rotate on `/admin/access` work for both kinds.
- **Its own theme** (§5.1). It does not use the weather `broadcastTheme` or its ink
  tokens.
- **A shared channel record.** Runs, encoders, slots, go-live, thumbnails, chat polling
  and announcements all look a channel up by its scene id. So a crossword channel keeps
  a record in the same collection, marked `surface: "crossword"`, holding only what
  that plumbing reads: name, token, YouTube settings (including which YouTube channel,
  §10), chat on/off and the music bed. Its weather fields sit at their defaults and are
  never shown. The alternative, a separate channel collection, would mean changing
  every one of those lookups in the streaming code.
- **`surface`** is scene metadata, stored the way `hidden` is, not a `ControlState`
  field. Add it to `BroadcastStateSchema` (strict Mongoose drops unknown keys), to the
  `listScenes` projection and to `createScene`'s options. Missing means `globe`, so no
  migration. The main scene is always `globe`.
- **`outputPath` is the one place that knows which page a channel uses.** The Channels
  list, the Access page, the home launcher and the worker's `watchUrlForScene` all call
  it. A crossword channel opened at `/watch/<id>` redirects to its own page.
- **Three small things follow from leaving `/watch`:**
  - `proxy.ts` gates only the paths it lists, so `/crossword/**` is open to OBS as
    `/watch/**` is; the token is the gate.
  - The OBS sweep recognises "one of ours" with `isWatchUrl` (`^/watch/`). It must also
    match `/crossword/`, or a left-over crossword source would never be swept.
  - If the servers have any rule keyed on `/watch` (caching, an auth exception), the
    new path needs the same. That is the operator's to check.

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
  wordId: string; clueId: string;   // the approved bank word and clue it came from
}
export interface CrosswordPuzzle {
  id: string;
  title: string;              // "Puzzle 42", or a theme name later
  width: number; height: number;
  entries: CrosswordEntry[];
  status: "ready" | "rejected";     // built only from approved words and clues (§7.4)
  familyFriendly: boolean;          // every word and clue in it carries the tag
  source: "seed" | "bank" | "themed";
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
| `intro` | Title card: puzzle number, word count | 12 s |
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

- Components in `public/src/components/crossword/`, one small file each: `CrosswordPage`
  (data + audio), `CrosswordSurface` (layout), `Grid`, `SpotlightCard`, `ClueList`,
  `Scoreboard`, `SolveFeed`, `IntroCard`, `FinaleCard`, `HowToStrip`.
- The look is the crossword's own (§5.1), not the weather chrome's.
- **Fit is guaranteed by the puzzle, not the layout.** The clue list never scrolls, so
  the caps in §7.1 and §7.3 (16 words, 48-character clues, 13 columns) are what make it fit.
  Starting sizes to tune on the real frame: 64 px cells, 40 px spotlight clue, 24 px list.
- DOM and CSS transitions only: no canvas, no WebGL, no rAF loop. This is the cheapest
  page an encoder will render.
- `HowToStrip` reads from `inputLive`. With no live chat attached it says the host is
  playing a demo round.
- **Audio**: the existing `BroadcastBed` with the channel's `audio` settings and no
  segment (its idle energy). It gains one optional `pulseKey` prop so a finished puzzle
  fires the riser. A solve chime is later work (§11 WP15).

### 5.1 Its own theme

The crossword does not wear the weather broadcast's look. Its theme is part of the
crossword channel's config:

```ts
// shared/src/crossword.ts
export interface CrosswordTheme {
  preset: string;                      // a named starting point
  brand: { title: string; logoUrl: string };
  colors: { background: string; panel: string; cell: string; cellSolved: string;
            block: string; ink: string; inkMuted: string; accent: string };
  font: { display: string; text: string };
}
```

- **For now there is one preset: the prototype's look** (its light board, dark blocks
  and slate ink), carried over as it is. The operator's verdict is that it looks poor
  and will be dealt with later, so nothing is spent on it in this plan.
- The page turns the theme into CSS variables once, at the top, so a better look later
  is a new preset, not a rewrite. The theme editor with a live preview is later work
  (§11 WP17).
- The brand title and logo are the crossword channel's own, since it goes out on a
  different YouTube channel from the weather streams.
- What does carry over from the weather page is craft, not look: every blur written
  `var(--panel-blur, …)` and the OBS render mode honoured (both are GPU cost), nothing
  auto-scrolls, and no card rotates its own content.

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

**WP9 is a probe, not a build**: `worker/src/scripts/chatStreamProbe.ts`
(`yarn youtube:chat-stream <runId>`), run by the operator against a live run. It opens
the stream with the account's token, prints each message's delay (now minus publish
time), how long a connection lasts and how it resumes, and the operator reads the
project's quota graph before and after an hour. The gRPC endpoint and proto come from
Google's Streaming Live Chat guide; neither has been checked here.

- If a connection costs about what one poll costs: WP10 replaces polling with a stream
  reader, for crossword runs first, then every run. It goes through `apiCall` with its
  own cost entry in `quota.ts`.
- If not: WP10 becomes weighted pacing (a crossword run takes a larger part of the chat
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

So the bank supplies candidates, and nothing from it airs until a word and a clue have
been approved (§7.4).

Getting it into this app:

1. **The operator imports the bank into this app's database** (operator's decision,
   2026-10-04). Two of the prototype's collections are needed, renamed so nothing
   generic sits among the app's own: `words` → `crosswordbankwords`, `clues` →
   `crosswordbankclues`. From the February dump that is one stock `mongorestore`
   command (dry-run checked on 2026-10-04; `weather` is the local database name):

   ```
   mongorestore --uri "mongodb://127.0.0.1:27017" \
     --nsInclude 'crossword.words' --nsInclude 'crossword.clues' \
     --nsFrom 'crossword.words' --nsTo 'weather.crosswordbankwords' \
     --nsFrom 'crossword.clues' --nsTo 'weather.crosswordbankclues' \
     /home/rich/code/thronix/dump
   ```

   It reads the dump files and loads those two collections under the new names. It adds
   about 1.5 GB (1,011,999 words, 878,152 clues) and touches nothing else.
2. **The bank stays whole.** It is not trimmed to a second collection: the words admin
   (§8.3) browses all of it, and the puzzle builder (§7.3) queries it directly.
3. **Indexes.** The prototype's collections have none, so every list page there scanned a
   million documents. `yarn crossword:bank-index` (to be written; also a button on
   `/admin/jobs`) builds them once after an import: on words `norm`,
   `enrichment.status`, `updatedAt`, `length`, and one compound index for the builder's
   pick (approval, family friendly, length, frequency); on clues `answerId`. It is run by the
   operator, not at worker boot, because it takes a while on a million documents.
4. **Access.** `db.crosswordBank` is a thin repo over the two native collections, because
   the documents keep the prototype's shape (ObjectId keys, no `id` field) and so do
   not fit the app's typed model pattern. It carries the prototype's `listWords` and
   `getWordById`, plus the builder's pick and the write actions in §8.3.
- The sources (Wiktionary via Kaikki, WordNet, SCOWL, hunspell, wordfreq) go in
  [external-sources-register.md](./external-sources-register.md) with their licences
  before anything derived from them airs.

Growing the bank (the 41,190 review words, the 530,285 words with no clues yet) is the
prototype repo's GPU tooling, not this app's. Its newer scripts are on that repo's
`0.1` branch. Import again and re-run the build when it grows.

### 7.3 Building a puzzle

Job `crossword.generate` (`{ sceneId }`), background queue. It uses only what has been
approved (§7.4), so it makes no model call and its puzzles need no review of their own.

1. **Pick candidates.** About 60 random words from the approved pool: the word is
   approved and has at least one approved clue, it is 3–12 letters, at or above the
   channel's `minZipf` (default 3.5), and was not used in the channel's last 20
   puzzles. On a family-friendly channel the word and the clue must both carry the
   family-friendly tag. A spread of lengths. Seeded, so a build is repeatable.
2. **Lay out** (§7.1). 12–16 words are placed.
3. **Choose each clue** from that word's approved clues, the one this channel used
   longest ago.
4. **Check.** `validateClue` runs again as a guard (length caps, the answer not in the
   clue, the blocklist). Fewer than `minWords` and the build fails, saying how many
   approved words were available.
5. **Store** the puzzle as `ready`, with `familyFriendly` set when every word and clue
   in it carries the tag.

**Themed puzzles (later, §11 WP16).** Puzzles are general knowledge. The bank's
category tags are too noisy to theme from directly (9,666 slugs, most with a handful
of words), so a themed puzzle would start from a model proposing theme words, each of
which must be in the bank, and its words and clues would go through the same approval
before any of them aired.

**Seed set.** `shared/src/crossword-seeds.ts` keeps the prototype's 43-word space set,
counted as approved and family friendly after a read-through, for tests and for a box
with no bank imported.

### 7.4 Approval, and the family-friendly tag

Nothing from the bank goes to air until a person has approved it (operator,
2026-10-04). Approval is given to **words and clues**, not to puzzles: a puzzle made
only of approved words and approved clues is ready the moment it is built.

Two fields on every bank word and on every bank clue:

```ts
approval: { status: "pending" | "approved" | "rejected"; by?: string; at?: number };
familyFriendly: boolean | null;     // null = not tagged yet
```

- **A word is playable** when it is approved and has at least one approved clue.
- **Family friendly** is a tag on the word and on the clue separately, because a clean
  word can have an unsuitable clue ("Aroused" is a stored clue for EXCITED). It is set
  by the person approving, never left to a model.
- **A channel's `familyFriendlyOnly` switch** (default on) restricts the builder to
  words and clues tagged family friendly. Untagged counts as not.
- **Starting values.** Everything imported starts `pending` and untagged. The bank's
  existing adult / vulgar / offensive flags (3,778, 663 and 1,225 of the usable words)
  came from the 7B model, so they are shown as a warning on the word and pre-set the
  suggestion to "not family friendly"; they do not decide anything.
- **Who and when** are recorded on each decision, and an edit to an approved clue
  returns it to `pending`.
- This tag is not YouTube's "made for kids" setting. That stays off: it is a legal
  declaration about the audience, and it turns live chat off, which is how viewers play.

**The approval queue** (`/admin/crosswords/approve`) is where the work is done, because
the word detail page is too slow for hundreds of words:
- One word at a time, most common first, in the lengths the builder needs most. It
  shows the word, its definitions, any flags, and its candidate clues after `cleanClue`.
- The operator approves or rejects the word, approves, edits or rejects each clue, and
  ticks family friendly for the word and for each approved clue. Keyboard-driven, then
  on to the next.
- Filters: frequency band, length, starts-with, only words with suggestions.
- A counter shows the pool: approved words, family-friendly words, and how many
  puzzles that supports without a repeat (about 14 words a puzzle, 20 puzzles before a
  word may return, so about 300 approved words is the first target).

**Suggestions make it quicker, and are never approvals.** `crossword.suggest`
(operator-triggered for a batch of pending words, never on a schedule) sends each word's
definitions and candidate clues through `callOpenRouter` and stores, per word: one
polished clue of at most 48 characters for the most common sense, and a family-friendly
suggestion with a one-line reason. The queue shows them marked as suggestions, so
accepting is one key. Model: `CROSSWORD_MODEL`, falling back to `OPENROUTER_MODEL`.
The definitions are the facts; the model supplies the wording.

For a dev box only, `CROSSWORD_ALLOW_UNAPPROVED=true` lets the builder use pending words
with their cleaned stored clues, so the game can be run before anything is approved.

### 7.5 Stock

A repeatable `crossword.topUp` (every 30 minutes, staggered) builds one puzzle for each
enabled crossword channel whose unplayed stock is below `stockTarget` (6), as long as
the approved pool can supply one. It is also a button on `/admin/jobs`. When the pool
is too small for a new puzzle the channel replays, and the Desk says why.

## 8. Operator and admin

The aim (operator, 2026-10-04): weather channels and crossword channels administered
**together**, and all of the prototype's words admin brought across.

### 8.1 Channels: both kinds in one list

Today a channel is spread over four screens: `/admin/scenes` (list, create, delete),
`/admin/access` (tokened URLs), `/admin/streams` (encoders, slots, runs, go-live form)
and the home launcher (cards). All four list every channel record already, so a
crossword channel appears in each of them with no new screen. What changes:

| Screen | Change |
|---|---|
| `/admin/scenes` (Channels) | A **Type** chip on every row (Weather / Crossword) and a filter for it. The New channel form gets a type picker. Per row: the output link (`outputPath`), **Settings** (the weather settings page or the crossword one, §8.2), **Control** (`/control` or the crossword Desk, §8.3), the YouTube channel it goes out on, and **Go live** (§10) |
| `/admin/access` | The tokened URL is built with `outputPath`, so a crossword channel shows `/crossword/<id>?token=…`. Copy and Rotate are unchanged |
| `/admin/streams` | The channel picker shows the type. The bare encoder select becomes `EncoderSelect` (§10) |
| Home launcher (operator face) | A crossword card shows the puzzle and its progress ("Puzzle 42 · 7 of 14") where a weather card shows the director's now and next, with Desk / Output / Settings links |
| Public home | The same line on the public card; no operator links, as today |

### 8.2 Settings: one page per kind

The weather settings page (`/admin/scenes/:id`) is built for the globe: its cards, its
card catalog and its Save bar all stage `ControlState` and the director config. It is
left alone. Opened for a crossword channel, it sends the operator to the crossword one.

A crossword channel's settings live on **`/admin/crosswords/channels/:id`**, laid out
the same way (cards in groups, one Save bar, nothing live until Save):

| Group | Cards |
|---|---|
| Look | Brand title and logo; Music bed (the same generated bed the weather channels use) |
| Game | Pacing (clue time, hints, intro and finale lengths, the ceiling); Difficulty (`minZipf`); Puzzles (stock target, no-repeat window, **Family friendly only**); Chat and scoring (stream delay, rate limit); the On switch with Play off air |
| YouTube | **Which YouTube channel it goes out on** (§10), the title and description templates, the thumbnail |

The Look and Game cards save to the crossword config. The Music bed and YouTube cards
save to the channel record, in the same fields the weather cards use, so the streaming
code reads them unchanged.

### 8.3 Crosswords: words, puzzles, players, desk

A new admin section, `/admin/crosswords`, for what is shared across crossword channels
or is live operation. MUI admin theme, admin-only.

**Words** (`/admin/crosswords/words`, `/admin/crosswords/words/:id`): the prototype's
words admin, ported whole.
- List: search, starts-with letter, clue status (pending / done / rejected / failed),
  frequency band, accepted-only and review-only switches, sort by update, word, length
  or frequency, page size. Columns: word, length, status, part of speech, categories,
  flags, model, validation decision, frequency, clue count, reason.
- Totals above the list: by clue status, by validation decision, by frequency band.
  Cached for a minute, since each is a count over a million words.
- Detail: status, length, categories, senses and definitions, every clue with its
  difficulty and source, the validation verdict with what each source said, and the
  raw attempts and validation JSON.

The prototype's pages only read. Because these words now go to air, this plan adds
approval and the family-friendly tag (§7.4), for words and for clues (new work, not a
port):
- **List**: two more filters and columns, approval (pending / approved / rejected) and
  family friendly (yes / no / untagged), and the approved-pool counter.
- **Detail**: approve or reject the word and tick family friendly; approve, edit or
  reject each clue and tick family friendly on it; who decided and when. The bank's
  adult / vulgar / offensive flags show as warnings.
- **Suggest**: one model call for this word (a polished clue and a family-friendly
  suggestion). Operator-triggered only; nothing here touches the bank on a schedule.

**Approve** (`/admin/crosswords/approve`): the approval queue (§7.4), for doing the same
decisions quickly across many words.

**Puzzles** (`/admin/crosswords/puzzles`): the stock, with its family-friendly chip,
source and plays. Open one to see the grid with answers; each word links to its page in
Words. Reject removes a puzzle from play. Generate now builds one from the approved
pool.

**Players** (`/admin/crosswords/players`): totals per player; hide and unhide.

**Desk** (`/admin/crosswords/desk/:scene`): the live operation of one crossword channel,
the counterpart of `/control`. The board in small, Pause/Resume, Skip clue, Reveal word,
Next puzzle, Go live and End, and a **simulator** ("say as viewer": name and text). The
simulator is how the whole game is exercised before any stream exists. A simulated
message goes through the same handler as a YouTube one, marked `sim`, and is not
written to the chat log.

### 8.4 Routes

All under `public/src/app/api/crossword/`, all wrapped in `withApiLog`. Public holds no
game logic: it reads Mongo or enqueues a foreground job.

| Route | Gate | Does |
|---|---|---|
| `GET :scene/state` | channel token or admin | serves the stored `pub` projection |
| `POST :scene/sim` | admin | enqueues `crossword.inject` with a simulated message |
| `POST :scene/command` | admin | enqueues `crossword.inject` with pause, resume, skipClue, reveal or nextPuzzle |
| `GET`/`PATCH :scene/config` | admin | the scene's config; the runner re-reads it each tick |
| `GET words`, `GET words/:id` | admin | the ported list (with totals) and detail |
| `PATCH words/:id`, `PATCH clues/:id` | admin | approve, reject, edit, family-friendly tag |
| `GET approve/next` | admin | the next words for the approval queue, with their clues and suggestions |
| `POST suggest` | admin | enqueues `crossword.suggest` for one word or a batch |
| `GET puzzles`, `PATCH puzzles/:id` | admin | list, reject |
| `POST generate` | admin | enqueues `crossword.generate` |
| `GET players`, `PATCH players/:id` | admin | list, hide |

## 9. Data

| Collection | Facade | One per | Holds |
|---|---|---|---|
| broadcast states (existing) | — | channel | + `surface`, + `youtube.accountId` |
| `crosswordconfigs` | `db.crosswordConfig` | channel | enabled, `playOffAir`, the look (§5.1), pacing, difficulty, `familyFriendlyOnly`, limits |
| `crosswordpuzzles` | `db.crosswordPuzzles` | puzzle | §4.1 |
| `crosswordgames` | `db.crosswordGames` | scene | §4.2, including `pub` |
| `crosswordsolves` | `db.crosswordSolves` | solve | scene, puzzle, entry, player, points, time |
| `crosswordplayers` | `db.crosswordPlayers` | player | name, hidden, first and last seen |
| `crosswordbankwords` | `db.crosswordBank` (native) | word | the prototype's word document, plus `approval`, `familyFriendly` and any suggestion |
| `crosswordbankclues` | `db.crosswordBank` (native) | clue | the prototype's clue document, plus `approval`, `familyFriendly` and edits |

Plus `db.crosswordScenes()`. The game's own models and repos follow the existing typed
pattern (`short-script-model.ts` / `short-script-repo.ts`); the bank is the exception
(§7.2). `shared/src/db/index.ts` is being edited by the short-video work: add lines,
never rewrite. No blob namespaces.

Jobs: `crossword.inject` (foreground); `crossword.generate`, `crossword.topUp`,
`crossword.suggest` and `crossword.bankIndex` (background). The runner itself is not
a job.

## 10. Going live: which encoder, which YouTube channel

**Go live** sits on every row of the Channels list (§8.1) and on the crossword Desk. It
opens the run form with that channel filled in and posts the same `POST /api/streams` a
one-off run does. Weather channels get the same button.

**The encoder is picked, as for shorts.** No encoder is dedicated to crosswords and none
is added: there are several registered, and the picker shows what each is doing.
- The select is the short-video plan's `EncoderSelect` over its `encoderOccupancy`
  helper (free, live, held by a slot, booked, disabled). A live or held encoder cannot
  be chosen.
- `provisionEncoderScene` gains the `sceneId` override the short-video plan specifies,
  so the picked encoder shows the run's channel and goes back to its own when the run
  ends. `watchUrlForScene` builds the URL with `outputPath`, so a crossword run loads
  `/crossword/<id>?token=…`.
- Both pieces belong to short-video WP5, which is not built. Whichever plan reaches
  them first builds them, to that plan's spec, and the other reuses them.

**The YouTube channel is chosen, and never guessed** (operator, 2026-10-04).
- The crossword's YouTube channel is connected once on `/admin/youtube`, like the
  weather one.
- Each channel record stores the YouTube channel it goes out on:
  `youtube.accountId`, beside the title, description and thumbnail it already holds.
  It is set on the crossword settings page's YouTube card (§8.2) and shown on the
  channel's row in the Channels list.
- The Go live form preselects it and names it in the button: "Go live on <YouTube
  channel>". The operator can still change it for one run.
- **For a crossword channel there is no fallback.** With no YouTube channel stored or
  picked, go-live is refused with a message saying so. Today's fallback (the most
  recently connected account) stays for weather channels, which is how they work now.
- An account that needs reconnecting shows as such in the select and cannot be chosen.
- A different YouTube channel does not change the chat arithmetic in §6.1: the quota
  belongs to the Google Cloud project, and every channel connected through it shares
  it.

An always-on crossword stream stays possible later: a slot already stores an encoder
and an account, and the same pickers would choose them. It is not part of this plan.

`yarn seed:crossword-scene` creates the channel record only (surface `crossword`, music
bed on, chat on, no YouTube channel).

A crossword run with chat on is one more reader on the chat budget in §6.1, which is
one more reason the probe comes early.

## 11. Phases and work packages

Each package ships its own tests and leaves `./test` green. After any `shared/src` edit,
run `./update-shared`; never while another agent is testing.

### Who builds

Operator's instruction (2026-10-04): agents, not Fable; the model that suits the task;
a competent model for writing tests and for validation.

- **Fable plans and coordinates only.** It briefs each agent, keeps `shared/` frozen
  between packages, reads the validation reports and decides what happens next. No
  package is built on Fable.
- **Every package gets three passes, by three separate agents:**
  1. **Build**, on the model in the table below.
  2. **Tests, on Opus.** Written from this plan (§12 and the package's row), not from
     the code just written, so they test what was asked for. For the pure rules in WP1
     they are written first.
  3. **Validate, on Opus, in a fresh context.** Reads the plan and the diff, runs the
     package's tests and `./test`, checks the package against its row and against the
     house rules, and reports. It does not fix what it finds; the report goes back to a
     build agent. The agent that wrote the code never marks it.
- **Which model builds:**
  - **Opus** where a mistake is costly or the design is not obvious: the shared rules
    (a bug there leaks answers or mis-scores), the layout search, the host loop, and
    anything that touches the live chat poller, the run pipeline or OBS.
  - **Sonnet** where the work is building screens and routes to a clear spec: the
    output page, the ported words admin, the other admin pages, the suggest job.
  - **Haiku** only for mechanical chores inside a package (fixture data, the sources
    register entry). Never for code that ships, and never for tests.

### P0 — playable locally with the simulator (no YouTube; the LLM is optional)

| WP | Build model | Owns | Builds | Needs |
|---|---|---|---|---|
| 1 | Opus | `shared/src/crossword*.ts`, `shared/src/db/crossword-*`, the `surface`, `outputPath` and `youtube.accountId` lines in `control.ts`, `broadcast-state-model.ts`, `db/index.ts` | Types, `parseGuess`, numbering, scoring, hint schedule, spotlight pick, late credit, `toPublicState`, name cleaning, `cleanClue`, `validateClue`, the seed set, the game's models and repos, the bank repo (`listWords`, `getWordById`, the approval and family-friendly fields, the playable pick, the queue order), the crossword theme with its one preset, `surface`, `outputPath`, `youtube.accountId` | — |
| 2 | Opus | `worker/src/crossword/{layout,pick,build}.ts`, `worker/src/scripts/crossword*.ts` | `crossword:bank-index`, candidate pick from the approved pool, layout search, puzzle build (§7.3), `CROSSWORD_ALLOW_UNAPPROVED` for dev, `yarn crossword:build`, `yarn seed:crossword-scene`, the sources registered | 1 |
| 3 | Opus | `worker/src/crossword/{runner,inject,state}.ts`, the crossword lines in `worker/src/index.ts` | Host loop, persistence and resume, emit and beat, `crossword.inject` job | 1 |
| 4 | Sonnet | `public/src/app/crossword/`, `public/src/components/crossword/`, `public/src/lib/crossword.ts`, `api/crossword/[scene]/state` | The new tokened output page at `/crossword/:id`, its theme as CSS variables, the on-air components, solve effects, `useCrosswordState` (cold start + resync), `BroadcastBed` `pulseKey` | 1 |
| 5 | Sonnet | `public/src/app/admin/crosswords/{words,approve}/`, `public/src/components/admin/crosswords/words/`, `api/crossword/{words,clues,approve}` | The words admin, ported (list with filters and totals, detail), plus approval and the family-friendly tag on words and clues, and the approval queue (§7.4, §8.3) | 1 |
| 6 | Sonnet | `public/src/app/admin/crosswords/{puzzles,players,desk}/`, their components, the sim, command, puzzles and players routes | Puzzles (stock, family-friendly chip, reject, generate), Players and the Desk with its simulator and controls | 1 |
| 7 | Sonnet | `public/src/app/admin/scenes/page.tsx`, `admin/access`, `ChannelLauncher`, `PublicChannels`, `public/src/app/admin/crosswords/channels/`, `api/crossword/[scene]/config` | Both kinds in one list (§8.1): type chip, filter and picker, `outputPath` everywhere, the launcher and public cards. The crossword settings page (§8.2): Look with live preview, Game, YouTube with the channel pick, one Save bar. The one-line redirect from `/watch/<id>` and from the weather settings page for a crossword channel | 1 |

WP1 first, then freeze `shared/`. After that WP2 and WP3 can run together, and WP4 to
WP7 can run together (their folders do not overlap). The operator's import of the bank
(§7.2 step 1) comes before WP2's build or WP5's pages can be tried for real; their
tests use a small fixture.

**Milestone M0**: both kinds of channel show in the Channels list; the words admin
browses the imported bank; words and clues are approved and tagged in the queue; with
Play off air on, `/crossword/<id>` plays puzzles built from the approved pool on a
local box; the operator answers through the Desk's simulator
and takes words from the host; a worker restart mid-puzzle resumes it; the wire payload
has no unsolved answer in it.

### P1 — on YouTube

| WP | Build model | Builds | Needs |
|---|---|---|---|
| 8 | Opus | Chat hookup: `authorChannelId` through `ChatMessage` and the chat log, `crossword/chat.ts`, rate limit, players, today and all-time boards, `inputLive`, `:modes` skipped | M0 |
| 9 | Opus | The `streamList` probe script (§6.2). The operator runs it and reads the quota graph | — (can start now) |
| 10 | Opus | Chat transport: the stream reader if the probe passes, weighted pacing if not | 9 |
| 11 | Sonnet | Faster approval and stock: `crossword.suggest` through OpenRouter (polished clue and family-friendly suggestion, §7.4), suggestions in the queue, `crossword.generate` as a job, `crossword.topUp` | M0 |
| 12 | Opus | Going live (§10): the Go live dialog with the encoder picker and the YouTube channel pick on the Channels list and the Desk, no-fallback refusal for crossword channels, `watchUrlForScene` using `outputPath`, the OBS sweep matching `/crossword/`, the provision `sceneId` override and restore, low-latency preference on crossword broadcasts, title and description defaults | M0; shares `EncoderSelect`, `encoderOccupancy` and the override with short-video WP5 |

**Milestone M1**: an unlisted run on the TEST box, on an encoder and a YouTube channel
picked in the dialog, with real chat (WP8 and WP12).
**Launch gate**: answers land within about 10 seconds of being sent (WP10).

### P2 — depth

The build model for each of these is chosen when it is reached.

| WP | Builds |
|---|---|
| 13 | A bigger bank: import again after the prototype repo clears its review words and clues more of them; tidy the category slugs enough to theme straight from the bank |
| 14 | An as-run entry per puzzle, so chapters and the VOD page work |
| 15 | The host's voice and face: the prototype's phrase bank as feed lines, a solve chime and finale riser in the bed, then spoken clues and the animated presenter once the presenter plan's voice path exists |
| 16 | Themed puzzles (§7.3): model-proposed theme words checked against the bank, the theme list and `themeEvery` on the Game cards |
| 17 | A better look: more presets and the theme editor with a live preview (§5.1) |
| 18 | A second-screen play page off a QR code. It is a public write surface, so it needs its own abuse plan first |

## 12. Tests

- **shared**: `parseGuess` (refs, punctuation, long messages); numbering; scoring with
  crossings and stream delay; hint schedule; spotlight pick; late credit; name cleaning;
  `cleanClue` and `validateClue`; `toPublicState` leaks no unsolved letter; schema parity for
  `surface`.
- **shared (bank repo, against a small fixture)**: every list filter and sort, the three
  totals, the detail lookup, the approval and family-friendly writes with who and
  when, an edited approved clue returning to pending, the playable pick (approved word
  with an approved clue; both tagged on a family-friendly channel; untagged counts as
  not), the queue order.
- **worker**: the bank index CLI is idempotent; the build uses only approved words and
  clues, sets the puzzle's family-friendly flag, honours `minZipf` and the no-repeat
  window, and fails clearly when the pool is too small; a suggestion never changes an
  approval; layout places the seed set, is
  deterministic for a seed and yields;
  runner phase transitions on a fake clock; first answer wins; auto-reveal; the ceiling;
  resume from a stored game; next-puzzle choice and the no-repeat window; inject from
  the simulator writes no chat log; the suggest job with a mocked OpenRouter reply
  (good reply, bad JSON, a leaking clue dropped).
- **public**: the crossword page refuses a bad token; the weather watch page's tests
  pass unchanged; the theme becomes CSS variables; grid renders shown letters only;
  countdown from `serverNow`; state hook refetches on a `seq` gap; every route's gate;
  the words list builds its query from the filters; the Channels list, Access page and
  launcher use `outputPath`; the crossword settings page stages and saves both
  documents; Go live preselects the channel's YouTube channel and is refused for a
  crossword channel with none.
- **worker (going live)**: `watchUrlForScene` per kind; the OBS sweep treats a
  `/crossword/` source as ours.

## 13. Decisions taken, and questions for the operator

Decisions (change here if wrong). Those marked "operator" were given on 2026-10-04.
1. `/watch` is the weather product's. The crossword has its own tokened page,
   `/crossword/:id`, and its own theme (operator).
2. A crossword channel still keeps a channel record beside the weather ones
   (`surface: "crossword"`), because the streaming code finds a channel by that record.
3. Both kinds are administered from one Channels list (operator). Each kind has its own
   settings page, and the weather one is not changed.
4. The YouTube channel is stored per channel and chosen at go-live. A crossword channel
   never falls back to another account (operator).
5. The operator picks the encoder at go-live, as for shorts. No encoder is dedicated to
   crosswords (operator).
6. The whole February word bank is imported by the operator and kept; the prototype's
   words admin is ported in full (operator). The puzzle builder reads the bank directly.
7. The worker owns the game; public only draws it. The solution never goes on the wire.
8. Viewers answer with the bare word; a ref is optional.
9. The host solves what nobody answers, so the channel never stalls.
10. **Approval is required, for words and for clues** (operator). Nothing from the bank
    airs until a person has approved the word and a clue for it. A puzzle built from
    approved words and clues needs no approval of its own. A model may suggest, never
    approve.
11. **A family-friendly tag on words and on clues** (operator), set by the person
    approving. A channel's Family friendly only switch is on by default. It is not
    YouTube's "made for kids" setting, which stays off because it disables chat.
12. Difficulty comes from word frequency (`minZipf`), not the bank's stored clue
    difficulty.
13. Nothing touches the bank on a schedule. Suggestions are operator-triggered.
14. No chat replies; no avatars on air, names only.
15. The prototype's Python and GPU services stay in its own repo.
16. The crossword is joined to the weather product on the admin side only. It carries
    no weather content, and none is planned (operator). Puzzles are general knowledge;
    themed ones are optional later work.
17. The look is the prototype's for now, as one preset; a better one is later work
    (operator: it looks poor, use it for now).
18. The music is the same generated bed the weather channels use (operator).

Still to settle:
1. **Family friendly only, on by default.** The plan turns it on for every new crossword
   channel, so only tagged words and clues are used. Say if it should start off.
2. **The committed `.env` files in `../crosswords`** (`.env` on both branches, and
   `ai-services/.env` on `0.1`) are pushed to its remote. The root one holds five
   provider keys. They should be rotated whether or not this plan goes ahead.
