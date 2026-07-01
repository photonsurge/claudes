# Country/Area High-Res — Phase 2 Plan

**Goal:** as the operator zooms toward a country/area, swap the global base map for a
**higher-resolution regional source** for that area (finer weather, ocean, radar). No
single global high-res feed exists — this means pulling from **many regional providers**,
each with its own bbox, format, endpoint, and cadence.

The architecture already anticipates this: every `SourceDescriptor` carries
`bbox` + `priority` + `resolutionDeg`, and each manifest variable is tagged with its
source's bbox/priority. The missing piece is the **merge resolver** (below).

---

## Layer 1 — The Merge Resolver (foundation · build FIRST · sequential)

Nothing regional renders until this exists. Build once; every region after is config + a
GRIB fetch. Client-side stacking (spec §6.3 Option A).

**1. Data model** — `shared/src/sources.ts`
- Add `minZoom?: number` to `SourceDescriptor` (finer sources activate at higher zoom).

**2. Manifest** — `shared/src/manifest.ts`
- Add `nests?: WeatherVariableManifest[]` per variable (each nest = same shape but with a
  required regional `bbox`). Base entry = global source; nests = regional overlays.

**3. Composition** — `public/src/lib/manifest.ts` `composeManifest`
- Per variable: base = highest-priority **global** ENABLED source (as today); `nests` =
  every **regional** (sub-global bbox) ENABLED source that supplies it, sorted by priority.

**4. Client resolver** — `public/src/components/layers/`
- `resolveLayers(manifest, variableId, fhr, view)` → `[base, ...activeNests]`.
  - A nest is *active* when its `bbox` contains the view center **and**
    `view.zoom ≥ nest.minZoom` (default derived from `resolutionDeg`).
- Render base full-globe, then each active nest clipped to `entry.bbox` (WeatherLayers
  `bounds`), finest last. Optional edge feather (v1 = hard edges).
- Plumb the current `view` (center/zoom, already in `state.camera`) into the layer builders
  in `GlobeView`.

**Effort:** the biggest single piece. Touches shared manifest + compose + client layers +
GlobeView. Resolver selection is pure → fully unit-testable.

---

## Layer 2 — Regional Adapters (parallelizable · one agent each)

All regular lat-lon → **drop-in bake, no regrid.** Each = `sources/<x>.ts` +
`ingest<X>` in `weather/multiSource.ts` + a `SourceDescriptor` + tests.

| # | Source | Area (bbox) | Vars | Cadence | Notes | Effort |
|---|---|---|---|---|---|---|
| 1 | **Wave basin tiles** (`atlocn/epacif/wcoast .0p16`) | Atlantic, E-Pacific, US coast | wave | 6h | **Data already fetched** in the mosaic — publish as bbox nests | **Low** |
| 2 | **HRRR** | CONUS + Alaska | temp, wind, gust | hourly | NOMADS `filter_hrrr_2d.pl`, regular subset | Medium |
| 3 | **MRMS radar** | CONUS | new `radar` var (dBZ) | ~2 min | NOMADS MRMS GRIB2 — the "live" layer, big visual | Medium |
| 4 | **ICON-D2** | Central Europe | temp, wind | 3h | DWD `opendata.dwd.de`, regular-lat-lon variant, **`.bz2`** (bunzip2 first) | Med-High |
| 5 | **RTOFS regional** | 11 ocean windows | sst, current | daily | GRIB2 windows already known (`WTMP`/`UOGRD`…) | Low-Med |
| 6 | Long tail | per-country | varies | — | national radars, city-scale | ongoing |

**Shared edit points (cross-agent contention):** `shared/src/sources.ts` (each adds a
descriptor) and `shared/src/variables.ts` (MRMS adds a `radar` var + palette). A
**coordinator step adds those up front** so per-region agents don't collide; everything
else is isolated per source.

---

## Rollout / phasing

- **2a — Resolver + wave basin nests** → proves the zoom-in mechanism on data we already
  pull (no new ingest). Zoom into the Atlantic → finer waves.
- **2b — HRRR** → biggest land payoff (US temp/wind at 3km).
- **2c — MRMS radar** → live radar, the headline "real-time" layer.
- **2d — ICON-D2** → Europe.
- **2e — RTOFS regional** → sharper coastal ocean.
- **2f — long tail.**

---

## Agent orchestration

1. **Build the resolver first** (sequential — it's the shared contract everything depends
   on; not safe to parallelize).
2. **Coordinator** adds all descriptors + the `radar` var to `sources.ts`/`variables.ts`.
3. **Fan out one agent per region** (2b–2e) in parallel — each writes its `sources/<x>.ts`
   + `ingest<x>` + tests against the fixed contract. Independent files → no conflicts.
4. **Verify pass** — each adapter's URL builder + bake tested; endpoints flagged VERIFY for
   a live run.

---

## Open decisions (confirm before build)

- **Coverage priority:** US-first (HRRR/MRMS) vs Europe-first (ICON-D2)?
- **Radar:** MRMS adds a brand-new `radar` variable (reflectivity, its own palette/legend).
  In scope now, or keep Phase 2 to temp/wind/wave/ocean and treat radar separately?

---

## Gotchas (carried from Phase 1)

- Every regional endpoint **drifts** — re-confirm NOMADS/DWD filenames at implementation
  time (`wgrib2 -inv`, directory listing).
- NOMADS soft-bans <~10s fetch gaps → all NOMADS fetches go through `nomadsGate()`.
- ICON-D2 files are `.bz2` — decompress before wgrib2.
- Textures must bake to a **known grid** and carry their `bbox`; the client clips nests to
  it. All these sources are regular lat-lon (no regrid).
- Time alignment: nests refresh at different cadences → pick the texture nearest the
  frame's `validTime` (spec §6.3), else layers show different moments.
