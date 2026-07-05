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
| `yarn refresh:satimg` | Bake the satellite-imagery frame into Mongo (`db.satimg`). Default source = GIBS (no setup). |

### Satellite imagery

The `satimg.refresh` job (and `yarn refresh:satimg`) bakes cached satellite frames into
Mongo (`db.satimg`, keyed by `satId`); the public app reads only that cache. The operator
ticks each feed on/off + opacity (`SATIMG_FEEDS`) and picks ONE global **look** every live
disc follows (`SATIMG_LOOKS` — GeoColor / IR / water vapour / air mass / dust / fire temp).
Each disc is baked in EVERY look it carries (satId `${disc}:${look}`) so switching is
instant; a disc that lacks the chosen look falls back to its `ir` frame (every disc bakes
one). Two sources, chosen by `SATIMG_SOURCE`:

**`gibs` (DEFAULT — pure Node, Docker-trivial, no Python).** One HTTP GET per feed of the
relevant NASA GIBS WMS layer (keyless, already reprojected to plate-carrée). The feeds:

- **`global`** — daily true-color mosaic (5 polar orbiters stacked in one WMS request to
  fill swath gaps), full globe, **cloud-keyed** via `sharp` (per-pixel alpha from
  brightness → clouds opaque, clear sky transparent so the globe/weather shows through).
  Defaults to *yesterday* (newest COMPLETE UTC day; "today" is a half-imaged globe).
  **Gap-filled** across the last few days: the freshest day's latest orbit is often only
  half-processed, leaving a solid black no-data wedge AND a half-ingested granule of thin
  bright scan-line stripes. `holeFill` composites newest-on-top and replaces only pixels
  that aren't *solid* (a pixel AND its two vertical neighbours must carry data — this
  rejects the lone scan lines the cloud-key would otherwise keep as fake white "cloud"
  stripes). Fresh pixels stay fresh; ghosting is confined to the holes. Residual stripes
  at the extreme south are polar-winter night (no daytime pass on any day) and unfixable.
- **DISCS** (`goes-east` · `goes-west` · `himawari` · `meteosat-0` · `meteosat-iodc`) —
  live geostationary, regional bbox, NOT cloud-keyed (shown whole, blended by opacity).
  Each is baked in every look from `LOOK_LAYERS` (`gibs.ts`): GOES/Himawari looks are GIBS
  ABI/AHI layers; the Meteosat discs come from **EUMETSAT's EUMETView WMS**
  (`view.eumetsat.int/geoserver/wms`, ALSO keyless — public GetMap, no account/token). MTG
  is at 0° (GeoColor/dust/fire), MSG fills 0°'s IR/WV/air-mass and the whole IODC disc at
  45.5°E. `looksFor(disc)` lists what to bake; `fetchDiscLook(disc, look)` fetches it. GIBS
  needs `STYLE=default`, EUMETView (GeoServer) needs an empty `STYLES` — the fetch branches
  on base URL. Together the five discs + the daily mosaic wrap the whole globe.
- **`lightning`** — OVERLAY feed (not a disc look): EUMETSAT MTG **Lightning Imager**
  (`mtg_fd:li_afa`), transparent 5-min flash activity over Europe/Africa/Atlantic, drawn on
  top. A quiet frame is tiny, so its `minBytes` guard is low (200 B).

Live fetches send NO `TIME` (the server returns the layer's latest slot) + `TRANSPARENT=true`.
Runs on a 30-min cron, ON by default. Every frame is guarded under Mongo's 16 MB BSON limit
(`maxPx` in `gibs.ts`, ~15.5 MB hard cap); a frame that errors is skipped, the rest bake.
The full bake is ~24 frames (mosaic + lightning + ~22 disc×look) — trim with `SATIMG_BAKE_LOOKS`.

| Env | Default | Meaning |
| --- | --- | --- |
| `SATIMG_SOURCE` | `gibs` | `gibs` (WMS fetch) or `satpy` (raw Himawari bake, below). |
| `SATIMG_REFRESH_ENABLED` | *(on)* | Set `false` to disable the cron. |
| `SATIMG_REFRESH_MS` | `1800000` | Bake cadence (30 min — live feeds refresh ~10-min). |
| `SATIMG_BAKE_LOOKS` | *(all)* | CSV allowlist of looks to bake per disc (e.g. `geocolor,ir,watervapour`); `ir` always kept. Trims frame count / Mongo size. |
| `SATIMG_WIDTH` / `SATIMG_HEIGHT` | `2048`/`1024` | `global` fetch size (kept < Mongo's 16 MB doc limit; discs size from per-feed `maxPx`). |
| `SATIMG_FILL_DAYS` | `3` | Consecutive days composited to gap-fill `global` (1 = off). |
| `SATIMG_CLOUDKEY` | *(on)* | Set `false` to store the opaque true-color as-is (no see-through). |
| `SATIMG_CK_LO`/`_HI`/`_GAMMA`/`_SATSUPPRESS`/`_BOOST` | see `grade.ts` | Cloud-key tuning (brightness ramp, desert suppression, cloud punch). |

**`satpy` (opt-in — raw Himawari-9 disk, needs a Python venv).** Shells out to
`src/satimg/himawari.py` (same shape as `wgrib2`): pulls the latest full-disk from the
open `noaa-himawari9` S3 bucket and reprojects via **satpy**. Live geostationary (~15-20
min) but heavy (HSD download + reproject, minutes) and Python-dependent — reach for it
only when you need a live disk. Setup (a **dedicated** venv — don't pollute base anaconda):

```
python3 -m venv worker/.venv-satimg
worker/.venv-satimg/bin/pip install -r worker/src/satimg/requirements.txt
SATIMG_SOURCE=satpy SATIMG_PYTHON=worker/.venv-satimg/bin/python yarn refresh:satimg
```

`SATIMG_COMPOSITE` (default `true_color`; `B13` = always-on IR) picks the band/composite.

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

## Long-term frame archive (history)

Every publish (GFS ingest and all `refresh:*` sources) also copies its
archive-eligible steps — default **f000 + f003**, i.e. the near-analysis — into
the `WeatherFrame` collection, which run retention **never prunes**. That's what
powers the `/api/weather/history/*` endpoints (point time series + min/max/avg
stats at any lat/lng, frame listings for later map replay).

| Command | What it does |
| --- | --- |
| `yarn archive:backfill` | One-shot: walk every published run still in Mongo and archive its eligible frames. Idempotent (upsert on model+variable+validTime; lower fhr wins). Run once to seed history. |

Env knobs (all optional):

- `WEATHER_ARCHIVE=off` — disable archiving entirely (on by default).
- `WEATHER_ARCHIVE_FHRS=0,3` — which forecast hours to archive per run.
- `WEATHER_ARCHIVE_KEEP_DAYS=0` — prune frames older than N days; `0` (default)
  keeps everything forever. At f000+f003 the archive grows a few tens of MB/day
  across the whole portfolio.

### Past-year climate cache (ERA5)

The `climate.snapshotClimate` repeatable (every 10 min, focus-driven like tides)
fetches the **past year of Open-Meteo/ERA5 daily climate** for the on-air camera
point + significant quakes — one Mongo doc per 0.1° key, refreshed daily, TTL'd
away two weeks after the focus moves on. The public
`/api/weather/history/climate` route (director-mode **PAST YEAR** charts) reads
Mongo only — the browser/Next never call the feed.

| Command | What it does |
| --- | --- |
| `yarn refresh:climate` | One-shot: run the focus-driven snapshot now (seed the cache for the current camera point without waiting out the cron). |

Env knobs: `CLIMATE_ENABLED=false` (kill switch), `CLIMATE_SNAPSHOT_MS`,
`CLIMATE_MAX_AGE_MS` (re-fetch age, default 24 h), `CLIMATE_MAX_FETCHES`
(politeness cap per tick), `CLIMATE_FOCUS_MIN_MAG`, `CLIMATE_TTL_SEC` (doc TTL),
and on the public side `CLIMATE_NEAREST_KM` (serve radius, default 300).

## Maintenance / reset

| Command | What it does |
| --- | --- |
| `yarn reingest` | Delete every `WeatherRun` + `WeatherTexture`, then enqueue `weather.check` to re-ingest the latest GFS cycle from scratch. |
| `yarn reset:weather` | **Destructive.** Wipe all baked runs/textures and re-kick the **whole** ingest fleet so everything re-bakes onto the current grids. Use after a descriptor/grid change or when maps look stale/misaligned. Worker must be running. |

> Neither reset is needed for **compose-time** changes (how the manifest picks
> bases/nests) — those apply on the next manifest request; just restart `public`.
> Reset only when the **baked textures** themselves are wrong (grid/bbox change).
