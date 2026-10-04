# Presenter (spoken narration) — plan

> **Status: PROPOSED** (2026-10-04, revised the same day to put round-ups first).
> Nothing built. Replaces the memory-only "presenter LLM" sketch that
> [short-video-plan.md](./short-video-plan.md),
> [chat-interaction-plan.md](./done/chat-interaction-plan.md) and
> [streaming-runs-plan.md](./streaming-runs-plan.md) point at.
> Everything goes through OpenRouter: the script model and the speech model.
> Order: round-up settings (schedule, wording, preview), then the voice audition, then
> round-ups on air from saved audio, then written event lines. Open decisions for the
> operator are in §13.
>
> **Built 2026-10-04: the round-up schedule only** (the "what and when" half of §2.2–2.4).
> `db.roundupSettings` holds `enabled` + `hours` per round-up; the slot rule is in
> `shared/src/roundup-schedule.ts`; one hourly `summaries.tick` replaced the three crons;
> the place jobs read the same settings; a Schedule card sits at the top of
> `/admin/summaries` and `/admin/place-roundups`. The six env names in §2.3 are retired,
> so §2.1 now describes the state before this. Where it differs from the text below:
> no `model` / `maxWords` yet, the card is not a Settings tab, and how long a round-up
> may air is worked out from the slots when the director reads it (`roundupStaleAfterMs`)
> instead of being stamped on the round-up as `airUntil`. Not built: the hourly's
> coverage window (open decision 2), the prompt registry, previews, anything voice.

Give the stream a voice. A presenter is a named persona with a voice. It turns what is
on air (a warning, an earthquake, a country check, a round-up) into a short spoken
line.

The work starts with the round-ups, because the voice does. A round-up is the one thing
on the channel that a model already writes, on a schedule, as prose for an anchor to
read, and the presenter will read it as written (§7). So before anything is spoken the
operator needs three things about a round-up in admin: when it is made, how it is
worded and how long it runs. Today all three are fixed in env and code (§2.1). The
voice audition comes second and is tried on those round-ups. Lines that a model has to
write close to the cut come last.

## 1. What exists and what doesn't

- Written prose exists. Five worker modules call `callOpenRouter`
  (`worker/src/lib/openrouter.ts`), each with its prompt written in code: the global
  round-up, its roll-up, the place round-ups, the volcano report parser and the alert
  translator. None of those prompts can be edited without a deploy.
- Nothing is spoken. There is no text-to-speech code in any package.
- OpenRouter has a speech endpoint (checked 2026-10-04):
  `POST /api/v1/audio/speech` with `{ model, input, voice, response_format: "mp3" | "pcm", speed }`.
  The response is the audio bytes, with the generation id in an `X-Generation-Id` header.
  `GET /api/v1/models?output_modalities=speech` lists the speech models with their
  voices (`supported_voices`) and prices. It listed 23 models when checked.
- The music bed is a Web Audio graph on `/watch` (`public/src/lib/audio/`). OBS already
  captures it, so audio from the page reaches the stream. The bed has a sidechain that
  ducks to the kick; nothing ducks it for a voice yet.
- A `Segment` already carries what a line would be written from: title, subtitle,
  detail rows, `quake { mag, depthKm }`, `hazard`, and for a round-up spin the stored
  narrative. Warnings carry `AlertNarrative` (description, instruction, areas). Place
  round-ups store `summary`, `stateOfPlay`, per-city outlooks and `advice`.
- The round-up spin already sizes its hold from a narration length
  (`SUMMARY_WORDS_PER_MIN = 170` in `worker/src/director/builders.ts`).
- Round-ups are generated on a schedule, ahead of when they air (§2.1). Each job
  announces a finished round-up on the socket.
- A global round-up rides the `global` spin and carries its narrative on the segment.
  A country or region cut does not carry its round-up; `/watch` fetches that through
  the focus bundle.
- The director reads its own per-channel `DirectorConfig`. It does not read the
  channel's broadcast-state document.
- The director's `upNext` is a best guess, not a promise, so it cannot be relied on to
  prepare the next line ahead of time (§10.4).
- Per-channel settings live on `/admin/scenes/:id` as cards that stage into one Save.
  Shared catalogs (widgets, slides, director presets, ads) are defined once and
  channels reference them.

## 2. Round-ups first

### 2.1 Today

Five round-ups are made:

| Round-up | Made at | Schedule set by | Wording set by |
|---|---|---|---|
| Global hourly | every hour | `SUMMARY_HOURLY_CRON` | `worker/src/summaries/openrouter.ts` |
| Global 12-hour, a roll-up of the hourlies | 00 and 12 UTC | `SUMMARY_12H_CRON` | `worker/src/summaries/rollup.ts` |
| Global daily | 00 UTC | `SUMMARY_DAILY_CRON` | the hourly's prompt |
| Country, for countries switched on at `/countries` | 06 and 18 local time | an hourly cron and `PLACE_ROUNDUP_TARGET_HOURS` | `worker/src/placeRoundups/openrouter.ts` |
| Region, all but `world` | 06 and 18 local time | the same | the same |

- The schedule is read once, when the worker starts. Changing it means editing env and
  restarting the worker.
- The wording and the length need a deploy. The length is "2–3 tight paragraphs" with a
  cap of 700 tokens for a global round-up, which is up to about three minutes of
  speech. The model is one env value (`OPENROUTER_MODEL`) shared by all five.
- `/admin/summaries` and `/admin/place-roundups` show the latest round-up, what it was
  written from, the history and a "Generate now" button. That button is the only way
  to try anything, and it is not a preview: it makes a real round-up, which joins the
  history, is handed to the next one as the previous round-up, and can go to air. For
  places it makes the whole set.
- The real lengths have not been measured (the dev database was not running when this
  was written). The preview in §2.6 reports them.

### 2.2 Settings

One settings document covers all five round-ups. It is not per channel: a round-up is
made once and every channel airs the same one.

```ts
// shared/src/roundup-settings.ts
export type RoundupId = "global-hourly" | "global-12h" | "global-daily" | "place-country" | "place-region";

export interface RoundupSetting {
  enabled: boolean;
  hours: number[];        // slots, whole hours 0..23. Global: UTC. Place: local time at the place.
  model: string | null;   // null = OPENROUTER_MODEL
  maxWords: number;       // target length; fills {{maxWords}} and sets the token cap
}
export type RoundupSettings = Record<RoundupId, RoundupSetting>;
export const DEFAULT_ROUNDUP_SETTINGS: RoundupSettings;
```

`db.roundupSettings` holds one document. With no document the defaults are in force,
and the defaults are today's behaviour. The wording is not stored here; it lives in the
prompt registry (§4).

### 2.3 The schedule

One rule for all five: a round-up has **slots**, which are whole hours of the day, and
an hourly tick asks whether the current slot has been served.

- Global slots are UTC hours. Place slots are local hours at the place.
- Defaults: hourly has all 24 slots, 12-hour has 00 and 12, daily has 00, places have
  06 and 18.
- **Due** means nothing has been generated since the current slot began, and the slot
  began less than three hours ago. Three hours is the catch-up the place jobs already
  allow for a worker restart. A manual run inside a slot serves it.
- The place jobs already work this way: an hourly cron and `isPlaceDue`. The global
  jobs change to match. One hourly `summaries.tick` replaces the three crons and runs
  whichever of the three are due, in the order hourly, 12-hour, daily. Today they are
  three jobs at three hashed minutes: the 12-hour at :10, the hourly at :11 and the
  daily at :14. So the roll-up is written a minute before that hour's hourly exists.
- The rule is a set of pure functions in `shared/src/roundup-schedule.ts` (current
  slot, due, next slot, gap to the following slot). The worker uses them to decide and
  the page uses them to show the next run, so the two cannot disagree. The whole-hour
  offset from longitude is already in `shared/src/time/local-zone.ts`.
- An edit takes effect at the next tick, so within the hour. Nothing is restarted and
  no queue schedule is re-registered. "Generate now" still makes one at once and
  ignores the schedule.
- The minute within the hour stays in code (the global tick between :02 and :14,
  countries at :20, regions at :40). It keeps these jobs apart from each other and
  from the weather ingest. The operator edits hours, not minutes.
- `SUMMARY_HOURLY_CRON`, `SUMMARY_12H_CRON`, `SUMMARY_DAILY_CRON`,
  `PLACE_ROUNDUP_TARGET_HOURS`, `PLACE_ROUNDUP_CATCHUP_HOURS` and
  `PLACE_ROUNDUP_MIN_GAP_HOURS` are retired. `SUMMARIES_ENABLED` and
  `PLACE_ROUNDUPS_ENABLED` stay as the deployment's kill switch: off there is off
  whatever the page says, and the page says so.
- The local hour still comes from the longitude estimate, with no daylight saving.
  Cities now carry a real timezone, so a country's capital could supply the zone later.
  Not in this phase.

The other way to do it is to re-register the queue's cron schedules when the operator
saves. That needs an apply step between public and the worker that can fail and leave
the page and the queue disagreeing, and it puts cron expressions in front of the
operator. Whole-hour slots need neither.

The editor is a table with one row per round-up: on or off, a strip of 24 hours to
tick, the next run, the last run and its status, runs a day, and tokens a day worked
out from the usage already stored on each round-up. For the place rows, runs a day is
slots times places. Once the voice exists the same row shows characters of speech a
day, because the schedule is what sets the speech bill (§10.2).

### 2.4 What assumes today's schedule

Each of these is fixed in code and goes wrong quietly once the slots can move:

| Assumption | Where | Change |
|---|---|---|
| The hourly round-up covers one hour | `WINDOW_HOURS` in `summaries/aggregate.ts` | it covers the time since its previous slot |
| The last twelve hourlies span twelve hours | `ROLLUP_HOURS` in `jobs/summaries.ts`, which takes twelve documents | take the hourlies generated in the last 12 hours |
| There are hourlies to roll up | `generate12hRollup` | with none, write the 12-hour from the current snapshot, as the daily is |
| A place's previous round-up was "12 hours ago" | the prompt in `placeRoundups/openrouter.ts`; `WINDOW_HOURS = 12` in `placeRoundups/aggregate.ts` | state the real gap |
| A place fires at most every 11 hours | `MIN_GAP_HOURS` in `placeRoundups/localTime.ts` | replaced by the slot-served rule; 11 hours would block a third slot in a day |
| A round-up may air for 3 hours, 36 hours or 3 days | `SUMMARY_PERIODS.staleAfterMs` in `director/builders.ts`, also read by short videos in `director/script-template.ts` | three slot gaps, stamped on the round-up as `airUntil` when it is made |
| "Hourly round-up" on air; "12-hour AI round-ups" and "local ~6am/6pm" in admin | `director/builders.ts`, `shared/src/jobs.ts`, the admin pages | derived from the settings, or reworded so they stay true |

At the default slots every one of these gives the same result as today. The 12-hour
and the daily keep their fixed look-back of 12 and 24 hours; moving their slots changes
when they are made, not what they cover.

### 2.5 Wording and length

The presenter reads a round-up as it is stored (§7), so the place to shape what is
spoken is the round-up's own prompt. That is why these prompts become editable before
any voice exists.

The editable text goes in the prompt registry (§4):

| Prompt id | Used by | Today |
|---|---|---|
| `roundup.system` | all five | three near-identical "newsroom writer" lines |
| `roundup.global` | hourly and daily | the instructions in `summaries/openrouter.ts` |
| `roundup.global.rollup` | 12-hour | the instructions in `summaries/rollup.ts` |
| `roundup.place` | country and region | the instructions and the four section descriptions in `placeRoundups/openrouter.ts` |

- Code keeps the parts an edit must not be able to break: the facts-only rule, the
  facts JSON, the conditional lines (previous round-up, region framing, area colour)
  and, for places, the reply's JSON keys, because the parser depends on them. The
  editor shows these around the editable text, read-only, so the operator sees the
  whole prompt as it is sent.
- `maxWords` replaces "2–3 tight paragraphs" and sets the token cap. The page shows it
  as speaking time at 150 words a minute. Once round-ups are spoken this is the main
  dial for how long a round-up holds the channel, because the hold stretches to the
  audio (§10.2).
- The default texts start as today's wording, unchanged. Rewording them for the ear
  (no bracketed figures, no runs of numbers) is the operator's first edit, tried in
  the preview.

### 2.6 Preview

A preview runs the **draft** on the settings tab (unsaved wording, model and length)
against the current data: the same aggregation, the same prompt builder, one model
call.

- A preview is not a round-up. It is stored as a preview document (§8), never in the
  round-up collections. It cannot go to air, it is not in the history, and the next
  round-up is not told it happened. It does read the real previous round-up, as a
  scheduled run would.
- The page shows the draft result beside the latest live round-up: the text, word
  count, speaking time, tokens, latency, model, and the exact prompt and facts sent.
- The number guard (§7) runs on the result and reports numbers it cannot find in the
  facts. On a round-up it only reports. A figure the model worked out, such as a
  previous count from a delta, will show as unknown.
- A place preview is for one place, picked on the page. The place jobs also learn to
  generate one place, so a Save can be followed by a real round-up for that place
  without making the whole set.
- When the voice path exists (§12, WP6), every preview and every stored round-up gets
  "Hear it", which speaks that text in a chosen voice.
- Save applies the draft from the next scheduled run.

### 2.7 Pages

`/admin/summaries` and `/admin/place-roundups` each gain a Settings tab: the schedule
rows for that page's round-ups, the wording editor with its revisions, length, model,
Preview and one Save for the tab. Both use the same components
(`public/src/components/admin/roundups/`).

Which places get a round-up stays where it is: the switch on `/countries`, and every
region except `world`.

## 3. One copy of everything

The risk with putting prompt editing on the channel page is that each channel ends up
holding its own copy of the same prompt, and they drift. The rule that prevents it:

**A channel never stores prompt text. It stores a presenter id and a few switches.**

| Thing | Where it lives | Edited on | Copies |
|---|---|---|---|
| Round-up schedule, length, model | `db.roundupSettings` | the round-up pages' Settings tab | one |
| Round-up wording | prompt registry | the same tab | one per prompt in §2.5 |
| House rules (facts only, units, length) | prompt registry | `/admin/presenters/prompts` | one |
| Kind brief (how to cover a quake, a warning, …) | prompt registry | `/admin/presenters/prompts` | one per kind |
| Persona and voice | presenter catalog | `/admin/presenters/:id` | one per presenter |
| Which presenter, which kinds, volume | `ControlState.presenter` | `/admin/scenes/:id` | one per channel, no text |

Changing a brief changes it for every presenter and every channel at once. A presenter
can override one kind's brief when its character needs it; the override is stored on
the presenter and marked as an override in the editor, and removing it returns to the
shared brief. Two channels that want a different voice use two presenters, not two
copies of one.

The same rule applies to content. A round-up already has stored prose that is shown on
screen. The presenter reads that prose (§7) instead of writing a second version of it.

## 4. The prompt registry

One registry for prompts, with the defaults in code and only the edits in Mongo. The
round-up prompts (§2.5) are its first entries. The presenter's house rules and kind
briefs join it in the event-line phase.

```ts
// shared/src/prompts.ts
export interface PromptDef {
  id: string;            // "roundup.global", "presenter.house", "presenter.line.quake"
  label: string;
  group: string;         // "Round-ups", "Presenter"
  help: string;          // what this prompt controls, shown in the editor
  vars: readonly string[]; // placeholders it may use, e.g. ["maxWords", "place"]
  default: string;
}
export const PROMPTS: readonly PromptDef[];

// db.prompts: one doc per EDITED prompt. No doc means the default is in force.
export interface PromptOverride { id: string; text: string; rev: number; updatedBy: string }
export function resolvePrompt(id, override?): { text: string; rev: number; isDefault: boolean };
```

- A new prompt ships working, because its default is in code. "Reset to default"
  deletes the override.
- Every save bumps `rev` and appends the old text to `db.promptRevisions` (who, when,
  text). Revert loads an old revision into the editor; nothing changes until Save.
- The facts are never part of the editable text. Code appends the facts JSON after the
  brief, so an edit cannot remove the facts or the "use only these facts" contract.

What is sent for a round-up:

```
system = roundup.system
user   = the round-up's prompt (with {{maxWords}} etc. filled in) + the lines code adds + facts JSON
```

What is sent for one presenter line:

```
system = house rules + persona
user   = kind brief (with {{maxWords}} etc. filled in) + facts JSON
```

## 5. The presenter

```ts
// shared/src/presenter.ts
export type LineKind = "storm" | "quake" | "volcano" | "country" | "region" | "global" | "intro";

export interface PresenterVoice {
  model: string;          // OpenRouter speech model id
  voice: string | null;   // one of the model's supported_voices, or a provider voice id
  speed: number;          // 1 = normal
  style: string | null;   // delivery note in plain words: "calm, measured, late-night desk"
  options: Record<string, unknown> | null; // provider options, passed through as given
}

export interface Presenter {
  id: string;             // slug
  name: string;           // "Night desk"
  persona: string;        // who they are and how they talk
  voice: PresenterVoice;
  scriptModel: string | null;                 // null = OPENROUTER_MODEL
  briefs: Partial<Record<LineKind, string>>;  // overrides only; absent = shared brief
  delivery: Partial<Record<LineKind, Partial<PresenterVoice>>>; // overrides only; absent = `voice`
  rev: number;            // bumps on any change that alters output
}
```

`db.presenters` holds them. One seeded default presenter means a channel can be
switched on without visiting the editor. Reading a round-up needs only the name and
the voice, so `persona` and `briefs` exist from the start but are not used until the
event-line phase. `LineKind` starts with the kinds that have
facts worth saying; flights, ships, ocean, orbital and ads can be added as entries.

### 5.1 Voice properties

Every property of the voice is editable on the presenter's page, and every one can be
changed in the bench and heard before it is saved.

- **Model, voice, speed** are sent as OpenRouter's own fields.
- **Style** is one plain-language field. How it reaches the model depends on the model,
  so the worker holds a small traits table (`worker/src/presenter/voice-traits.ts`)
  keyed by model id:
  - Gemini speech models take it as a provider option (`speech_metadata.style`).
  - Fish Audio models take it as natural-language tags in the text.
  - Voxtral and CSM put the manner in the voice id itself (`en_paul_neutral`,
    `en_paul_sad`, `read_speech_a`), so for them the style is the choice of voice.
  - A model with no entry gets speed only, and the editor says the style is not sent.
- **Options** is the raw provider-options object for anything the typed fields do not
  cover. It is an advanced field, shown collapsed.
- **Delivery per kind.** A warning can be read differently from a round-up. `delivery`
  holds per-kind overrides of any voice property, stored as overrides only, the same
  way `briefs` works. For models where the manner is in the voice id, this is how a
  warning gets the serious voice.

OpenRouter does not report which properties a model honours: `supported_parameters`
is empty for all 23 speech models. The bench is how that is found out. What is learned
goes into the traits table, so the editor only offers what a model will act on.

Voice properties live on the presenter and nowhere else. "Use this voice" on a bench
take copies its properties into the presenter draft.

## 6. Voices and what they cost

The voice catalog is read from OpenRouter by the worker and cached in Mongo
(`db.presenterVoices`), refreshed daily and from `/admin/jobs`. Nothing is hard-coded,
because the list changes. Public reads the cache and never calls OpenRouter.

Prices on 2026-10-04. "Per hour" is an hour of new speech at about 15 characters a
second (150 words a minute):

| Model | Voices | Price | Per hour of speech |
|---|---|---|---|
| `hexgrad/kokoro-82m` | 54 | $0.62 / M chars | $0.03 |
| `canopylabs/orpheus-3b-0.1-ft`, `sesame/csm-1b` | 7 each | $7 / M chars | $0.38 |
| `x-ai/grok-voice-tts-1.0` | 5 | $15 / M chars | $0.81 |
| `microsoft/mai-voice-2.1-flash` | 97 | $15 / M chars | $0.81 |
| `mistralai/voxtral-mini-tts-2603` | 30 | $16 / M chars | $0.86 |
| `microsoft/mai-voice-2.1` | 97 | $22 / M chars | $1.19 |
| `deepgram/aura-2` | 90 | $30 / M chars | $1.62 |
| `deepgram/flux-tts` | 36 | $45 / M chars | $2.43 |
| `minimax/speech-2.8-turbo` / `-hd` | 45 | $60 / $100 / M chars | $3.24 / $5.40 |
| `bytedance-seed/seed-audio-1-0` | none listed | $0.0025 / second | $9.00 |
| `google/gemini-3.8-flash-tts` and two siblings | 30 | per token | measure in the bench |
| `fish-audio/*` (one free variant) | none listed, takes a reference voice | $15 / M bytes | about $0.81 |

The range is 40 to 1, so the voice choice is a money decision as much as a taste one.
The script model costs little next to the voice: a line is a few hundred tokens on the
default `openai/gpt-4o-mini`.

Speech models differ in how they take style direction. §5.1 covers how the voice
properties are edited and sent.

## 7. Facts and safety

**Facts come from the pipeline. The model supplies the wording.**

- `worker/src/presenter/facts.ts` builds the facts for a subject `{ kind, id }` from
  Mongo: the same documents the on-air cards are built from. One builder per kind.
  The preview and the on-air path call the same builders.
- A warning's name in the facts is the phrasebook label (`broadcastEventLabel`), never
  the source's `event` string. That rule already holds for every on-air surface.
- **Number guard.** Every number in the script must appear in the facts. A script that
  fails is retried once, then dropped. A dropped line means silence, not a guess. The
  preview shows the guard's verdict and the offending numbers. On a round-up the guard
  only reports (§2.6).
- **`speakable(text)`** in shared rewrites text for the ear before it is sent to the
  speech model: `km/h`, `°C`, `mm`, `hPa`, `M5.6`, `UTC`, flags and emoji. It is
  deterministic and unit-tested, so pronunciation does not depend on the speech model.
- **Read or write.** Each kind is either written from facts or read from stored prose:
  - `storm`, `quake`, `volcano`, `intro`: written.
  - `global`: reads the stored round-up narrative.
  - `country`, `region`: reads the place round-up `summary` when one exists, otherwise
    written from the area-weather facts.
  Reading costs no script call and keeps the spoken words identical to the words on
  screen. What a read kind says is shaped in the round-up's own prompt (§2.5).
- English only in v1.

## 8. Previews

A preview is where a prompt or a voice is tried before it is saved. It runs the
**draft** in the editor, not the saved text, so nothing has to be saved to try it.

Three kinds, in the order they are built:

1. **Round-up preview** (§2.6). The draft round-up wording, model and length, run
   against the current data. Text only at first; "Hear it" arrives with the voice path.
2. **Voice preview.** Typed or sample text, spoken by one or more takes. A take is a
   full set of voice properties (model, voice, speed, style, options), so the same
   words can be heard in different voices or in one voice at different settings, side
   by side. Sample text comes from the latest global and place round-ups.
3. **Line preview.** Pick a real subject (an active warning, a recent quake, a volcano,
   a country, a region, or "what is on air now on channel X"). The worker builds the
   facts, writes the script with the draft prompts, runs the number guard, and speaks
   it.

Each preview is a stored document, so earlier takes stay on the page for comparison:

```ts
// shared/src/preview.ts
export interface Preview {
  id: string;
  kind: "roundup" | "voice" | "line";
  status: "queued" | "writing" | "speaking" | "ready" | "error";
  error?: string;
  subject?: { type: RoundupId | LineKind; id: string; label: string }; // for a place round-up, id is the place
  presenterId?: string;
  draft: { system?: string; brief?: string; model?: string; maxWords?: number;
           persona?: string; voice?: PresenterVoice };
  prompt?: { system: string; user: string }; // exactly what was sent
  facts?: unknown;                           // exactly what the model was given
  script?: { text: string; words: number; model: string; promptTokens?: number;
             completionTokens?: number; latencyMs: number;
             guard: { ok: boolean; unknownNumbers: string[] } };
  audio?: { contentType: string; bytes: number; chars: number; latencyMs: number;
            generationId?: string; estCostUsd?: number };
  createdBy: string;
}
```

Flow: the route writes the preview as `queued` and enqueues `previews.run` on the
foreground queue. The worker does the script and speech calls, stores any mp3 in the
blob store under the preview id, and emits `preview:updated` so the page updates.
The page shows the facts, the script, the guard verdict, latency, estimated cost and,
when there is audio, a player. The latency numbers matter: they decide how §10.4 times
the voice.

Routes, all under `/api/admin` and so admin-gated by `proxy.ts`:

| Route | Does |
|---|---|
| `GET` `PUT /api/admin/roundup-settings` | the round-up settings document |
| `GET` `PUT` `DELETE /api/admin/prompts[/:id]` | prompt overrides and revisions |
| `GET` `POST /api/admin/previews`, `DELETE …/:id` | list, create, delete |
| `GET /api/admin/previews/:id/audio` | the mp3 |
| `GET /api/admin/presenter/voices` | the cached voice catalog |
| `GET` `PUT` `DELETE /api/admin/presenters[/:id]` | presenter catalog |

Pages:

- `/admin/summaries`, `/admin/place-roundups`: the Settings tab with the round-up
  preview (§2.7).
- `/admin/presenters`: the presenter list and the voice bench.
- `/admin/presenters/:id`: persona, voice properties, script model, per-kind brief and
  delivery overrides, with the line bench beside the form. One Save for the page.
- `/admin/presenters/prompts`: house rules and the shared kind briefs, with the same
  bench.

## 9. The channel card

A "Presenter" card in the Presentation group of `/admin/scenes/:id`, next to Music bed.

```ts
// shared/src/control.ts
export interface PresenterSettings {
  enabled: boolean;
  presenterId: string | null;
  kindsOff: LineKind[];   // empty = every kind speaks
  volume: number;         // 0..1
  duckDb: number;         // how far the music drops under the voice
}
```

- It stages the whole `presenter` object through the page's Save, like every other card.
- It holds no prompt text. It shows the presenter's name and voice, with a link to the
  presenter's page.
- `enabled` is the channel's on switch. Both sides read it: the worker to decide
  whether to make audio and put a voice on a cut, `/watch` to decide whether to play
  it. After a Save that turns it on, the next sweep (§10.2) makes the audio for the
  current round-ups, so the channel does not wait for the next round-up cycle.
- The card lists the round-ups that have saved audio for this channel's presenter,
  each with a play button, so the operator can hear what will air.
- "Hear this channel" runs a line preview for whatever that channel has on air. It
  arrives with the line bench.
- A new `ControlState` field needs the usual three edits: `control.ts`,
  `broadcast-state-model.ts` and the parity test, plus the card's `catalog.ts` entry.

## 10. On air

Round-ups go to air first. They are generated on a schedule, so their audio can be
made when the round-up is made, saved, and played when the round-up comes on. Nothing
is generated in the cut path for them. Event lines (warnings, quakes, volcanoes) come
later, because they have to be written and voiced close to the cut.

### 10.1 Turning it on

Three switches, all of which must be on for a channel to speak:

- `PRESENTER_ENABLED` in the worker's environment. Off means no audio is generated and
  no cut carries a voice, on any channel.
- The channel's Presenter card (§9): on, with a presenter chosen.
- The kind is not in the channel's `kindsOff`.

With no channel switched on, nothing is generated and nothing is spent.

### 10.2 Round-ups: generate, save, play

What is read:

| On air | Source | Text | Default schedule (§2.3) |
|---|---|---|---|
| `global` round-up spin | `EventSummary` | `narrative` | hourly, 12-hourly and daily: 27 a day |
| `country`, `region` spotlight | place round-up | `summary` | twice a day per place |

**Generate and save.** A `presenter.prepare` job turns round-up text into saved audio:
`speakable(text)`, one speech call, the mp3 into the blob store, and a
`db.presenterLines` document that records what was said, in which voice, how long it
runs and what it cost.

- It runs after each round-up job finishes, and as a sweep every few minutes. The
  sweep is what covers a channel being switched on, a presenter's voice being changed,
  and a failed attempt. It only makes what is missing, so it can run as often as it
  likes.
- It makes audio for the latest round-ups only, and only for presenters that a
  switched-on channel uses.
- A saved line is keyed by a hash of the voice properties and the text. The same text
  in the same voice is never paid for twice, and editing a presenter's voice makes
  the old audio stop matching, so new audio is made.
- The speech call is separate from the round-up job. A speech failure never fails or
  delays the round-up itself.
- The duration is read from the mp3's frame headers. There is no ffmpeg in the project.

**Play when it gets on.** When the director builds a `global`, `country` or `region`
cut for a channel, it looks up the saved line for that round-up and that channel's
presenter. The director does not read the channel's broadcast-state document today;
this adds that one read.

- Found: the cut carries `Segment.voice { audioId, durationMs, text }`, the way
  `trackInfo` and `ad` ride the segment, and the hold is stretched to at least the
  audio's length plus a lead-in and a tail. The round-up spin already sizes its hold
  from a narration estimate, so this replaces an estimate with the real figure. The
  60-second cap on a round-up with no tour stops does not cut a voiced one short.
- Not found: the cut airs without a voice. Nothing is generated at the cut.
- **A fresh round-up waits for its voice.** Each round-up airs once before it repeats,
  so the first airing is the one that matters. On a channel with the presenter on, a
  round-up whose audio is not saved yet is held back for up to two minutes, then airs
  silent if the audio still is not there.
- A country with no round-up has nothing to read, so it stays silent until written
  lines exist (§10.4).

**What it costs.** The spend is set by the round-up schedule, not by how often a
round-up airs. At the default slots there are 27 global round-ups a day. Assuming about
1,200 characters each, that is about 32,000 characters: roughly $0.50 a day at $15 per
million characters, and two cents on the cheapest model. Each place adds about 500
characters a day. Unticking hourly slots or lowering `maxWords` cuts it directly, and
the schedule table (§2.3) shows the figure. The previews will show the real lengths.

### 10.3 Playback on `/watch`

- `/watch` plays `Segment.voice` through a voice bus and ducks the music by the
  channel's `duckDb` while it speaks. It works with the music bed switched off.
- The voice starts a moment after the cut. A page that loads mid-shot joins the audio
  where it should be, or skips it when little is left.
- A public `GET /api/presenter/audio/:id` serves the mp3 with an immutable cache.
  `/watch` is not an admin page, so this route cannot sit under `/api/admin`.
- The bed's resume hardening (OBS loading the page before its audio output is ready)
  is shared with the voice.
- Later: the on-screen narrative scrolls over the audio's duration, so the words on
  screen keep pace with the voice.

### 10.4 Event lines (later)

Warnings, quakes and volcanoes are written from facts (§7) and voiced near the cut.

- **One function.** `lineFor(subject, presenter)` returns `{ text, audioId, durationMs }`
  and saves into the same `db.presenterLines`. Break-ins, chat replies and short-video
  narration call it too.
- **Cache.** The director rotates through a pool, so the same subject comes round
  again unchanged and costs nothing the second time. Channels that share a presenter
  share the saved lines.
- **Timing.** A line that is not saved is generated at the cut, and the voice starts
  when the audio is ready. If it is not ready in time, or the rest of the shot cannot
  fit it, the line is skipped. Lines for the pool's top candidates can be prepared in
  the background. The bench's latency figures set the deadline.
- **Budget.** A daily character budget per channel, metered in Redis like the YouTube
  quota. When it is spent the presenter goes quiet and the admin page says why. The
  same meter covers the round-up audio.
- **Shot length.** Whether an event line may extend its shot is open (§13). It ties
  into the shot-budget question in
  [deck-scroll-pacing-plan.md](./deck-scroll-pacing-plan.md).

## 11. Storage and retention

- Audio goes in the shared blob store under a new `presenter-audio` namespace. It has
  to be added to `BLOB_NAMESPACES` and to `createDb` so `/admin/files` reports it.
- Previews are pruned after 14 days. A saved line is pruned once it has not aired for
  7 days and its round-up is no longer the latest. Both by a maintenance job with a
  dry-run twin, following [blob-retention-plan.md](./blob-retention-plan.md).
- Rough size: a 15-second mp3 is on the order of 100 KB, and a 90-second round-up
  several hundred.

## 12. Work packages

Each is sized for one hand-off, as in the short-video plan. After any `shared/src` edit
run `./update-shared`. Every package ends with `./test` green. The worker needs a
restart by the operator after WP2, WP5, WP8 and WP11.

`shared/src/db/index.ts` is being edited by the short-video work. WP1, WP4, WP7 and
WP10 add lines to it and must not rewrite it.

| WP | Phase | Scope | Depends on | Done when |
|---|---|---|---|---|
| 1 | P0 round-up settings | Shared: `roundup-settings.ts` (types, defaults, sanitiser), `roundup-schedule.ts` (slot, due, next run, gap), the prompt registry with the round-up defaults lifted from the worker, `db.prompts`, `db.promptRevisions`, `db.roundupSettings`, the `Preview` type with `db.previews`, the number guard, `airUntil` on `EventSummary` | none | due and next-run, and resolve, override, reset and revert, are unit-tested; the defaults give today's slots and today's prompt text |
| 2 | P0 | Worker: `summaries.tick` in place of the three crons, the place jobs reading the settings and taking a single place, the slot-served rule, the §2.4 changes, the prompt builders taking registry text, `maxWords` and model, `previews.run` for round-up previews | 1 | with no settings document and no overrides, what is made and what is sent to the model match today; moving a slot changes what the next tick makes; a preview returns text and writes no round-up |
| 3 | P0 | Public: the settings, prompts and previews routes, the Settings tab on both round-up pages (schedule table, wording editor with revisions, length, model, preview beside the live round-up, Save) | 1, 2 | an operator moves a slot, edits the wording, previews it unsaved, saves and reverts, with no deploy and no restart |
| 4 | P1 voice audition | Shared: `presenter.ts` (voice type, sanitisers, cost estimate), `speakable()`, the voice-catalog model and repo, the blob namespace, `/admin/jobs` entry | 1 | helpers unit-tested; a voice preview round-trips through Mongo with its audio |
| 5 | P1 | Worker: `lib/openrouter-speech.ts` (speech call and model list, same retry rules as `openrouter.ts`), `presenter/voice-traits.ts` (how each model takes style), `jobs/presenter.ts` (`refreshVoices`), voice previews in `previews.run`, one-shot CLIs to refresh voices and speak a sentence | 4 | mocked-fetch tests pass; a real sentence comes back as a playable mp3 |
| 6 | P1 | Public: the voices route, `/admin/presenters` with the voice bench (every voice property editable per take), "Hear it" on round-up previews and stored round-ups, launcher card | 3, 4, 5 | an operator hears the latest round-up, and a draft of one, in several voices and settings and sees what each cost |
| 7 | P2 round-ups on air | Shared: `Presenter` model and repo with a seeded default, `ControlState.presenter`, `Segment.voice`, `db.presenterLines` (saved lines), the line key hash, the mp3 duration helper | 4 | a presenter and a saved line round-trip through Mongo; the schema parity test covers `presenter` |
| 8 | P2 | Worker: `presenter/line.ts` (text to saved audio), `presenter.prepare` after each round-up job and as a sweep, the director's lookup and `Segment.voice` on `global`, `country` and `region` cuts, the stretched hold, the fresh round-up wait, `PRESENTER_ENABLED`, the character meter, the prune job | 2, 5, 7 | with a channel on, a new round-up has saved audio within a minute and its cut carries the voice; with every channel off, no speech call is made |
| 9 | P2 | Public: `/admin/presenters/:id` (name and voice properties, with the voice bench), the Presenter card on the channel page, the voice bus and ducking on `/watch`, the public audio route, the saved-lines list, speech characters a day on the schedule table | 6, 7, 8 | an operator switches a channel on and the round-up is heard in OBS over a ducked bed |
| 10 | P3 event lines | Shared: the presenter's house rules and kind briefs in the registry | 1, 7 | the briefs resolve with a presenter's overrides applied |
| 11 | P3 | Worker: `presenter/facts.ts` (one builder per kind), `presenter/write.ts` (compose, call, guard, retry), line previews using the draft, written lines for `storm`, `quake`, `volcano` and for a country with no round-up, generation at the cut, background preparation, the deadline | 8, 10 | a line preview for each kind returns facts, script, verdict and audio; a cut carries a voice within the deadline or carries none |
| 12 | P3 | Public: persona and per-kind overrides on the presenter page, `/admin/presenters/prompts`, the line bench, "Hear this channel", spend, saved-line hit rate and skip reasons | 9, 10, 11 | a brief is edited, previewed unsaved, saved and reverted; the page explains why the presenter did or did not speak |
| 13 | later | Break-in lines, chat replies, short-video narration track, other languages | 11 | separate plans |

WP1 to WP3 are useful with no voice at all: the round-up schedule and wording become
the operator's. WP4 and WP5 need only WP1, so they can run alongside WP2 and WP3; the
two lines meet at WP6. WP7 to WP9 put a voice on air without a model writing a word
for it.

## 13. Decisions

Made here, say if any is wrong:

1. Round-ups come first: their schedule, wording and length are editable and
   previewable before any voice exists.
2. Round-up settings are global, one document. They are not per channel.
3. A schedule is whole-hour slots checked by an hourly tick. There are no cron
   expressions in admin, and an edit applies within the hour.
4. A preview is never a round-up. It cannot air and is not fed to the next round-up.
5. Presenters and prompts are shared catalogs. A channel references a presenter and
   stores no prompt text.
6. Prompts are a code default plus an optional stored override, with revisions.
7. The facts block is appended by code and cannot be edited away.
8. Previews run the draft, not the saved text.
9. Round-ups are read from their stored prose, not rewritten for speech. What is
   spoken is shaped in the round-up's own prompt.
10. All model calls happen in the worker through OpenRouter. Public reads Mongo and
    serves audio.
11. A line that fails the number guard is dropped. Silence is the fallback. On a
    round-up the guard only reports.
12. Voice properties (model, voice, speed, style, options) are edited on the presenter
    and can be overridden per kind. They are not stored on a channel.
13. Round-ups air first. Their audio is generated when the round-up is, saved, and
    played when it comes on. Nothing is generated at the cut for them.
14. No audio is generated unless a channel has the presenter switched on.
15. A round-up's hold stretches to fit its audio.

Open, for the operator:

1. **Whole hours.** Is picking hours enough, or does any round-up need a minute past
   the hour?
2. **A thinned hourly.** With hourly slots unticked, the round-up is proposed to cover
   the whole gap since its previous slot. The other option keeps it a one-hour
   snapshot whatever the gap.
3. **One set of local hours.** Proposed: one set for all countries and one for all
   regions. The other option is hours per place.
4. **Per-presenter brief overrides.** Proposed: allowed, stored as overrides only.
   The stricter option is shared briefs only, with persona the only per-presenter text.
5. **Budget.** A daily spend per channel. It decides which rows of the §6 table are
   usable for an always-on channel.
6. **Shot length for event lines.** May a written line extend the shot it is on, or
   must it always fit? Round-ups are settled: the hold stretches.
7. **How much of a place round-up is read.** Proposed: the `summary` only, one or two
   sentences. The longer option adds the state of play.
8. **Captions.** Should the spoken text of an event line also appear on screen? A
   round-up's text is already on screen.
9. **How many presenters at launch.** One house voice, or several (per channel, or
   day and night desks).
