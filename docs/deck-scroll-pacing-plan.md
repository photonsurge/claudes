# Decks: pace the slide change off the motion inside the card — plan

> **Status: SHIPPED** (2026-09-13) — both decks are run-paced. `slideRuns` /
> `reportRuns` in `ControlState`, `run-pacing.tsx` (the shared clock),
> `AutoScroll` counting scroll passes, `WorldFeed` counting marquee laps, and the
> *Runs through* control on `/admin/scenes/:id` + `/control`. All four packages'
> tests green. The one part NOT built is the shot budget (phase 4 below) — see
> **What is still open** at the end. Written after reading
> [SlideDeck.tsx](../public/src/components/broadcast/SlideDeck.tsx),
> [AutoScroll.tsx](../public/src/components/broadcast/AutoScroll.tsx),
> [BroadcastCard.tsx](../public/src/components/broadcast/BroadcastCard.tsx) and the
> director's per-kind shot holds.

Both on-air decks run **two unrelated clocks each**. The deck advances on a
fixed dwell; the motion inside the card (a body scroll on the left, a feed
marquee on the right) runs at a pace derived from its own content. Neither knows
the other exists, so the swap lands wherever it lands. This plan ties them
together: **the motion owns the clock, and the dwell becomes derived rather than
set.**

The two decks are not the same animal, though, and the difference decides how
much the tie actually buys — see the comparison below.

## Where we are today

| Clock | Owner | Derived from | Default |
| --- | --- | --- | --- |
| Slide change | `SlideDeck` `setInterval` | nothing — a constant | `slideHoldMs` 16 s (range 6–40 s) |
| Body scroll | `AutoScroll` rAF loop | content px + chars + `readPaceCps` | ~11–19 px/s typical |

`AutoScroll`'s cycle is `holdTop(1600 ms) → down → holdBottom(1600 ms) → up(1.7×)`,
looping forever. `SlideDeck` cross-fades (`FADE_MS` 1200 ms) on its own interval.

Three failure modes fall straight out of that:

1. **Cut mid-scroll.** A dense slide is still travelling when the deck swaps; the
   tail is never seen.
2. **Dead air.** A slide that fits sits motionless for the full dwell.
3. **The re-read.** A slide whose cycle lands just under the dwell shows its tail,
   glides back to the top, and starts reading again for a second or two before the
   swap — which is the worst of the three, because it looks like a stutter.

## The thing to look at first: the shot is shorter than the dwell

Director shot holds (`DEFAULT_KIND_HOLD_SECONDS` and friends in
[shared/src/director.ts](../shared/src/director.ts)):

| Shot | Hold |
| --- | --- |
| quake (micro → great) | 8–30 s |
| storm (info → extreme) | 10–24 s |
| country / region / flight / ship | 12 s |
| volcano (unrest / erupting) | 14 / 22 s |
| world spins (intro, global, ocean, orbital) | 17 s |
| country/region **tours** | stops × (flight + 40 s) |

`segment.holdMs` is the whole shot, not a step within it. So at the 16 s default
dwell a typical 12 s shot airs **exactly one slide** — the pinned `onair` lede —
and every other slide `modeSlides` composed is never seen. Only tour shots run
long enough to rotate at all.

Worked example of a dense slide, to size the problem. The template body window is
about 340 px (`CARD_H` 415 minus the title bar and padding; the `scale(1.2)` is a
transform, so layout px are unchanged). A 900 px-tall body of 1 200 characters at
the default 15 cps gives `scrollPxPerSec = 15 × 900 / 1200 ≈ 11 px/s`, over
560 px of overflow — **~50 s of travel, ~53 s for a full pass.** Against a 12 s
shot.

So the arithmetic already says the deck is over-stuffed relative to its airtime.
Tying the two clocks together is right, but it will surface that as a visible
truth rather than a silent truncation — which is the point. The levers are then
longer shots, lighter slides, or a faster reading pace, and the operator gets to
pick. Do **not** solve it by scrolling faster than the reading pace — see
`docs`-adjacent rule in the reading-pace module: every surface derives from
`readPaceCps`, nothing gets a hand-tuned px/s.

## The two decks differ, and it matters

| | Left `SlideDeck` | Top-right `WorldReportDeck` |
| --- | --- | --- |
| Rotation clock | `slideHoldMs`, default 16 s (6–40 s) | `reportHoldMs`, default **6 s** (3–30 s) |
| Reset | `resetKey = onAirSegment.id` — rewound at **every director cut** | never resets, free-running |
| Time budget | the shot's `holdMs`, 8–30 s | **none** |
| Content | per-segment (`modeSlides`) | the global `worldWatch` tally |
| Motion inside the card | `AutoScroll` body scroll | `MarqueeFeed` row window at `feedRowMs`; the card itself never scrolls |

The consequence is that the same fix lands very differently on each side.

**Left — the dwell is not really the bug.** The director rewinds the deck every
12 s or so. Even a perfectly scroll-tied dwell cannot show six slides inside a
12 s shot. Tying the clocks is necessary but not sufficient there; the budget
work in phase 3 is where it actually gets solved, and what it mostly produces is
an honest number to take to the operator.

**Right — it is purely a pacing bug, and the cleanest win in this plan.** A
category slide holds 6 s while its `MarqueeFeed` steps one row every
`feedRowMs` (clamped 1.2–8 s). A 20-row feed at ~3 s a row needs a **60 s lap**
to show every row once. The slide flips after about two of them. Rows 3 through
20 are never seen by anyone, on any channel, ever. No director, no budget, no
reset — the tie just works here.

Note the one thread that does cross: the right deck's *timing* is
director-independent but its *content* is not entirely. `BroadcastFrame` feeds it
`areaKind` / `areaName` / `targetLocation` off `onAirSegment`, so the hourly
slide's cities change under it at a cut. With a lap-tied advance that invalidates
a pass in flight, so restart the count when the content identity changes rather
than carrying it across.

## Design — left column

### 1. `AutoScroll` learns to finish (the mechanism)

Two new props. Defaults preserve today's behaviour exactly, which matters because
`LiveAlertPanel` uses `AutoScroll` standalone in the top-right column and must
keep looping forever.

```ts
/** Complete passes before the region reports done and parks. Infinity (default)
 *  = loop forever, today's behaviour. */
passes?: number;
/** Fired once `passes` passes have completed. */
onDone?: () => void;
```

A **pass** is: the body has been shown in full, once.

- **Overflowing content** — the pass ends when the bottom hold expires. On the
  final pass the region **parks at the bottom** instead of gliding back up. The
  return glide only exists to set up the next pass; running it under a 1200 ms
  cross-fade would show the leaving card sliding upward as it fades, which reads
  as a glitch. `active` flipping false already snaps the transform back to 0.
- **Fitting content** — there is no travel, so the pass is the body's read time:
  `readSeconds(chars, pace)`. Same source of truth, same units, one rule.

Guard: do not fire `onDone` before the `ResizeObserver` has delivered **both**
boxes at least once. Off-air slides sit under `content-visibility: hidden` and
measure as zero, so an ungated timer would call a not-yet-laid-out slide "fits"
and advance almost immediately.

### 2. `SlideDeck` advances on the signal, clamped

- A new `DeckAdvanceContext` (same shape of plumbing as the existing
  `DeckSlideActiveContext`) carries `{ passes, onDone }` down to the active slide.
- `BroadcastCard`'s template branch reads it and forwards to `AutoScroll`, only
  when `slideActive`.
- `SlideDeck` advances when `onDone` arrives **for the current slide** — key the
  callback by slide id and drop stale calls, or a cut's `resetKey` rewind will eat
  a report from the outgoing deck.
- Two clamps run alongside:
  - **Floor** — nothing advances before it, so a one-line slide can't flash past.
  - **Ceiling** — a safety timer. Required, not optional: a slide whose node isn't
    a `BroadcastCard` template never reports at all, and today's `setInterval` is
    the only thing moving the deck. Keeping the interval as the ceiling means a
    non-reporting slide behaves exactly as it does now, so nothing regresses.

### 3. The knobs, and what happens to `slideHoldMs`

Keep the persisted field, change its meaning to the **floor** and relabel it
*Minimum dwell* on `/admin/scenes/:id` and `/control`. That is a strictly-better
upgrade with no migration and no surprise:

- a slide that fits still holds ~16 s, as it does today;
- a slide that overflows now holds as long as its pass needs, instead of being cut.

Reuse `SLIDE_HOLD_MAX_MS` (40 s) as the ceiling — it is already the admin
slider's maximum, so no new constant. Clamp ceiling to at least the floor, so an
operator who drags the slider to 40 s gets a predictable fixed 40 s dwell back.

One new field, `slidePasses` (1–3, default 1): complete scrolls per slide. 2 is
for a dense card an operator wants shown twice. New `ControlState` fields must
also be added to `broadcast-state-model.ts` or the strict Mongoose schema drops
them silently — the parity test catches it.

### 4. Fit the deck to the shot (optional, and where the real fix lives)

`BroadcastFrame` already receives `nextCutAt` (`DirectorState.endsAt`) for the
masthead countdown. Pass the remaining airtime into `SlideDeck` as `budgetMs` and
derive the floor from `budgetMs / slides.length`, clamped to `SLIDE_HOLD_MIN_MS`.

That makes the deck self-sizing: a 40 s tour stop spreads across its slides, a
12 s quake shot honestly shows as many as fit. It also gives the admin card
somewhere to say the useful thing out loud — *"on a 12 s quake shot this channel
will air 1 of 6 slides"* — which turns an invisible problem into an operator
decision.


## Design — top-right column

Same convention, different mechanism, and no budget to fight.

- **`MarqueeFeed` reports a lap.** It already knows `items.length` and
  `msPerRow`, so a lap is `items.length × msPerRow` and the rAF loop already
  tracks an unbounded row index. Fire `onDone` when that index passes
  `items.length × passes`. Nothing new is measured.
- **`WorldReportDeck` advances on the signal.** It rotates through
  `usePagedSlides(active, 1, holdMs)` rather than `SlideDeck`, so this is a small
  separate change, not shared code. Reuse the *convention* (`passes` + `onDone`),
  not the component.
- **`reportHoldMs` becomes the floor**, same treatment as `slideHoldMs`, with
  `REPORT_HOLD_MAX_MS` (30 s) as the ceiling. At a 6 s default floor, slides that
  have no feed or a short one behave exactly as they do now.
- **Slides with no marquee** (the detection grid's tiles, the about card) never
  report, so the existing dwell timer carries them — same ceiling-as-fallback
  trick as the left.
- **Do not reach for a scroll here.** The whole right column is deliberately
  static; only the marquee inside a card moves. Making a slide fit is done by
  trimming it (`HazardScreen` already caps at `FEED_ROWS = 4`), never by
  scrolling the card.

Ordering note: this side is worth doing **first**. It is smaller, it has no
director interaction, and it fixes a bug where most of a feed is structurally
unviewable.

## Gotchas

- **Don't setState per frame.** `onDone` fires once per slide, from inside the rAF
  loop. Anything per-frame would put a React commit on every /watch frame.
- **No forced layout.** Sizes come from `ResizeObserver` entries only. Reading
  `scrollHeight`/`clientHeight` here cost ~5 ms/frame on OBS's CEF before
  (`docs/watch-perf-plan.md`, rounds 49/53) — don't reintroduce it.
- **The `tracking` block changes card height mid-air.** The observer re-measures
  and the pace re-derives for free; just don't restart a pass in progress.
- **Lazy mounting stays.** `SlideDeck` mounts active + next only; unchanged.
- **`FadeSwap` and the cut.** A director cut rewinds via `resetKey`; stale
  `onDone` calls from the previous segment must be ignored.

## What was built

The knob is **runs through**, exactly as proposed in conversation: the operator
sets how many times a slide shows itself, and the dwell stops being a rotation
speed. `slideHoldMs` / `reportHoldMs` survive as the FLOOR (relabelled *Minimum
dwell*), so no channel needed a migration and a slide that fits still holds what
it always did.

One RUN is the card's content presented once, end to end — a scroll pass on the
left, a marquee lap on the right, or the read time of a body that fits. The
moving part inside a card CLAIMS the slide's clock on mount and reports its runs;
a slide nothing claims falls back to the floor, which is exactly the blind dwell
both decks ran on before. That fallback is what makes this safe to drop into a
live deck.

The safety ceiling is deliberately NOT the dwell slider's maximum. It is a
deadlock breaker (`RUN_CEILING_MS`, 2 minutes) for a slide that claims the clock
and then goes quiet. Capping at the slider max (40 s left, 30 s right) would cut
a legitimate 60 s feed lap short and reinstate the very bug this fixes.

| File | Role |
| --- | --- |
| `shared/broadcast-slides.ts` | `SLIDE_RUNS_*`, `clampRuns`, `RUN_CEILING_MS` |
| `shared/broadcast-report.ts` | `REPORT_RUNS_*` |
| `shared/control.ts` + `db/broadcast-state-model.ts` | the two new fields, validated and persisted |
| `broadcast/run-pacing.tsx` | the clock both decks share: claim, report, floor, ceiling |
| `broadcast/AutoScroll.tsx` | counts scroll passes; parks at the bottom on the last one |
| `broadcast/WorldFeed.tsx` | counts marquee laps |
| `admin/scenes/RunsField.tsx` | the *Runs through* control on both deck cards |

## Phasing (as built)

1. **Top-right, the quick win** — `MarqueeFeed` `passes`/`onDone`;
   `WorldReportDeck` advancing on the lap with `reportHoldMs` as the floor and
   its existing dwell as the ceiling. Self-contained, no director involvement.
2. **Left mechanism** — `AutoScroll` `passes`/`onDone` + park-at-bottom; the
   `DeckAdvanceContext` plumbing through `BroadcastCard`; `SlideDeck` advancing
   on the signal with floor + interval-as-ceiling. No `ControlState` change,
   default `passes` 1.
3. **Operator** — `slidePasses` in `ControlState` + `broadcast-state-model.ts` +
   `mergeControlState` + `SlidesSettings` + `ControlPanel`; relabel both dwell
   fields to *Minimum dwell*.
4. **Budget** — `budgetMs` from `nextCutAt`, per-slide share, and the "N of M
   slides will air" readout in the admin card. Left column only. Then decide,
   with numbers on the table, whether to lengthen shots or lighten slides.

## Tests

- `run-pacing.test.tsx` (new) — floor fallback when nothing claims, waiting past
  the floor for a claimed page, serving out the floor when a card finishes early,
  the ceiling, advancing once however many times a body reports, and ignoring a
  late report from the page that just left air.
- `AutoScroll.test.tsx` — a run reported only after the body has been shown end
  to end, two passes for two runs, a fitting body counted as its read time,
  nothing reported before the `ResizeObserver` has measured, and no reporting at
  all off-deck.
- `WorldFeed.test.tsx` (new) — a lap reported only once every row has been on
  screen, two laps for two runs, no claim from a feed short enough to sit still.
- `SlideDeck.test.tsx` — existing cases stay green; they now advance one hold per
  `act()`, because the deck re-arms its clock on the commit that shows the next
  slide rather than free-running on an interval.
- `broadcast-slides.test.ts` — run-count clamping, rounding, wire junk, and the
  `ControlState` persist parity test for the two new fields.

## What is still open

The shot budget (phase 4) is NOT built, and the left column still has the problem
the reading at the top of this document found: a 12 s director shot cannot show
six slides however well the clocks are tied. Run pacing makes each slide correct;
it does not make the deck fit.

Watch for one consequence of that on long shots. A dense left-column slide now
holds for as long as its scroll pass needs (~50 s at the default pace) instead of
being cut at 16 s, so on a 17 s world spin a channel may now see NO slide change
where it used to see one. That is the over-stuffing surfacing, not a regression in
the pacing — but the fix for it is the budget work plus an honest "N of M slides
will air" readout on the admin card, not a shorter ceiling.
