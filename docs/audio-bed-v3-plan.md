# Audio bed v3 — structure, variety, stall-proof timing

Status: **shipped 2026-09-11**. Verify levels/timing with `node scripts/measure-audio-bed.mjs`.

## Why

Three complaints, three root causes (all measured, not guessed):

- **Crackles when turned up.** The operator volume sat *before* a soft-knee
  DynamicsCompressor (default 30 dB knee, Chrome auto-makeup), so a full mix hit
  +2.5 dBFS at volume 1 and hard-clipped at the sink. The vinyl atmos layer was
  also ~43 single-sample pops/s at -8 dBFS — a fire, not a record.
- **Out of time occasionally.** The scheduler looked 120 ms ahead on a 25 ms
  main-thread timer; /watch stalls 250–400 ms on every director cut, so missed
  steps fired late and bunched (a swung hat landing on the next kick reads as
  "something weird on one kick").
- **Samey.** One key, one 8-bar chord loop, one tempo, one drum pattern per
  energy band, one motif generator; the only structure was a breakdown in bars
  14–15 of every 16.

## Architecture (`public/src/lib/audio/`)

| Module | Role | Tested |
|---|---|---|
| `engine.ts` | `AuroraBed` — public API (unchanged), sequencer, energy | via BroadcastBed |
| `arranger.ts` | phrase planner: role, bars, key, patterns, patches, ending | yes |
| `theory.ts` | keys/modes, 7th chords by degree, voice-led voicings, progression banks, modulation | yes |
| `patterns.ts` | drum / bass / comping banks per section, fills | yes |
| `clock.ts` | Worker ticker, 1.2 s lookahead, resync that drops missed steps | yes |
| `graph.ts` | the rig: master chain, sends, stem groups, drum glue, air floor + weather beds | harness |
| `drums.ts` | kick, hats, ride, clap, snare, rim, shaker, riser, swell | harness |
| `synths.ts` | rhodes, stab, pluck (Karplus–Strong), bell, FM lead, acid, sub bass, Pad | harness |
| `dsp.ts` | soft-clip ceiling curve, rain texture | yes |
| `weather.ts` | readings → mood axes (windy / wet / warm / aurora) | yes |
| `rng.ts` | seeded PRNG + pickers | via tests |

## Musical design

- **Tracks (added 2026-09-12 after "better but samey").** What a listener
  hears as a tune: every 5–9 phrases the arranger starts a new track with its
  own tempo (per section: chill 98–110, lounge 110–120, deep 118–125, min
  124–132, breaks 128–140 BPM), a fresh key (always modulated from the last,
  relative major/minor 25 % of the time), kick flavour (punch / deep / tight /
  soft), hat colour (bright / dark / crisp), pad type (saw / soft / organ /
  strings / glass), bass flavour (sub / reese / pluck), chord voicing (7ths /
  triads / shells) and lead octave. Each track opens with an 8-bar intro, so a
  change reads like a DJ mix moving on. Tempo changes land on the bar; the
  delay time glides with it. A section jump of two bands or more (a storm cut
  from chill to breaks, or the calm after) starts a new track immediately.
- **Sections** by energy: chill < 0.3 < lounge < 0.45 < deep < 0.6 < min < 0.75 < breaks. The
  energy *floors* per stem were lowered (kick/hat 0.2, perc/lead 0.3, bass
  0.15) so chill and lounge can carry a soft downtempo kick when a phrase
  asks for one; the arranger's per-phrase stem subsets do the real shaping.
- **Auto mode drift** now runs on three timescales (2.5 / 11 / 37 min) from
  chill up into deep, instead of a single 2.5-min wobble between chill and
  lounge — on /watch (which defaults to auto) it used to be lounge all day.
- **Phrases.** `intro` (8 bars, pad + atmos + hats) → `main` (8/16/32) → `build` (8, kick out, big
  snare roll, riser) / `break` (8/16, rhythm section out) / `interlude` (8,
  pad + bells only) → … Never the same progression, drum, bass or comping
  pattern twice running. A **main phrase plays a random subset of stems**
  (per-section probabilities, e.g. deep: kick always, lead 50 %, pad 80 %),
  so texture changes phrase to phrase. A section change mid-phrase cuts the
  phrase at the next 4-bar mark.
- **Harmony.** Progressions are scale degrees (five per section in minor,
  three in major), chords stacked in the scale (7ths, triads or shells per
  track) and voice-led from the previous voicing. Within a track keys may
  still modulate at main/break boundaries (p 0.2, never twice running, never
  straight out of the intro). Major keys use the major pentatonic for the lead.
- **Patterns.** 16-step masks with velocities, ghosts (`o`) and probabilities;
  3–5 drum grooves per section including non-four kicks (broken, jack,
  tribal, half step) and downtempo/heartbeat for chill, 2–3 bass lines, 2–3
  comping rhythms.
  Fills: light pickups or a rising snare roll with the kick pulled; `dropout`
  mutes kick + bass on the last beat; `riser` + reverse swell into the drop.
- **Patches** per phrase, weighted by section: keys ∈ rhodes / stab / pluck,
  lead ∈ fm / bell / acid (acid runs its own 16th-note line with accents and
  slides). Pad is a triangle wash in chill/lounge, supersaw above.
- **Swing** per section (chill 0.2 → min 0.06) with a little per-phrase jitter.

## Master chain and levels

`bus (0.6) → limiter (-6 dB, knee 2, 20:1) → soft-clip ceiling (identity < 0.8, max 0.95) → master (volume) → analyser → out`.
Drums get their own glue compressor before the bus. Measured at volume 1:

| Mode | Peak | RMS | Clipped |
|---|---|---|---|
| breaks | -2.4 dBFS | -15.9 dB | 0 % |
| deep | -2.4 dBFS | -16.3 dB | 0 % |
| minimal | -2.0 dBFS | — | 0 % |
| chill | -7.0 dBFS | -20.4 dB | 0 % |

(Before the fix: breaks peaked at +2.5 dBFS and clipped every second. Chill
came up from -28.9 dB RMS when its phrases gained a soft kick and bass; it is
now ~5 dB under the groove sections instead of 13.)

## Clock

`startTicker` runs a 100 ms tick in a Blob Worker (falls back to setInterval),
`LOOKAHEAD_S = 1.2` keeps music queued through a director cut, and
`resyncGrid` skips the steps a stall swallowed instead of firing them late.
With a simulated 400 ms stall every 2 s: old scheduler 2 kicks off-grid by
~45 ms in 16 s; new clock 0 off-grid, 0 dropped (a 400 ms stall never even
reaches the resync).

## Silent-on-load hardening (2026-09-13)

A run went to air with no bed until the OBS browser source was refreshed. The
source loads at go-live while OBS is still bringing up its audio output, so the
AudioContext can start `suspended`; the engine used to call `resume()` once and
the player only retried on a pointer event, which never comes in OBS. Now:

- `AuroraBed.resume()` swallows rejections and is retried from the scheduler
  tick every 2 s while playing; `ctx.onstatechange` re-resumes a context that
  gets suspended behind our back (device change, CEF audio restart).
- BroadcastBed re-probes every 2 s so the "blocked" badge clears by itself; a
  click now calls `resume()` rather than restarting the arrangement.
- Each sequencer step runs inside a guard: a throwing step is counted and
  skipped (first three logged as `[audio bed] step N failed`), never retried.
- `getState()` exposes `contextState` and `errors`; on /watch read them off
  `window.__auroraBed.getState()` before blaming OBS.

Verified in headless Chromium: a context whose `resume()` is refused twice
comes back running ~4 s after suspension with steps flowing; a kick that
throws on every hit costs 30 skipped steps in 34 s while everything else keeps
playing (`scratchpad/resilience.mjs` in the session that shipped this).

## Vinyl pops removed (2026-09-16)

"Still some crackle, heard when tuning in." The tamed vinyl layer (6 pops/s,
-22 dBFS) ran 100 % of the time regardless of phrase layers and stood out
whenever the mix went quiet (intro, interlude, chill); rain measured -36 dBFS
and wasn't it. The pops are gone: atmos is now a faint dark air floor
(noise → 2.4 kHz lowpass, -44 dBFS) plus the wind/rain beds. The sidechain
duck is a 3 ms ramp from the current gain instead of a step to 0.3 (a step on
a sustained pad clicked on every kick).

## Verification

```
node scripts/measure-audio-bed.mjs --mode breaks --vol 1          # peak / rms / clipped
node scripts/measure-audio-bed.mjs --mode deep --secs 240 --trace 1  # track (♪) + phrase changes
node scripts/measure-audio-bed.mjs --mode chill --solo atmos      # atmos beds alone (air / wind / rain)
node scripts/measure-audio-bed.mjs --weather 'wind=25,rain=10,temp=35,kp=9'  # every mood axis maxed
```

## Gotchas (Web Audio)

- **Lowpass/highpass `Q` is in dB** (linear Q = 10^(Q/20)). Anything above
  -3 dB peaks past unity near the cutoff; a filter inside a feedback loop (the
  pluck) must use ≤ -3 dB or the loop runs away (this happened: +190 dB bus).
- A DelayNode inside a cycle is clamped to ≥ 128 samples, so plucks play an
  octave below the keys register to keep the period long enough.
- The analyser is post-volume; the lab spectrum shrinks with the slider.

## Weather-reactive layer (shipped 2026-09-11)

`weather.ts` turns the on-air location's latest readings into four 0..1 mood
axes; `BroadcastBed` gets them as a `weather` prop (WatchSurface derives it
from the focus bundle's point-history series — wind, gust, rain, temp — plus
the aurora overlay's Kp, no new fetches). `AuroraBed.setWeather(mood)`:

| Axis | From | Effect |
|---|---|---|
| windy | max(wind, 0.7·gust) / 14 m/s | empty 16ths fill with quiet closed hats (p = 0.45·windy), wider hat/shaker panning, a slow filtered-noise wind bed (gusting LFOs) |
| wet | rain / 3 mm/h | looped rain texture (`fillRain`, 140 drops/s, bandpassed), delay feedback 0.37→0.52 and return 0.4→0.52 |
| warm | (temp + 5) / 35 °C | musical + pad lowpass cutoffs ×0.7 (cold) … ×1.3 (hot) |
| aurora | (Kp − 2) / 5 | two sine shimmer voices two octaves above the pad's top notes, slow tremolo, mostly reverb |

Unknown readings are neutral (warm 0.5, the rest 0). All beds sit at gain 0
until the mood opens them, smoothed over ~1.5 s so cuts glide. The lab has a
"Conditions" panel with wind/rain/temp/Kp sliders. Levels with every axis
maxed: breaks -2.1 dBFS, chill -12.1 dBFS, 0 % clipped
(`--weather 'wind=25,rain=10,temp=35,kp=9'`).

## Next

- Motif development (transpose/invert/fragment), a second answering lead.
- More voices: organ, choir pad, tom fills.
- Half-time feel for chill instead of a tempo change.
