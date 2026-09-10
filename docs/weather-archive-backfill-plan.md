# Plan: backfill years of historical whole-globe weather maps

> Status: **R&D, not started.** No backfill-from-external-source path exists
> yet — `yarn archive:backfill` (`worker/src/scripts/archiveBackfill.ts`) only
> catches up `WeatherFrame` from `WeatherRun` docs still in Mongo (last ~18h,
> bounded by run retention), not from years of external history. This doc
> specs what a real backfill would need. See [[world-clock-plan]] for the
> consumer side (scrubbing the globe to a past instant `T`) — this doc is
> about the write path: getting years of real gridded data into the DB in
> the first place.

## Is backfilled data recallable? Yes — confirmed, zero new plumbing needed

This was the open question. Checked directly against the code:

- `WeatherFrame` (`shared/src/db/weather-frame-model.ts`) has **no TTL / expiry
  index** — just plain `created`/`updated` timestamps via `mongoTimestamps`.
  `archiveKeepDays()` defaults to `0` = no age cutoff, and there's no `.env`
  override in this deployment (`.env`/`.env.deploy` have no
  `WEATHER_ARCHIVE_KEEP_DAYS`).

  > **Updated 2026-09-10:** "nothing auto-prunes it" is no longer true. A daily
  > `weather.thinArchive` sweep now SAMPLES the archive — full cadence inside
  > `WEATHER_ARCHIVE_FULLRES_HOURS`, then one frame per (model, variable) per UTC
  > day kept forever, with zoom-gated nests dropped past their own window. That
  > was forced: keep-everything plus MRMS publishing every 2 minutes took the
  > blob store to 240 GB. See [[blob-retention-plan]]. A backfill would land at
  > daily resolution anyway, so this is compatible — but **pause thinning with
  > `WEATHER_ARCHIVE_THIN=off` while a backfill is importing**, so the sweep is
  > not thinning a half-written import.
- The repo's query methods (`shared/src/db/weather-frame-repo.ts`) —
  `listMeta({variable, model?, from?, to?})`, `getSeries(...)`,
  `getByID(id)` — take arbitrary `Date` ranges. Nothing restricts `from` to
  "recent." A frame dated 2019 is queried exactly like one dated yesterday.
- The existing HTTP surface already exposes this with no restriction:
  `GET /api/weather/history/point`, `/area`, `/frames`, `/tex/[id]`,
  `/variables` (`public/src/app/api/weather/history/*`) all accept
  open-ended `from`/`to` and stream whatever's in the collection.

**Conclusion**: any frame that lands in `WeatherFrame` — however it gets
there — is immediately and fully recallable through code that already
exists. The only missing piece is the *write* path: something that fetches
years of real historical gridded data and upserts it into `WeatherFrame` in
the same shape `archiveRun()` already writes (`model, variable, validTime,
run, fhr, encoding, units, imageUnscale?/vectorUnscale?, bounds, grid,
contentType, data, byteSize`).

## What's missing: a historical gridded source

The archive today only ever receives frames as a *side effect* of a live
publish (`archiveRun()` called from `ingest.ts`/`publishSourceRun.ts`, and
the one-shot `archive:backfill` script re-walking still-retained runs). None
of that reaches further back than run retention allows. Two existing sources
in this repo do NOT solve this:

- `shared/src/climate/openmeteo.ts` (Open-Meteo archive API, ERA5-backed) —
  already used for the per-city "PAST YEAR" climate panel. **Point-based
  daily aggregates only** — no bulk gridded export. Querying a 0.25° global
  grid point-by-point for multiple years would be millions of API calls; not
  viable for whole-globe maps.
- Live GFS/regional ingest (`worker/src/weather/*.ts`) — all read from
  sources that only publish current/near-term data (NOMADS GFS, Open-Meteo
  forecast `.om` grids, HRRR, ICON, etc.). None of them serve years-old
  analyses.

### Proposed source: ERA5 via Copernicus CDS

[ERA5](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels)
is the standard fit: real global reanalysis grid (~31km / ~0.25°), **hourly**,
1940–present, free with CDS account registration, GRIB or NetCDF output —
the same shape of input the worker's GRIB pipeline already consumes.

Practical constraints to design around:
- **Access**: requires a free Copernicus CDS account + API key
  (`~/.cdsapirc` or equivalent) — an account-signup step, not something to
  automate; the user provisions the key, the worker reads it from env like
  every other credential (`FIRMS_MAP_KEY`, `WINDY_WEBCAMS_API_KEY`, etc. —
  see `docs/external-sources-register.md`).
- **Queuing**: CDS bulk requests are queued server-side and can take
  minutes to hours per request, especially for large multi-year pulls. This
  needs a paced/polling fetch, the same shape as the existing
  `worker/src/weather/politeness.ts` throttle, not a tight loop.
- **Volume**: even restricted to 3-hourly (matching the live archive's
  existing cadence, not ERA5's native hourly) across a handful of variables
  (temp, wind u/v, pressure, humidity) for "a good few years," that's tens
  of thousands of PNG texture docs — plausibly 100GB+ if stored the same way
  as today (`data: Buffer` inline on the Mongo doc). The live path stays
  small because retention bounds it; a multi-year backfill has no such
  bound. **Worth sizing with a pilot before committing to full scope** — if
  it's too large for Mongo, textures would need to move to object storage
  (S3/R2/GridFS) with `WeatherFrame` holding a reference instead of `data`
  directly — a real schema change, not assumed here.

## Architecture: reuse the existing bake pipeline

No new baking/encoding logic needed. The worker already has:
- `worker/src/weather/bakeVariableStep.ts` — GRIB → scalar/vector PNG bake
  (imageUnscale/vectorUnscale, domain, palette).
- `worker/src/weather/reproject.ts` — reprojects a projected native grid to
  regular lat/lon before bake (Lambert Conformal Conic today; see
  `docs/openmeteo-grid-defs.md`). ERA5 is natively regular lat/lon, so this
  likely isn't needed for it, but the pattern's there if a chosen ERA5
  product isn't.
- `worker/src/grib/bakeWind.ts` — u/v → RGBA wind texture encoding.

A new `worker/src/weather/era5Backfill.ts` (or similar, one-shot script like
`archiveBackfill.ts`) would: fetch a CDS GRIB/NetCDF chunk for a
time-window, bake each variable/step with the existing bake functions, and
upsert straight into `WeatherFrame` via the existing `db.weatherFrames.upsert()`
— **bypassing `WeatherRun`/`WeatherTexture` entirely**, since those model
"the current run" with retention semantics that don't apply to one-shot
historical inserts.

## Open questions (need a decision before implementation, not R&D)
- Variable set for backfill (all live variables, or a reduced set for v1 —
  temp/wind/pressure are the obvious minimum)?
- Cadence: 3-hourly (matches live archive, 8x less volume) vs ERA5's native
  hourly?
- How many years — "a good few" needs a number to size storage/CDS quota
  against.
- Storage: inline Mongo `Buffer` (matches today's `WeatherFrame`) vs moving
  to object storage if volume is too large — this can't be answered without
  the pilot's real numbers.

## Recommended next step
A bounded pilot, not the full backfill: **1 variable (temp), 3-hourly, 1
year**, straight into `WeatherFrame` via a throwaway script mirroring
`archiveBackfill.ts`'s shape. That validates the CDS auth/queueing/pacing,
gives real per-frame byte sizes to extrapolate total volume from, and proves
the recall path (already confirmed above) end-to-end with real data before
committing to variable/cadence/year scope for the real thing.
