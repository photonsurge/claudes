# Plan: a single world clock ("see the world at a time T")

> Status: **planned, not started.** Goal: one master time-scrubber that moves
> every layer — weather, aircraft, ships, satellites, alerts, quakes — to the
> same instant `T`, instead of the disconnected weather-only `fhr` we have now.

## Where we are today

Every data source already carries time; nothing ties them together.

| Source | Provider | Storage model | Time field | Rendered on globe |
|---|---|---|---|---|
| Weather (wind/temp/pressure) | NOAA GFS 0.25° | `WeatherRun` + `WeatherTexture` | `steps[].validTime` / `fhr` | yes — driven by `state.fhr` |
| Alerts | WMO SWIC, NWS, MeteoAlarm, GDACS | `Alert` | `effective` / `expires` | yes |
| Aircraft | ADS-B.lol / OpenSky | `TrackSnapshot` | `batchAt` frames (6h TTL) | yes (live only) |
| Ships | aisstream.io | `TrackSnapshot` | `batchAt` frames (6h TTL) | yes (live only) |
| Satellites | Celestrak TLE | `SatelliteTle` | propagated to any instant | yes (live only) |
| Earthquakes | USGS | `Quake` | `time` (31d TTL) | yes (live only) |

Key findings:
- The only thing driving globe time today is `state.fhr` (weather). It dual-emits
  over the socket so `/watch` follows.
- `useTracks` is hardwired to "now": polls `latest` frames, dead-reckons to
  `Date.now()`, propagates satellites to `new Date()`.
- `Timeline.tsx` = weather-only fhr scrubber (in ControlPanel).
- `ReplayPanel.tsx` = a *table* on `/admin/tracks`, NOT a globe overlay. Track
  history scrub already has working API endpoints (`/api/tracks/history/batches`,
  `/api/tracks/history`) — just never wired to the globe.

## Decisions (locked in)

1. **One master clock, retire both existing time UIs** (Timeline + ReplayPanel).
   `fhr` becomes derived from `T`.
2. **Future behaviour: freeze + fade.** Scrubbing past `now`, observed layers
   (planes/ships/quakes) hold last-known positions and fade out; only
   forecast-able layers (weather, satellites) keep going.
3. Build phase-by-phase, foundation first.

## Core concept

One value: **`T`** — an absolute instant (ms epoch), in operator control state,
dual-emitted over the socket like `spin`/`fhr`, so `/watch` follows.

```
worldT(clock, now) =
  mode "live"    → now
  mode "paused"  → anchorT
  mode "playing" → anchorT + rate * (now − epoch)   // same epoch trick as spin
```

Range: **[now − 6h, now + forecastHorizon]** (6h = track history TTL; horizon =
last GFS step's `validTime`).

Per-layer mapping from `T`:

| Layer | Past (T ≤ now) | Future (T > now) |
|---|---|---|
| Weather | `fhr` ← step nearest T; clamp to analysis (fhr 0) if T < run | `fhr` ← forecast step nearest T |
| Aircraft/Ships | snap to history frame nearest T (no dead-reckon) | freeze last frame, fade over ~30 min |
| Satellites | propagate TLE → T | propagate TLE → T |
| Alerts | active where `effective ≤ T ≤ expires` | same |
| Quakes | events with `time ≤ T` in trailing window | freeze + fade |

Asymmetry to surface in the UI: GFS only stores now→future, so scrubbing into the
past pins weather to analysis (fhr 0).

## Phases

### Phase 1 — Shared clock state & pure math (`shared/`)
- `shared/src/control.ts`: add `ClockState { mode: "live"|"paused"|"playing";
  anchorT: number; epoch: number; rate: number }` to `ControlState`, with
  `DEFAULT_CLOCK` (live) and `mergeClock()` validation in `mergeControlState`
  (mirrors the new `mergeTrackStyle`). Keep `fhr` as a derived/override only.
- `shared/src/clock.ts` (new, small): pure helpers `worldT()`,
  `fhrForTime(manifest, T)`, `frameNearest(frames, T)`, `clockRange(manifest,
  now)`, `fadeFactor(T, now)`. Unit-tested (`clock.test.ts`).

### Phase 2 — Client clock hook (`public/`)
- `public/src/lib/useWorldClock.ts` (new): subscribes to control state, ticks
  ~4–10 Hz, returns live `T` + derived `fhr`, range, `isFuture`. Single source of
  truth for every layer.

### Phase 3 — Wire layers to T
- Weather: `Globe.tsx` — replace the four `state.fhr` reads (~357–393) with
  `fhrForTime(manifest, T)`.
- Tracks: `useTracks.ts` — add `worldT` + `mode` inputs. Live mode = today's
  behaviour. Scrub mode: fetch `listHistoryAt(frameNearest(T))` instead of
  `latest`, skip dead-reckon (optionally interpolate adjacent frames), propagate
  satellites/orbits to `new Date(T)`, apply future-fade opacity; trails become
  the window ending at T.
- Alerts: `alertsActiveAt(alerts, T)` filter.
- Quakes: filter `seismic` to `time ≤ T` in trailing window + fade.

### Phase 4 — Unified scrubber UI
- `public/src/components/WorldClock.tsx` (new): master timeline across the full
  range — play/pause, "Jump to live", rate control, NOW marker, run boundary,
  absolute-UTC readout. Writes `clock` via `patch()` (dual-emits to `/watch`).
- `ControlPanel.tsx`: replace `<Timeline>` with `<WorldClock>`. Delete
  `Timeline.tsx`. Repoint/remove the `/admin/tracks` `ReplayPanel`.

### Phase 5 — Tests & verify
- Unit tests for all new pure functions (`clock.test.ts`, alert/quake `activeAt`
  selectors). Run `./test`, then `./update-shared` so consumers pick up shared
  changes.

## Scope
~3 new files, edits to ~7; touches all four packages but the heavy lifting is in
`shared/clock.ts` (pure, testable) and `useTracks.ts`. Sits cleanly alongside the
in-flight per-track-type styling/filter WIP — no overlap.

## Start here
Phase 1 (shared clock state + `clock.ts` math + tests) — the foundation every
layer reads from, verifiable in isolation before touching any rendering.
