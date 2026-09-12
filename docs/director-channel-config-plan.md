# Director per-channel configuration — every knob on `/admin/scenes/:id` — plan

> **Status: PLANNED** (2026-09-12). Nothing built yet. Companions:
> [director-break-in-plan.md](./director-break-in-plan.md) (breaking cuts),
> [director-commands-plan.md](./director-commands-plan.md) (operator/viewer
> command queue), [chat-interaction-plan.md](./chat-interaction-plan.md)
> (viewer chat policy). Those add *behaviour*; this plan makes the whole
> director **configurable per channel from the admin page**, promotes the
> policy that is still hard-coded into the per-channel config, and gives each
> stream type a template to start from.

## 0. Where every director knob lives today

`DirectorConfig` is already **one Mongo doc per scene** (`director-config-model.ts`,
read by the worker loop every second), so the *storage* is per channel. The
*editing surface* is not: the admin page exposes five fields, `/control` edits
the rest live and unstaged, and a long tail of policy is constants.

| Knob | Type field | `/admin/scenes/:id` | `/control` (live) | Hard-coded |
|---|---|---|---|---|
| Auto / off | `mode` | ✓ `DirectorSettings` | ✓ `DirectorModeBar` | |
| Which kinds air, how often | `kinds`, `kindWeights` | ✓ | ✓ (kinds only) | |
| Favourite countries / areas, content presets | `countries`, `regions`, `DIRECTOR_PRESETS` | ✓ | | |
| Hold per kind / quake class / storm level / volcano level | `kindHoldSeconds`, `quakeHoldSeconds`, `stormHoldSeconds`, `volcanoHoldSeconds` | — | ✓ `DirectorHolds` | |
| Flight time between shots | `transitionSeconds` | — | ✓ | |
| Quake / warning thresholds | `minQuakeMag`, `minAlertSeverity` | — | ✓ `DirectorTuning` | |
| Hazard-cycle beat, ad cadence | `alertCycleSeconds`, `adEveryNShots` | — | ✓ | |
| Map-type tour per kind | `mapTypes` | — | ✓ `DirectorMapTypes` | |
| Per-kind overlays / basemap+wind looks / saved slides | `overlayOverrides`, `kindLooks`, `kindSlides`, `activeSlideId` | — | ✓ `DirectorSlides` | |
| Skip | `skipNonce` | — | ✓ | |
| Geo cooldown between shots (°), recent-centres memory, per-kind area memory | — | — | — | `DEFAULT_GEO_COOLDOWN_DEG` 25, `GEO_RECENT_CAP` 8, `AREA_MEMORY_CAP` 3 |
| Storm pool size, per-country cap, scan limit | — | — | — | `ALERT_POOL_CAP` 40, `ALERT_COUNTRY_CAP` 3, `ALERT_SCAN_LIMIT` 300 |
| Notable / VIP track boost | — | — | — | `NOTABLE_SCORE` 45, `VIP_SCORE` 80 |
| City-tour length for country / area shots | — | — | — | `COUNTRY_TOUR_STOPS` 8, `REGION_TOUR_STOPS` 10 |
| Round-up reading pace, cap, stop dwell, stops | — | — | — | `SUMMARY_WORDS_PER_MIN` 170, `SUMMARY_MAX_HOLD_MS` 60 s, `SUMMARY_STOP_DWELL_MS` 40 s, `SUMMARY_MAX_TOUR_STOPS` 6 |
| Volcano shot zoom | — | — | — | `VOLCANO_ZOOM` 5 |
| Map-look dwell on a spin, scalar cycle dwell, ocean-depth cycle dwell | — | — | — | client `GLOBAL_MAP_CYCLE_MS` 6 s, `VAR_CYCLE_MS` 5.5 s, `DEPTH_CYCLE_MS` 2.5 s (`public/src/lib/director.ts`) |
| Breaking windows | — | — | — | → break-in plan (`breakIn`) |

So a "simple map channel" and the full G.O.D.S. feed can differ in *what* airs,
but not in how fast it moves, how long a look parks, how far the camera must
travel between shots, or how big the event pools are — and none of the pacing
is reachable without opening `/control` for that scene.

## 1. Guiding decisions

1. **One doc, one truth.** No second "admin config" beside the live one. The
   admin cards stage deltas onto the same `DirectorConfig` through the Save
   bar (`useSceneDraft().stageDirector`); `/control` keeps patching it live.
   Both already go through `PATCH /api/director/:scene/config` →
   `mergeDirectorConfig`, so nothing new can drift.
2. **Promote, don't fork.** Every constant in the table above becomes a field
   in a new typed `DirectorConfig.tuning` bucket whose defaults are *exactly*
   today's numbers. Shipping T0 changes no channel's behaviour.
3. **The client learns tempo from the cut, not from config.** The worker
   already stamps `holdMs` / `cutTransitionMs` on every segment; it stamps the
   dwell numbers the same way. `/watch` needs no config fetch and OBS sources
   pick the change up on the next cut.
4. **Templates per stream type.** A channel starts from a named programme
   template ("Maps only", "Events desk", "Ocean", "Full feed") or a copy of
   another channel, then is tuned. Templates are a starting point applied
   into the draft — never a live link.
5. **Admin is canonical, `/control` is the desk.** Everything is editable in
   admin; `/control` keeps the live-tweak controls it has (holds, thresholds,
   looks, skip) and gains a link to the channel's admin page. Nothing is
   removed from `/control`.

## 2. Contract — `DirectorConfig.tuning` (new, `shared/src/director.ts`)

```ts
export interface DirectorTuning {
  rotation: {
    geoCooldownDeg: number;      // 25 — min great-circle distance from recent shot centres
    recentCentersCap: number;    // 8  — how many recent centres the cooldown remembers
    areaMemoryCap: number;       // 3  — per-kind "don't repeat these areas" memory
  };
  pools: {
    alertPoolCap: number;        // 40 — storm candidates kept after ranking
    alertCountryCap: number;     // 3  — max storm candidates per country (see director-pool-country-cap)
    notableBoost: number;        // 45 — score added to curated notable tracks
    vipBoost: number;            // 80 — score added to VIP tracks
  };
  tours: {
    countryStops: number;        // 8  — cities toured on a country spotlight
    regionStops: number;         // 10 — cities toured on an area spotlight
    roundupStops: number;        // 6  — max stops on a round-up spin
    roundupStopDwellS: number;   // 40
    roundupWordsPerMin: number;  // 170 — reading pace → round-up hold
    roundupMaxHoldS: number;     // 60
    volcanoZoom: number;         // 5
  };
  tempo: {
    mapStepS: number;            // 6   — dwell per look on a global/ocean/quake spin
    varCycleS: number;           // 5.5 — dwell per scalar in a variable cycle
    depthCycleS: number;         // 2.5 — dwell per level in the ocean-depth cycle
  };
}
```

- Defaults `DEFAULT_DIRECTOR_TUNING` = the constants, verbatim. `mergeTuning`
  clamps every number to a sane range (deg 0–90, caps 1–50, stops 1–20,
  seconds 1–120, wpm 60–400) and falls back per field — the same shape as
  `mergeHolds`. Wired into `mergeDirectorConfig` next to `mergeKindLooks`.
- `ALERT_SCAN_LIMIT` stays a worker constant: it is a query guard, not
  programme policy.
- **Segment additions** (ride `director:state`, no ControlState change):
  `tempo?: { mapStepMs: number; varCycleMs: number; depthCycleMs: number }`,
  stamped by `make()` in `candidates.ts` alongside `holdMs`. The client
  constants become the fallback when a cut carries no `tempo` (old worker).

## 3. Worker — read the bucket instead of the constants

- `candidates.ts`: `ALERT_POOL_CAP`, `ALERT_COUNTRY_CAP`, `NOTABLE_SCORE`,
  `VIP_SCORE`, `COUNTRY_TOUR_STOPS`, `REGION_TOUR_STOPS`, `SUMMARY_*`,
  `VOLCANO_ZOOM` → `cfg.tuning.*` (the builders already receive `cfg`).
- `loop.ts`: `GEO_RECENT_CAP` → `cfg.tuning.rotation.recentCentersCap`; the
  `view` handed to `selectNext` carries `geoCooldownDeg` and `areaMemoryCap`
  (today `DEFAULT_GEO_COOLDOWN_DEG` / `AREA_MEMORY_CAP` in
  `director-select.ts` become the defaults of optional view fields).
- The loop re-reads the config every tick, so an admin Save applies within a
  second. No restart, no new job.

## 4. Client — tempo from the cut

`public/src/lib/director.ts`: `useMapStep` / the variable and depth cycles take
`periodMs` from `cut.segment.tempo` when present, else the existing constants.
The `spinEpoch` anchoring is unchanged, so a tempo change lands cleanly at the
next cut rather than mid-spin.

## 5. Admin — one card group, several small files

Split the director section of `/admin/scenes/:id` into sibling cards (keep
files small; each stages **complete top-level objects** through
`stageDirector`, refetches on `epoch`, copies the `DirectorSettings` pattern):

| Card | File (new unless noted) | Fields |
|---|---|---|
| **Programme** | `DirectorSettings.tsx` (existing) | mode, kinds, weights, favourites, content presets + **Template** picker + **Copy from channel…** (§6) |
| **Pacing** | `DirectorPacingSettings.tsx` | `kindHoldSeconds`, the three level-hold maps, `transitionSeconds`, `alertCycleSeconds`, `adEveryNShots`, `tuning.tempo` (map / scalar / depth dwell) |
| **Pools & rotation** | `DirectorPoolSettings.tsx` | `minQuakeMag`, `minAlertSeverity`, `tuning.pools`, `tuning.rotation` |
| **Tours & round-ups** | `DirectorTourSettings.tsx` | `tuning.tours` |
| **Looks** | `DirectorLooksSettings.tsx` | `mapTypes` per touring kind, `overlayOverrides`, `kindLooks` + slides — **reuses** `DirectorMapTypes` / `DirectorSlides` with an `update` prop that stages instead of patching live (both already take `config` + `update`) |
| Break-ins | `BreakInSettings.tsx` | → break-in plan |
| Chat commands | `ChatCommandsSettings.tsx` | → chat / commands plans (ControlState bucket, same Save bar) |

Card order on the page: Programme, Pacing, Pools & rotation, Tours &
round-ups, Looks, Break-ins, then the existing Audio / Theme cards. Each
pacing/tuning field shows its default as helper text ("default 6 s") and a
per-card **Reset to defaults** that stages the default object.

`/control`: `DirectorPanel`'s settings drawer gains one line — "Channel
settings live on /admin/scenes/:id ↗". `DirectorHolds` / `DirectorTuning`
stay as the live desk; they edit the same fields, so an operator nudge on air
is exactly what the admin page shows afterwards.

## 6. Templates and copy-from

`shared/src/director-templates.ts` — `DIRECTOR_TEMPLATES: Record<id, { label,
blurb, config: Partial<DirectorConfig> }>`, content + pacing + pools only
(never `kindLooks` / `kindSlides` / `breakIn` / `skipNonce`):

| id | Programme |
|---|---|
| `maps` | intro/global/ocean/orbital only, no events, long holds (90 s), slow map step (10 s), ads off |
| `events` | storm/quake/volcano/flight/ship, short global bridges, level holds as today, thresholds M5 / severe |
| `ocean` | ocean + orbital + global, ocean map tour only, depth cycle on, long dwell |
| `full` | today's defaults (the G.O.D.S. feed) |

- **Apply template** on the Programme card: stages the template's objects into
  the draft (with a confirm listing what it will overwrite); Save commits.
- **Copy from channel…**: a scene picker; the client fetches that scene's
  config (`fetchDirectorConfig`) and stages everything except `skipNonce` and
  `activeSlideId`. Purely client-side — no new route. (`POST /api/scenes`
  already clones a source channel's config at creation; this is the
  after-the-fact version.)

## 7. Persistence

- `director-config-model.ts`: `tuning` as a **nested typed path schema** with
  defaults (fixed shape — not `Mixed`), like the break-in plan's `breakIn`.
- Strict-mode parity test `director-config-model.test.ts` for the whole
  config. The break-in plan proposes the same file; whichever lands first
  creates it, the other extends it.
- No ControlState change → no `broadcast-state-model.ts` edit.

## 8. Build order

| Phase | Deliverable | Behaviour change |
|---|---|---|
| T0 | `tuning` contract + defaults + merge + model + parity test; worker reads `cfg.tuning.*`; `Segment.tempo` stamped; client honours `tempo` | none (defaults = constants) |
| T1 | Admin cards: Pacing, Pools & rotation, Tours & round-ups, Looks (staged adapters for `DirectorMapTypes` / `DirectorSlides`); `/control` link | none until an operator saves |
| T2 | Templates + Apply + Copy from channel | none until applied |

T0 is small and unlocks the other two director plans' per-channel fields
landing in the same card group. T1 is the visible win. Independent of the
break-in and commands plans; shares only the model file and the parity test.

## 9. Tests

- shared: `mergeTuning` clamps/fallbacks; `DEFAULT_DIRECTOR_TUNING` equals the
  old constants (a pinned table so a future edit is deliberate); model parity;
  `DIRECTOR_TEMPLATES` only touch allowed keys.
- worker: candidate builders honour `alertPoolCap` / `alertCountryCap` /
  boosts / tour stops / round-up pace from an injected config; loop passes
  `geoCooldownDeg` / `areaMemoryCap` / `recentCentersCap` into selection;
  `make()` stamps `tempo`.
- public: each card stages a complete object and refetches on `epoch`;
  Reset-to-defaults; Apply-template confirm + staged keys; Copy-from stages
  everything but the excluded keys; `useMapStep` uses `segment.tempo` and
  falls back to the constants.

## 10. Decisions taken (change here if wrong)

1. Same doc for admin and `/control`; admin is canonical, `/control` is not
   trimmed.
2. Constants become `tuning` sub-buckets (rotation / pools / tours / tempo)
   with today's values as defaults, not individual top-level fields.
3. Client tempo rides the cut (`Segment.tempo`), not a config fetch.
4. Templates are content + pacing + pools, applied into the draft, never a
   live link; looks, slides, break-ins and chat policy are per channel and
   untouched by a template.
5. `ALERT_SCAN_LIMIT`, `TICK_MS`, `HEARTBEAT_MS`, `SEEN_CAP`, `HISTORY_CAP`
   stay constants — engine guards, not programme policy.
