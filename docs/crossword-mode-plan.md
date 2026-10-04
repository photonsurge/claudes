# Crossword channel — plan

> **Status: P0 BUILT** (2026-10-04), not yet tried against a real database or the
> imported bank; see §14 for what was built and what still needs checking.
> Planned on Fable; the work packages
> in §11 are sized to hand to Opus sub-agents one at a time, as with
> [short-video-plan.md](./short-video-plan.md).
> Source material: the February prototype, now checked in at `crosswords/` (§1).
> Shares the chat seam with [chat-interaction-plan.md](./done/chat-interaction-plan.md) (§6.4).
> Open questions for the operator are in §13.
> Revised the same day on the operator's direction: the encoder is picked at go-live
> (§10); the February word bank is imported whole and its words admin ported (§7.2,
> §8.3); a crossword channel gets its own tokened watch page (§3); and both kinds of
> channel are administered together (§8).

A crossword channel is a scene with its own watch page, showing a crossword game where
the other channels show the globe. The worker hosts the game. It lays out a puzzle, puts one clue
in the spotlight at a time, leaks hint letters, and finally fills the answer in itself,
so a puzzle always finishes even with nobody watching. Viewers answer in YouTube chat;
the first correct answer takes the word and its points.

Everything around the game is reused: scenes and watch tokens, the encoder registry,
runs, go-live announcements, the theme tokens and the music bed. The operator starts a
crossword stream on an encoder they pick, as for shorts (§10).

Three terms used throughout:
- **Surface**: which kind of channel a scene is, `globe` or `crossword`. The code says
  "surface" because "mode" already means three things here (director mode, audio mode,
  and the map looks the `:modes` chat command lists).
- **Host**: the worker's game loop. It is also the name credited when nobody solves a word.
- **Stock**: the puzzles that are built, approved and waiting to be played.

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
| OBS pages (`/obs`, `/obs/chat`, `/obs/scoreboard`, `/obs/presenter`: four separate browser sources, no token) | **Replaced** by one tokened watch page (§3, §5). This app provisions one full-canvas source per encoder. |
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

## 3. A crossword channel is a scene with its own watch page

```ts
// shared/src/control.ts
export type SceneSurface = "globe" | "crossword";
export interface SceneMeta { /* …existing… */ surface: SceneSurface }
/** "/watch/<id>" for a globe channel, "/watch/crossword/<id>" for a crossword one. */
export function watchPath(scene: { id: string; surface?: SceneSurface }): string;
```

- **Still a scene.** A crossword channel is a scene document, so it has a name, a watch
  token, a theme, a music bed, YouTube settings, runs and an encoder like any other
  channel. That is what lets both kinds be administered together (§8).
- **`surface`** says which kind it is. It is scene metadata, stored the way `hidden` is,
  not a `ControlState` field. Add it to `BroadcastStateSchema` (strict Mongoose drops
  unknown keys), to the `listScenes` projection and to `createScene`'s options. Missing
  means `globe`, so no migration. The main scene is always `globe`.
- **A new watch page** (operator's call, 2026-10-04): `/watch/crossword/:id?token=…`, in
  `public/src/app/watch/crossword/[scene]/page.tsx`. The weather page
  (`watch/[scene]/page.tsx`) is not touched, so nothing here can break it, and a
  crossword channel never loads deck.gl or MapLibre.
- **Tokened like the weather one.** It uses the scene's `watchToken` through the same
  `useSceneState` fetch, and the crossword state route checks the same token. Rotating
  on `/admin/access` works for both kinds.
- **Under `/watch/` on purpose.** `proxy.ts` leaves `/watch/**` ungated for OBS, the OBS
  sweep recognises "one of ours" with `isWatchUrl` (`^/watch/`), and any server rule
  keyed on `/watch` keeps applying.
- **`watchPath` is the one place that knows the mapping.** The Channels list, the Access
  page, the home launcher and the worker's `watchUrlForScene` all call it.
- A crossword scene opened on the globe route, or the reverse, redirects to its own page.
- A crossword scene uses `broadcastTheme`, `themeOverrides`, `audio`, `chat` and
  `youtube` from its `ControlState` and ignores the rest. Its director config stays `off`.

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
  fires the riser. A solve chime is later work (§11 WP15).

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

So the bank supplies the **words**, and each puzzle's clues are polished when it is
built (§7.3).

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
   pick (decision, status, length, frequency); on clues `answerId`. It is run by the
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

Job `crossword.generate` (`{ sceneId, theme? }`), background queue:

1. **Pick candidates.** About 60 random words from the bank that are *playable*:
   accepted, with clues, unflagged, 3–12 letters, not a name, place or proper noun, not
   rejected by the operator, at or above the scene's `minZipf` (default 3.5, which
   leaves about 5,800 words of 4–9 letters), and not used in the scene's last 20
   puzzles. A spread of lengths. Seeded, so a build is repeatable.
2. **Lay out** (§7.1). 12–16 words are placed.
3. **Choose each clue**, in this order:
   - a clue the operator has **approved** for that word (§8.3): used as it is, no model;
   - otherwise **polish**: one `callOpenRouter` call covering the remaining placed
     words. For each it sends the definitions and the candidate clues and asks for one
     clue of at most 48 characters, for the word's most common sense, not containing
     the answer: the best candidate, or a new one written from the definitions. The
     definitions are the facts; the model supplies the wording. Model:
     `CROSSWORD_MODEL`, falling back to `OPENROUTER_MODEL`. A polished clue is saved
     back to the bank as a new candidate, so the operator can approve it and the next
     puzzle need not ask again;
   - with no OpenRouter key, the best stored clue after `cleanClue`.
4. **Validate.** `cleanClue` strips a trailing "(N)". `validateClue` rejects a clue under
   8 or over 48 characters, one that contains the answer or the answer with a common
   ending removed, and one that hits the blocklist (a built-in list plus the
   operator's own). A rejected clue falls back to the word's best stored clue. A word
   left with no usable clue is dropped and the grid is laid out again without it. Fewer
   than `minWords` and the build fails.
5. **Store** the puzzle as `draft`, or `ready` under auto-approve (§7.4).

One model call a puzzle at most, which should be well under a cent at the default
model; confirm from the first real calls.

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

The aim (operator, 2026-10-04): weather channels and crossword channels administered
**together**, and all of the prototype's words admin brought across.

### 8.1 Channels: both kinds in one place

Today a channel is spread over four screens: `/admin/scenes` (list, create, delete),
`/admin/access` (tokened URLs), `/admin/streams` (encoders, slots, runs, go-live form)
and the home launcher (cards). All four list every scene already, so a crossword scene
appears in each of them with no new screen. What changes:

| Screen | Change |
|---|---|
| `/admin/scenes` (Channels) | A **Type** chip on every row (Weather / Crossword) and a filter for it. The New channel form gets a type picker. The Watch link uses `watchPath`. The Control link goes to `/control` for a weather channel and to the crossword desk (§8.3) for a crossword one. Each row gains **Go live** (§10) |
| `/admin/access` | The tokened URL is built with `watchPath`, so a crossword channel shows `/watch/crossword/<id>?token=…`. Copy and Rotate are unchanged |
| `/admin/streams` | The scene picker shows the type. The bare encoder select becomes `EncoderSelect` (§10) |
| Home launcher (operator face) | A crossword card shows the puzzle and its progress ("Puzzle 42 · 7 of 14") where a weather card shows the director's now and next, with Desk / Watch / Settings links |
| Public home | The same line on the public card; no operator links, as today |

### 8.2 One settings page per channel, cards by type

`/admin/scenes/:id` stays the settings page for every channel. Its card catalog learns
which type each card applies to (`SettingsCardDef.surfaces`):

- **Both types**: brand and theme, music bed, YouTube, about.
- **Weather only**: widgets, report, slides, ticker, camera, pace, director.
- **Crossword only**, a new "Game" group: Pacing (clue time, hints, intro and finale
  lengths, the ceiling), Difficulty and themes (`minZipf`, the theme list,
  `themeEvery`), Puzzles (stock target, auto-approve, no-repeat window), Chat and
  scoring (stream delay, rate limit), and the On switch with Play off air.

The crossword cards stage into the same Save bar. `SceneDraft` gains a third bucket
beside `control` and `director`: `stageCrossword`, saved by `PATCH
/api/crossword/:scene/config`. Nothing is live until Save, as for every other card.

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

The prototype's pages only read. Because these words now go to air, the detail page adds
the decisions (new work, not a port):
- **Word**: Accept, Reject or Review (writes the validation decision, marked as the
  operator's), and the adult / vulgar / offensive flags.
- **Clue**: Approve, Reject or Edit. An approved clue is used as it is and skips the
  model (§7.3). A rejected clue is never picked.
- **Write clues**: one model call for this word, adding candidates. Operator-triggered
  only; nothing here enriches the bank on a schedule.

**Puzzles** (`/admin/crosswords/puzzles`): the stock, with status, theme, source and
plays. Open one to see the grid with answers, edit a clue, drop a word (which re-lays
the grid), approve or reject. Generate now, with an optional theme. Each word links to
its page in Words.

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
| `GET :scene/state` | watch token or admin | serves the stored `pub` projection |
| `POST :scene/sim` | admin | enqueues `crossword.inject` with a simulated message |
| `POST :scene/command` | admin | enqueues `crossword.inject` with pause, resume, skipClue, reveal or nextPuzzle |
| `GET`/`PATCH :scene/config` | admin | the scene's config; the runner re-reads it each tick |
| `GET words`, `GET words/:id` | admin | the ported list (with totals) and detail |
| `PATCH words/:id`, `PATCH clues/:id` | admin | the word and clue decisions |
| `POST words/:id/clues` | admin | enqueues `crossword.writeClues` for one word |
| `GET puzzles`, `PATCH puzzles/:id` | admin | list, edit, approve, reject |
| `POST generate` | admin | enqueues `crossword.generate` |
| `GET players`, `PATCH players/:id` | admin | list, hide |

## 9. Data

| Collection | Facade | One per | Holds |
|---|---|---|---|
| broadcast states (existing) | — | scene | + `surface` |
| `crosswordconfigs` | `db.crosswordConfig` | scene | enabled, `playOffAir`, pacing, difficulty, themes, limits |
| `crosswordpuzzles` | `db.crosswordPuzzles` | puzzle | §4.1 |
| `crosswordgames` | `db.crosswordGames` | scene | §4.2, including `pub` |
| `crosswordsolves` | `db.crosswordSolves` | solve | scene, puzzle, entry, player, points, time |
| `crosswordplayers` | `db.crosswordPlayers` | player | name, hidden, first and last seen |
| `crosswordbankwords` | `db.crosswordBank` (native) | word | the prototype's word document, plus the operator's decision |
| `crosswordbankclues` | `db.crosswordBank` (native) | clue | the prototype's clue document, plus `status` (candidate / approved / rejected) and edits |

Plus `db.crosswordScenes()`. The game's own models and repos follow the existing typed
pattern (`short-script-model.ts` / `short-script-repo.ts`); the bank is the exception
(§7.2). `shared/src/db/index.ts` is being edited by the short-video work: add lines,
never rewrite. No blob namespaces.

Jobs: `crossword.inject` (foreground); `crossword.generate`, `crossword.topUp`,
`crossword.writeClues` and `crossword.bankIndex` (background). The runner itself is not
a job.

## 10. Streaming

**The operator picks the encoder at go-live, as for shorts.** No encoder is dedicated
to crosswords and none is added: there are several registered, and the picker shows
what each is doing so a busy one is never taken.

- **Go live** sits on every row of the Channels list (§8.1) and on the crossword Desk.
  It opens the run form with that channel filled in: encoder, YouTube channel, privacy,
  title, and a duration or open-ended. It posts the same `POST /api/streams` a one-off
  run does, with `encoderId` set. Weather channels get the same button.
- The encoder select is the short-video plan's `EncoderSelect` over its
  `encoderOccupancy` helper (free, live, held by a slot, booked, disabled). A live or
  held encoder cannot be chosen.
- `provisionEncoderScene` gains the `sceneId` override the short-video plan specifies,
  so the picked encoder shows the run's channel and goes back to its own scene when the
  run ends. `watchUrlForScene` builds the URL with `watchPath`, so a crossword run
  loads `/watch/crossword/<id>?token=…`.
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
| 1 | `shared/src/crossword*.ts`, `shared/src/db/crossword-*`, the `surface` and `watchPath` lines in `control.ts`, `broadcast-state-model.ts`, `db/index.ts` | Types, `parseGuess`, numbering, scoring, hint schedule, spotlight pick, late credit, `toPublicState`, name cleaning, `cleanClue`, `validateClue`, the seed set, the game's models and repos, the bank repo (`listWords`, `getWordById`, the pick), `surface`, `watchPath` | — |
| 2 | `worker/src/crossword/{layout,pick,build}.ts`, `worker/src/scripts/crossword*.ts` | `crossword:bank-index`, candidate pick, layout search, puzzle build with stored clues (§7.3 without the model), `yarn crossword:build`, `yarn seed:crossword-scene`, the sources registered | 1 |
| 3 | `worker/src/crossword/{runner,inject,state}.ts`, the crossword lines in `worker/src/index.ts` | Host loop, persistence and resume, emit and beat, `crossword.inject` job | 1 |
| 4 | `public/src/app/watch/crossword/`, `public/src/components/crossword/`, `public/src/lib/crossword.ts`, `api/crossword/[scene]/state` | The new tokened watch page, the on-air components, solve effects, `useCrosswordState` (cold start + resync), `BroadcastBed` `pulseKey`, the redirect between the two watch routes | 1 |
| 5 | `public/src/app/admin/crosswords/words/`, `public/src/components/admin/crosswords/words/`, `api/crossword/words` | The words admin, ported: list with filters and totals, detail (§8.3). Read-only in this package | 1 |
| 6 | `public/src/app/admin/crosswords/{puzzles,players,desk}/`, their components, the sim, command, puzzles and players routes | Puzzles, Players and the Desk with its simulator and controls | 1 |
| 7 | `public/src/app/admin/scenes/`, `admin/access`, `ChannelLauncher`, `PublicChannels`, `components/admin/scenes/{catalog,SceneDraft}` and the new Game cards, `api/crossword/[scene]/config` | Both kinds together (§8.1, §8.2): type on the Channels list and New form, `watchPath` everywhere, cards by type, the crossword bucket in the Save bar, the launcher and public cards | 1 |

WP1 first, then freeze `shared/`. After that WP2 and WP3 can run together, and WP4 to
WP7 can run together (their folders do not overlap). The operator's import of the bank
(§7.2 step 1) comes before WP2's build or WP5's pages can be tried for real; their
tests use a small fixture.

**Milestone M0**: both kinds of channel show in the Channels list; the words admin
browses the imported bank; with Play off air on, `/watch/crossword/<id>` plays puzzles
built from the bank on a local box; the operator answers through the Desk's simulator
and takes words from the host; a worker restart mid-puzzle resumes it; the wire payload
has no unsolved answer in it.

### P1 — on YouTube

| WP | Builds | Needs |
|---|---|---|
| 8 | Chat hookup: `authorChannelId` through `ChatMessage` and the chat log, `crossword/chat.ts`, rate limit, players, today and all-time boards, `inputLive`, `:modes` skipped | M0 |
| 9 | The `streamList` probe script (§6.2). The operator runs it and reads the quota graph | — (can start now) |
| 10 | Chat transport: the stream reader if the probe passes, weighted pacing if not | 9 |
| 11 | Clues for air: the word and clue decisions on the Words detail page, `crossword.writeClues`, clue polish through OpenRouter (§7.3 step 3), themed puzzles, `crossword.generate` as a job, `crossword.topUp`, the review flow on the Puzzles tab | M0 |
| 12 | Going live (§10): the Go live dialog with the encoder picker on the Channels list and the Desk, `watchUrlForScene` using `watchPath`, the provision `sceneId` override and restore, low-latency preference on crossword broadcasts, title and description defaults | M0; shares `EncoderSelect`, `encoderOccupancy` and the override with short-video WP5 |

**Milestone M1**: an unlisted run on the TEST box, on an encoder picked in the dialog,
with real chat (WP8 and WP12).
**Launch gate**: answers land within about 10 seconds of being sent (WP10).

### P2 — depth

| WP | Builds |
|---|---|
| 13 | A bigger bank: import again after the prototype repo clears its review words and clues more of them; tidy the category slugs enough to theme straight from the bank |
| 14 | An as-run entry per puzzle, so chapters and the VOD page work |
| 15 | The host's voice and face: the prototype's phrase bank as feed lines, a solve chime and finale riser in the bed, then spoken clues and the animated presenter once the presenter plan's voice path exists |
| 16 | Puzzles themed from the pipeline's own facts (today's warnings, quakes, named storms): facts from Mongo, wording from the model |
| 17 | A second-screen play page off a QR code. It is a public write surface, so it needs its own abuse plan first |

## 12. Tests

- **shared**: `parseGuess` (refs, punctuation, long messages); numbering; scoring with
  crossings and stream delay; hint schedule; spotlight pick; late credit; name cleaning;
  `cleanClue` and `validateClue`; `toPublicState` leaks no unsolved letter; schema parity for
  `surface`.
- **shared (bank repo, against a small fixture)**: every list filter and sort, the three
  totals, the detail lookup, the playable pick, the word and clue decisions.
- **worker**: the bank index CLI is idempotent; the candidate pick honours `minZipf`,
  operator rejections and the no-repeat window; an approved clue is used without a model
  call; a polished clue is saved back as a candidate; layout places the seed set, is
  deterministic for a seed and yields;
  runner phase transitions on a fake clock; first answer wins; auto-reveal; the ceiling;
  resume from a stored game; next-puzzle choice and the no-repeat window; inject from
  the simulator writes no chat log; the generate job with a mocked OpenRouter reply
  (good clues, bad JSON, a leaking clue falling back to the stored one, too few
  survivors) and with no key at all.
- **public**: the crossword watch page refuses a bad token and redirects a globe scene;
  the weather watch page's tests pass unchanged; grid renders shown letters only;
  countdown from `serverNow`; state hook refetches on a `seq` gap; every route's gate;
  the words list builds its query from the filters; the Channels list, Access page and
  launcher use `watchPath`; the catalog shows cards by type; the Game cards stage into
  the Save bar.

## 13. Decisions taken, and questions for the operator

Decisions (change here if wrong):
1. A crossword channel is a scene with `surface: "crossword"`, so it shares tokens,
   runs, encoders and settings with weather channels.
2. It has its own tokened watch page, `/watch/crossword/:id`. The weather watch page is
   not touched (operator, 2026-10-04).
3. Both kinds are administered together: one Channels list, one settings page with
   cards by type, one Save bar (operator, 2026-10-04).
4. The worker owns the game; public only draws it. The solution never goes on the wire.
5. Viewers answer with the bare word; a ref is optional.
6. The host solves what nobody answers, so the channel never stalls.
7. The operator picks the encoder at go-live, as for shorts. No encoder is dedicated to
   crosswords (operator, 2026-10-04).
8. The whole February word bank is imported by the operator and kept; the prototype's
   words admin is ported in full (operator, 2026-10-04). The puzzle builder reads the
   bank directly.
9. Stored clues are candidates. A clue reaches air by operator approval or by a model
   polish from the word's definitions; raw stored clues air only with no LLM key on a
   dev box.
10. Difficulty comes from word frequency (`minZipf`), not the bank's stored clue
    difficulty.
11. Nothing enriches the bank on a schedule. Writing clues is operator-triggered.
12. No chat replies; no avatars on air, names only.
13. The prototype's Python and GPU services stay in its own repo.

Questions:
1. **Subject matter.** The bank is general vocabulary, so the plan makes general
   puzzles the default and on-brand themed ones (weather, earth, space, geography) an
   every-so-often special written with a model's help. Is that the right mix, or should
   the channel be themed only?
2. **Auto-approve**: is starting behind review and switching to auto once the clues are
   trusted acceptable, given the channel will replay puzzles until then?
3. **Word decisions on the Words page.** The prototype's words pages only read. This
   plan adds accept / reject and clue approve / edit, because the words now go to air.
   Wanted from the start (it sits in P1, WP11), or is browsing enough for now?
4. **The committed `.env` files in `../crosswords`** (`.env` on both branches, and
   `ai-services/.env` on `0.1`) are pushed to its remote. The root one holds five
   provider keys. They should be rotated whether or not this plan goes ahead.

## 14. Progress

### P0 (WP1–WP7): built 2026-10-04

All seven packages are in, each with its tests. Not yet run against a real Mongo, a
real imported bank or a real frame, so M0 is not signed off.

Where the build differs from the plan, or needs the operator:
- **Bank fields follow the prototype's pipeline.** The prototype source is now in this
  repo at `crosswords/`. `BANK_WORD_FIELDS` / `BANK_CLUE_FIELDS` in
  `shared/src/crossword-bank.ts` match what `python/words-tools` writes: the decision is
  `"accepted"` / `"review"` / `"reject"`, the Zipf score is
  `validation.sources.wordfreq.zipf`, categories are `categorySlugs`, proper nouns are
  pos `proper-noun`, a clue's `source` is `{ name, ref, createdBy }`, and the clue count
  is counted from the clues collection (it is not stored on the word). The Wiktionary
  definitions (`raw.definitions`) show on the Words detail page and go to the builder.
  Still worth one look at a real imported document after the import.
- **The seed set is the prototype's `data.json`** (37 space words), uppercased.
- **Spotlight tie-break**: most letters showing, then the longest word, then the lowest
  number. §4.4's "ties to the lowest number" would contradict "the first pick is the
  longest word", so length breaks ties first.
- **Clue leak test**: a clue word that starts with the answer or its stem leaks it, and so
  does an answer of 5+ letters anywhere in the clue's letters. Plain substring matching
  rejected fair clues for short answers ("plants" for ANT).
- **Job tiers**: `crossword` jobs run on the background tier; `crossword.inject` is sent
  to foreground explicitly (`sendToFore`) by the Desk routes.
- **Stored clue choice (no model)**: an approved clue that validates; otherwise the
  stored clue nearest 30 characters. Words with no usable clue are dropped and the grid
  re-laid once. In P0 a theme only sets the title.
- **Layout** measures about 4 ms an attempt on 60 words, so it stays in-process.
- **Dropping a word** on the Puzzles page does not re-lay the grid (public has no layout
  code): the word is removed, the grid trimmed and renumbered, and the drop is refused
  if the grid splits, falls under `minWords`, or the puzzle is on air.
- **Top-up** skips a scene whose drafts already reach `stockTarget` while auto-approve is
  off, so drafts do not pile up every half hour. `CROSSWORD_TOP_UP=off` pauses it.
- **Restart**: a game resumes mid-puzzle unless its live run started after the last
  save, which counts as a go-live. Answers are ignored while paused or parked.
- **"Chat commands" settings card** shows on both kinds of channel, because its Monitor
  chat switch is how a crossword gets answers.
- **Public home card**: the puzzle line needs the state route, which is gated by watch
  token or admin, so anonymous visitors see no puzzle line yet. Needs an ungated,
  reduced read if wanted.
- **Licences** in `external-sources-register.md` for the word sources were written from
  memory; confirm the versions the prototype used.
