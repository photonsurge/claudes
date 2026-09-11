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
| `graph.ts` | the rig: master chain, sends, stem groups, drum glue, vinyl | harness |
| `drums.ts` | kick, hats, ride, clap, snare, rim, shaker, riser, swell | harness |
| `synths.ts` | rhodes, stab, pluck (Karplus–Strong), bell, FM lead, acid, sub bass, Pad | harness |
| `dsp.ts` | soft-clip ceiling curve, vinyl crackle | yes |
| `rng.ts` | seeded PRNG + pickers | via tests |

## Musical design

- **Sections** by energy are unchanged (chill < 0.3 < lounge < 0.45 < deep < 0.6 < min < 0.75 < breaks).
- **Phrases.** `intro` (8 bars, pad + atmos + hats) → `main` (8/16/32) → `build` (8, kick out, big
  snare roll, riser) / `break` (8/16, rhythm section out) → … Never the same
  progression, drum, bass or comping pattern twice running. A section change
  mid-phrase cuts the phrase at the next 4-bar mark.
- **Harmony.** Progressions are scale degrees (three per section), chords are
  7ths stacked in the scale and voice-led from the previous voicing. Keys
  modulate by a fourth/fifth (sometimes a minor third) at main/break boundaries
  with p 0.3, never twice in a row; the mode flips aeolian ↔ dorian sometimes
  (IV turns major). Pentatonic lead and bass follow the key.
- **Patterns.** 16-step masks with velocities, ghosts (`o`) and probabilities;
  three drum grooves per groove section, 2–3 bass lines, 2–3 comping rhythms.
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
| chill | -12.9 dBFS | -28.9 dB | 0 % |

(Before: breaks peaked at +2.5 dBFS and clipped every second.)

## Clock

`startTicker` runs a 100 ms tick in a Blob Worker (falls back to setInterval),
`LOOKAHEAD_S = 1.2` keeps music queued through a director cut, and
`resyncGrid` skips the steps a stall swallowed instead of firing them late.
With a simulated 400 ms stall every 2 s: old scheduler 2 kicks off-grid by
~45 ms in 16 s; new clock 0 off-grid, 0 dropped (a 400 ms stall never even
reaches the resync).

## Verification

```
node scripts/measure-audio-bed.mjs --mode breaks --vol 1          # peak / rms / clipped
node scripts/measure-audio-bed.mjs --mode deep --secs 150 --trace 1  # phrase changes
node scripts/measure-audio-bed.mjs --mode chill --solo atmos      # vinyl layer alone
```

## Gotchas (Web Audio)

- **Lowpass/highpass `Q` is in dB** (linear Q = 10^(Q/20)). Anything above
  -3 dB peaks past unity near the cutoff; a filter inside a feedback loop (the
  pluck) must use ≤ -3 dB or the loop runs away (this happened: +190 dB bus).
- A DelayNode inside a cycle is clamped to ≥ 128 samples, so plucks play an
  octave below the keys register to keep the period long enough.
- The analyser is post-volume; the lab spectrum shrinks with the slider.

## Next

- Weather-reactive parameters: wind → hat density/pan rate, rain → filtered
  noise texture + delay, temperature → brightness, aurora Kp → shimmer.
- Motif development (transpose/invert/fragment), a second answering lead.
- More voices: organ, choir pad, tom fills.
- Half-time feel for chill instead of a tempo change.
