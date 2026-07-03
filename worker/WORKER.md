# Worker commands

The `worker` is the BullMQ processor + scheduler that owns **all** upstream calls
(NOMADS/DWD/ECCC/Open-Meteo weather, alerts, tracks, cams, satellites…). The
public app never fetches upstream — it reads only what the worker caches into
Mongo. Every command below is `yarn <script>` run from `worker/`.

> Most of these are also exposed as **"Run now" buttons** in the admin UI at
> [`/admin/jobs`](../public/src/app/admin/jobs/page.tsx) — the GUI equivalent of
> the weather/tracks/alerts one-shots, enqueued onto the same BullMQ queue.

## Two kinds of script

| Kind | Needs | Examples |
| --- | --- | --- |
| **Standalone one-shot** — does the fetch/bake itself, then exits | Mongo + network | all `refresh:*`, `ingest:*`, `enrich:*`, `seed:cities`, `snapshot:tracks` |
| **Enqueue** — pushes a job for a **running worker** to process | Mongo + Redis + `yarn dev` up | `seed`, `pull`, `reingest`, `reset:weather` |

Standalone one-shots are what you use to populate a fresh dev DB without waiting
for the schedulers — no need to restart or kill a running worker.

## Prerequisites

- Node, `yarn`, a reachable **Mongo** (`MONGODB_URI`) and **Redis**
  (`REDIS_SERVER`/`REDIS_PORT`/`REDIS_PASSWORD`).
- **wgrib2 / cdo** on `PATH` for the GRIB-baking weather adapters (the Docker
  image installs them; locally see `../buildWgrib.sh`).
- Copy `../.env.sample` → `../.env` and fill it in.

## Core / lifecycle

| Command | What it does |
| --- | --- |
| `yarn dev` | Run the worker (scheduler + processor) on `PORT=10102` via ts-node. |
| `yarn build` | Clean `dist/` and compile TypeScript. |
| `yarn start` | Run the compiled `dist/index.js` (production). |
| `yarn test` / `yarn test:watch` | Jest unit tests. |
| `yarn update-shared` | Pull the freshly-built `@photonsurge/shared` into this package (run the repo-root `./update-shared` after editing `shared/src`). |

## Seeding & demo

| Command | What it does |
| --- | --- |
| `yarn seed` | **Enqueue** a synthetic, published weather run (no NOMADS/wgrib2) so the globe renders immediately. Worker must be running. |
| `yarn seed:cities` | Seed the Cities overlay from GeoNames (tier via env, default `cities15000` ≈ 27k). Same core as the admin "Reseed cities" button. |
| `yarn seed:capitals` | Seed capital cities. |
| `yarn enrich:wiki [minPop] [limit]` | Attach Wikipedia photo/blurb to cities (same core as the admin "Enrich cities" button). Re-run after a reseed. |

## Live overlays (non-weather)

| Command | What it does |
| --- | --- |
| `yarn ingest:alerts` | Run every enabled alert source once (fetch → normalise → upsert) and print an active sample. |
| `yarn ingest:tles` | Fetch the configured CelesTrak groups (satellite TLEs) into Mongo. |
| `yarn snapshot:tracks` | Record one aircraft frame (+ ships if `AISSTREAM_API_KEY`) into Mongo. |
| `yarn refresh:cables` | Refresh the submarine-cable overlay (TeleGeography). |
| `yarn refresh:faults` | Refresh the tectonic plate-boundary overlay (Bird 2003). |
| `yarn refresh:tides` | Refresh tide-gauge stations + series (IOC sea-level). |
| `yarn refresh:cams` | Refresh the webcam catalog from the enabled providers. |
| `yarn refresh:satimg [satId]` | Bake one geostationary satellite full-disk (default `himawari9`) into a global PNG. **Needs the satpy venv — see below.** |

### Satellite imagery (satpy sidecar)

`refresh:satimg` and the `satimg.refresh` job shell out to a Python sidecar
(`src/satimg/himawari.py`) that pulls the latest Himawari-9 full-disk from the open
`noaa-himawari9` AWS bucket (no credentials), reprojects the geostationary disk onto
a global plate-carrée PNG via **satpy**, and stores one cached frame per bird in
Mongo (`db.satimg`). The Node worker only spawns the script + reads the PNG — the
same shell-out shape as `wgrib2`.

One-time setup (a **dedicated** venv — don't pollute base anaconda):

```
python3 -m venv worker/.venv-satimg
worker/.venv-satimg/bin/pip install -r worker/src/satimg/requirements.txt
```

Then point the worker at it and enable the job:

| Env | Default | Meaning |
| --- | --- | --- |
| `SATIMG_PYTHON` | `python3` | Interpreter — set to `worker/.venv-satimg/bin/python`. |
| `SATIMG_REFRESH_ENABLED` | *(off)* | Set `true` to register the repeatable bake job. Off by default so a worker without the venv doesn't fail every cycle. |
| `SATIMG_SATS` | `himawari9` | Comma list of birds to bake (one job each). |
| `SATIMG_REFRESH_MS` | `600000` | Bake cadence (~10 min = Himawari's FLDK scan interval). |
| `SATIMG_COMPOSITE` | `true_color` | satpy composite or bare band. `true_color` is daytime-only (night side transparent); use `B13` (clean IR) for an always-on cloud layer. |
| `SATIMG_RESOLUTION` | `0.05` | Output grid resolution in degrees. |

Smoke-test the bake before enabling the cron:

```
SATIMG_PYTHON=worker/.venv-satimg/bin/python yarn refresh:satimg
```

## Weather pipeline

### Which command produces which variable

The manifest composes each variable from its highest-**priority** published source
(base) plus any zoom-gated **nests**. So a variable only appears if *something*
below has published it. Notably, **rain / storm (CAPE) / cloud / snow / pressure
come from GFS ONLY** — if you haven't run `yarn pull`, they're absent entirely.

| Variable | Global base (priority) | Regional nests |
| --- | --- | --- |
| temp | **icon-global** (12) › gfs (10) | icon-eu, icon-d2, ukv, hrrr, hrdps, openmeteo |
| humidity | **icon-global** › gfs | icon-eu, icon-d2, ukv, hrrr, hrdps, openmeteo |
| wind | **icon-global** › gfs | icon-eu, icon-d2, ukv, hrrr, hrdps, openmeteo |
| gust | **icon-global** › gfs | openmeteo family |
| **rain** | **gfs only** | — |
| **storm (CAPE)** | **gfs only** | — |
| **cloud** | **gfs only** | — |
| **snow** | **gfs only** | — |
| **pressure** | **gfs only** (isobar contours) | — |
| sst / current / salinity | **rtofs** | rtofs-regional windows |
| wave | **gfswave-mosaic** | wave-nests (atlocn, wcoast) |
| radar | — (nest-only) | mrms (US) |
| elevation | **etopo** (static) | — |

### Global bases (always-on, whole-globe)

| Command | Source / notes |
| --- | --- |
| `yarn pull` | **How to get GFS.** Enqueues `weather.check` → ingests the latest GFS cycle (rain, storm/CAPE, gust, pressure, cloud, snow, + temp/wind/humidity). **Non-destructive**; needs the worker running. No `refresh:gfs` one-shot exists — GFS runs through the queue. |
| `yarn refresh:icon-global` | DWD ICON 13 km worldwide — **base for temp/wind/humidity/gust** (priority 12 > GFS 10, so it wins those). Gust sources f001 (no f000 analysis step). |
| `yarn refresh:rtofs` | RTOFS global SST / currents / salinity. |
| `yarn refresh:waves` | GFS-Wave global significant-height mosaic. |
| `yarn refresh:ifs` | ECMWF IFS 0.25° (off by default until CCSDS-validated). |
| `yarn refresh:elevation` | Static ETOPO topo+bathy contour base (rarely needs re-running). |

### Regional nests (zoom-gated high-res overlays)

| Command | Region |
| --- | --- |
| `yarn refresh:icon-eu` | ICON-EU — Europe 6.5 km |
| `yarn refresh:icon-d2` | ICON-D2 — central Europe 2 km |
| `yarn refresh:hrrr` | HRRR — US 3 km |
| `yarn refresh:mrms` | MRMS — US radar (nest-only) |
| `yarn refresh:hrdps` | HRDPS — Canada 2.5 km |
| `yarn refresh:ukv` | UKV — UK 2 km |
| `yarn refresh:openmeteo` | Open-Meteo `.om` national high-res family (JMA, AROME-France, MeteoSwiss, DMI, MET-Norway, KNMI, AROME-Austria, ICON-2I). Several are **reprojected** at ingest (LCC / rotated-pole). |
| `yarn refresh:wave-nests` | GFS-Wave basin nests (atlocn, wcoast; epacif disabled — antimeridian). |
| `yarn refresh:rtofs-regional` | RTOFS regional windows (bering, atlocn, hawaii, …). |

Each weather refresh is **idempotent** — if that model+run is already published
it skips (no re-bake, no upstream hammering). Several adapters (open-meteo, wave-
nests, rtofs-regional) also **self-heal**: if a published run's grid dims differ
from what the current descriptor/probe would produce, they re-bake it.

### Validation

| Command | What it does |
| --- | --- |
| `yarn check:maps` | Dump a coastline-overlay per served weather texture to `scratchpad/align/` to eyeball georeferencing. `--var <id>` / `--only <sourceId,…>` to scope; needs `public` running. |
| `yarn check:satimg` | Dump a coastline-overlay per satellite disk to `scratchpad/satimg/` to eyeball the geostationary footprint / reprojection. Uses the worker-baked frame when `public` is up, else a **synthetic** disk computed from the visibility geometry (runs offline, no satpy). `--sat <id>` to scope; `--synthetic` to force the stand-in. |

### Reload every map — `yarn refresh:all`

One command reloads the whole list. It runs `pull` (GFS, async) then every
`refresh:*` **sequentially** — sequential is inherently polite to NOAA/DWD (one
download stream at a time), and it **continues past any map that fails** (e.g. a
fresh cycle still 404-ing on latency) instead of aborting the batch.

```bash
cd worker && yarn refresh:all
```

Use it after a `yarn reingest` (or on an empty DB) to repopulate everything. GFS
(rain/CAPE/cloud/snow/pressure) bakes asynchronously in the running worker while
the one-shots run, so it lands a little after the command returns.

> Don't run the `refresh:*` scripts in **parallel** — each is its own process, so
> they don't share the `nomadsGate` politeness throttle and would hammer upstream.
> `refresh:all` is sequential on purpose.

## Maintenance / reset

| Command | What it does |
| --- | --- |
| `yarn reingest` | Delete every `WeatherRun` + `WeatherTexture`, then enqueue `weather.check` to re-ingest the latest GFS cycle from scratch. |
| `yarn reset:weather` | **Destructive.** Wipe all baked runs/textures and re-kick the **whole** ingest fleet so everything re-bakes onto the current grids. Use after a descriptor/grid change or when maps look stale/misaligned. Worker must be running. |

> Neither reset is needed for **compose-time** changes (how the manifest picks
> bases/nests) — those apply on the next manifest request; just restart `public`.
> Reset only when the **baked textures** themselves are wrong (grid/bbox change).
