# Weather & map pipeline — source map

A file-by-file guide to **who fetches, bakes, stores, composes, and draws** the
weather maps. Read [`../ARCHITECTURE.md`](../ARCHITECTURE.md) first for the 10,000-ft
view; this is the ground-level "what code does what" for the raster/nest system.

## The one-paragraph model

Upstream models (NOAA GFS/RTOFS/GFS-Wave, DWD ICON, ECCC HRDPS, UKMO UKV, Open-Meteo,
NOAA ETOPO) → the **worker** downloads + decodes + bakes each into a scalar/vector
**PNG texture** on a regular lat/lon grid → stores it in **Mongo** as a `WeatherRun` +
`WeatherTexture` → the **public** app composes those runs into a **manifest** (per
variable: one global base + zoom-gated nests) → the **client** decodes each texture
with `imageUnscale`, colours it with the variable's **palette**, and draws it on the
deck.gl `_GlobeView`. The public app **never** touches upstream — only Mongo.

```
upstream ──(worker: download → wgrib2/cdo → bake PNG)──▶ Mongo (WeatherRun+Texture)
                                                             │
public /api/weather/manifest ◀──(composeManifest picks base+nests per variable)──┘
     │
client (resolve nests → decode+palette → deck RasterLayer/ParticleLayer on the globe)
```

---

## 1. Shared — the contracts (`shared/src`)

The single source of truth both worker and public import. Edit here → run repo-root
`./update-shared` to republish into consumers.

| File | What it defines |
| --- | --- |
| `sources.ts` | **Source registry.** Every model as a `SourceDescriptor` (`id`, `variables[]`, `bbox`, `dims`, `resolutionDeg`, `priority`, `minZoom`, `enabled`, `cadence`). `getSource`, `sourcesForVariable`, `enabledSources`. Base vs nest = presence of `minZoom`. **Priority** decides which base wins a variable (icon-global 12 › gfs 10). |
| `sources.iconGlobal.ts` | DWD ICON-13km descriptor (`temp/wind/gust/humidity`). |
| `sources.openMeteo.ts` | Open-Meteo `.om` national nests (dmi/metno/meteoswiss/arome/knmi/icon-2i/jma…), incl. the projected-grid flags. |
| `sources.rtofsRegional.ts` | RTOFS regional window descriptors. |
| `sources.waveNests.ts` | GFS-Wave basin nests (atlocn/wcoast; epacif disabled — antimeridian). |
| `sources.hrdps.ts` / `sources.ukv.ts` | ECCC HRDPS / UKMO UKV descriptors. |
| `variables.ts` | **Variable registry** — `temp/humidity/wind/gust/rain/storm(CAPE)/cloud/snow/pressure/sst/current/salinity/wave/radar/elevation`: units, `domain` (physical range for the palette), `palette` id, and the `gfs:{vars,levels}` binding used by the GFS ingest. |
| `palettes.ts` | Colour ramps per variable as `[stop0..1, hex]`. `getPalette`. The **client** turns these into WeatherLayers ramps; the worker never colours pixels. |
| `manifest.ts` | `WeatherManifest` / `WeatherVariableManifest` types — the worker↔web wire contract (files, `imageUnscale`, `bbox`, `nests[]`, `domain`, `palette`). |
| `jobs.ts` | Allowlist of admin-triggerable BullMQ jobs (the `/admin/jobs` buttons). |
| `db/weather-run-model.ts` · `db/weather-texture-model.ts` | Mongoose models for a published run + its texture blobs. |

---

## 2. Worker — fetch, bake, store (`worker/src`)

### 2a. Per-model adapters (paired: pure helpers + ingest core)

Each model has **two** files: `sources/<model>.ts` (pure — URL builders, tokens, grid
math, unit-testable, no network) and `weather/<model>.ts` (the ingest core — download →
decode → bake → `publishSourceRun`, idempotent). The `refresh:<model>` script and the
scheduled job both call the same ingest core.

| Model | Pure helpers | Ingest core | Notes |
| --- | --- | --- | --- |
| GFS base | `sources/gfs.ts` | `weather/ingest.ts` (`runIngest`) + `weather/check.ts` | The original pipeline. `check` finds the latest cycle → `ingest` bakes every `variables[].gfs` field. **Only source of rain/storm/cloud/snow/pressure.** One-shot: `refresh:gfs` (`scripts/refreshGfs.ts`). |
| ICON global | `sources/iconGlobal.ts` | `weather/iconGlobal.ts` | Icosahedral → `cdo` remap → wgrib2. Gust (`vmax_10m`) has **no f000** → sources f001 into the fhr-0 slot. |
| ICON-EU / D2 | `sources/iconEu.ts` `sources/iconD2.ts` | `weather/iconEu.ts` `weather/iconD2.ts` (+ shared `weather/iconCommon.ts`) | DWD regular-latlon twin → single `wgrib2 -new_grid`. `iconCommon.bunzip2ToFile` decompresses `.bz2` (waits for stream flush — else truncated GRIB). |
| HRRR / HRDPS / UKV | `sources/hrrr.ts` `sources/hrdps.ts` `sources/ukv.ts` | `weather/hrrr.ts` `weather/hrdps.ts` `weather/ukv.ts` | US 3km / Canada 2.5km / UK 2km nests. |
| MRMS | `sources/mrms.ts` | `weather/mrms.ts` | US radar, **nest-only** (no global base). |
| Open-Meteo | `sources/openMeteo.ts` | `weather/openMeteo.ts` | Reads `.om` (WASM `@openmeteo/file-reader`). Projected nests **reproject at ingest** (see reproject.ts). Dims **self-heal**. |
| IFS | `sources/ifs.ts` | `weather/multiSource.ts` | ECMWF 0.25° (CCSDS-packed). |
| RTOFS global | `sources/rtofs.ts` | `weather/multiSource.ts` | netCDF tripolar → `cdo remapbil` → GRIB2. SST/current/salinity. |
| RTOFS regional | `sources/rtofsRegional.ts` | `weather/rtofsRegional.ts` | Per-window; **probes true grid from the GRIB header** (`regionalGridFromGeometry`), dims self-heal, antimeridian-aware bounds. |
| GFS-Wave mosaic | `sources/gfswave.ts` | `weather/multiSource.ts` (`ingestWaveMosaic`) | Regrids tiles to one global grid, composites by priority (`merge/mosaic.ts`). |
| GFS-Wave nests | `sources/waveNests.ts` | `weather/waveNests.ts` | Per-basin native grid; dims self-heal. |
| Elevation | — | `weather/elevation.ts` | Static ETOPO GeoTIFF → contour base. DEM cached on disk; **skips the bake if already published** (pass `force`/`ELEVATION_FORCE=1`). |

### 2b. The bake pipeline (`worker/src/grib`)

| File | Role |
| --- | --- |
| `wgrib2.ts` | Thin wrapper: `extractField` (decode a GRIB record to a Float32 grid), `probeGridGeometry` (read nx/ny/lat/lon from the header — never trust guessed dims). |
| `bakeScalar.ts` / `bakeVector.ts` / `bakeWind.ts` | Grid → PNG. Scalar = value in R (+`imageUnscale` decode range); vector = u/v in R/G. `preRolled` skips longitude roll, `skipUnitConvert` for already-display-unit fields. |
| `encode.ts` | PNG encode, longitude roll, de-accumulation (rain/APCP). |
| `bake.ts` | `imageUnscaleFor` (per-variable encode range) + `BakeResult`. |
| `bakeWorker.ts` / bake pool | Runs `bakeScalar/Vector` in a **worker_thread** so encoding doesn't block the event loop. |

### 2c. Grid transforms

| File | Role |
| --- | --- |
| `weather/reproject.ts` | **Projected `.om` → lat/lon.** `lccProjector` (Lambert Conic), `rotatedProjector` (rotated-pole, −180 offset), `reprojectScalar` (forward-project each output cell → nearest-sample native grid, NaN out-of-grid "fan" → transparent). |
| `regrid/curvilinear.ts` | RTOFS tripolar netCDF → regular lat/lon (scatter + pinhole fill), fallback when `cdo` isn't used. |
| `netcdf/toGrib2.ts` | `cdo -f grb2 -remapbil` wrapper (RTOFS netCDF → GRIB2). |
| `merge/mosaic.ts` | Composite several tiles onto one grid by priority + seam feather (wave mosaic). |

### 2d. Store, schedule, publish, politeness

| File | Role |
| --- | --- |
| `weather/publishSourceRun.ts` | Write a per-model `WeatherRun` + `WeatherTexture`s, tagged with source metadata (sourceId/bbox/resolution/priority). The single publish path. |
| `weather/retention.ts` | Prune old runs per model. |
| `weather/download.ts` | `downloadToTemp`, `headOk`, temp cleanup. |
| `weather/politeness.ts` | `nomadsGate()` — process-wide ~10 s throttle so concurrent jobs don't hammer NOAA. |
| `weather/config.ts` | `cfg()` — model, forecast hours/steps, retention, from env. |
| `weather/sourceSchedule.ts` | Cadence → next-run timing for the scheduler. |
| `jobs/weather.ts` | Job handlers (`refreshIfs/refreshRtofs/…`, `check`, `ingest`) — thin routers to the ingest cores. |
| `index.ts` | Worker entry: BullMQ `Worker` (**concurrency 5**), registers repeatable schedules, HTTP health on 10102. |
| `scripts/refresh*.ts` | Standalone one-shots (`ts-node`) wrapping each ingest core — populate a dev DB without the scheduler. `refresh:all` runs them all sequentially. |
| `scripts/checkMapAlignment.ts` + `scripts/coastline.ts` | **`yarn check:maps`** — overlay the true coastline on each served texture to eyeball georeferencing. |

**Idempotency + self-heal:** every ingest checks `alreadyPublished(model, run)`. The
open-meteo / wave-nest / rtofs-regional adapters extend it with **grid-dims comparison** —
if the published run's dims differ from what the current descriptor/probe produces, it
re-bakes (this is how a corrected grid replaces a stale one).

---

## 3. Public — compose & draw (`public/src`)

| File | Role |
| --- | --- |
| `lib/manifest.ts` | **`composeManifest`** — `db.latestPublishedRunsByModel()` → per variable pick the highest-priority **base** (with files) and attach every covering source as a **nest** (sorted coarsest→finest by priority). Promotes a global-coverage nest to base when a variable has no true base. Served at `/api/weather/manifest`. |
| `components/layers/resolve.ts` | **Pure nest resolver.** `resolveEntries` = base + active nests (`zoom ≥ minZoom` AND centre in bbox; minZoom lowered by 1). `viewCentralBbox` + `bboxContainsBbox` + **`rankNestsByFit`** = the best-fit single-winner decision (finest-resolution nest that covers the central view; empty → base only). |
| `components/layers/index.ts` | **GL builders.** `scalarRasterLayers` / `vectorParticleLayers`: draw the base (DEPTH_OCCLUDE), then the **one** best-fit loaded nest over it (DEPTH_PAINT). `pickBestFitLoaded` walks `rankNestsByFit`; `pickCoarsestLoaded` promotes a base for nest-only variables. |
| `components/layers/props.ts` | Manifest entry → deck layer props: **decode `imageUnscale` → colour with `scalePaletteToDomain(getPalette(...))`**. This is the "actual" render maths the check tool mirrors. |
| `components/layers/sourceDebug.ts` | `showMapSource` debug overlay — draws each active nest's bbox + label. |
| `lib/textures.ts` | Texture URL → loaded image cache (the `TextureResolver`). |
| `components/Globe.tsx` | deck.gl `_GlobeView`; feeds `{center, zoom}` to the resolver; `zoomForBbox` (span↔zoom, the inverse `viewCentralBbox` uses). |

---

## 4. Data contracts you must not break

- **Texture encoding:** scalar = physical value linearly mapped to R via `imageUnscale`
  `[min,max]`; α=0 = nodata. Vector = u→R, v→G. `domain` (physical) drives the palette,
  `imageUnscale` drives the decode — they are **different ranges** (e.g. wave domain
  `[0,12]` m but unscale `[0,30]`).
- **Grid convention:** baked textures are row 0 = **north**, col 0 = **−180°**, regular
  lat/lon. Antimeridian windows carry `east > 180`.
- **Base vs nest:** a `minZoom` makes a source a nest. Nests never straddle ±180 except
  the RTOFS/ wave windows, which the resolver/coastline handle with a +360 wrap.
- **Priority:** higher wins the base slot per variable; `rankNestsByFit` picks the
  **finest resolution** among covering nests, not priority order.

## 5. Gotchas (learned the hard way)

- Grid dims are **not** derivable from a `crs_wkt` envelope — probe the header
  (`probeGridGeometry`) or use the model's published `ProjectionGrid` def.
- Projected `.om` grids baked flat **shear**; must reproject at ingest.
- `alreadyPublished` without a dims check serves **stale** textures after a grid fix —
  hence the self-heal.
- Gust/CAPE-type **max-over-interval** fields have no f000 analysis step.
- `bunzip2` to a stream must wait for **flush** or wgrib2 reads a truncated GRIB.
- The `.om` `FileBackend` must be **closed** (not GC'd) or fds leak toward `EMFILE`.
- `check:maps` is a debug **eyeball** tool — it mirrors the client render but is not it;
  trust the served texture pixels, not the overlay's contrast stretch.
