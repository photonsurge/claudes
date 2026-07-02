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

## Weather pipeline

**Global bases** (always-on, whole-globe):

| Command | Source |
| --- | --- |
| `yarn pull` | Kick the real GFS pipeline now (enqueues `weather.check`; needs the worker running). |
| `yarn refresh:ifs` | ECMWF IFS 0.25° (off by default until CCSDS-validated). |
| `yarn refresh:waves` | GFS-Wave global height/direction mosaic. |
| `yarn refresh:rtofs` | RTOFS global SST / currents / salinity. |
| `yarn refresh:icon-global` | DWD ICON 13 km — the worldwide "everywhere" field; **de-facto base for temp/wind/humidity**. |

**Regional nests** (zoom-gated high-res overlays):

| Command | Region |
| --- | --- |
| `yarn refresh:icon-eu` | ICON-EU — Europe 6.5 km |
| `yarn refresh:icon-d2` | ICON-D2 — central Europe 2 km |
| `yarn refresh:hrrr` | HRRR — US 3 km |
| `yarn refresh:mrms` | MRMS — US radar (nest-only) |
| `yarn refresh:hrdps` | HRDPS — Canada 2.5 km |
| `yarn refresh:ukv` | UKV — UK 2 km |
| `yarn refresh:openmeteo` | Open-Meteo `.om` national high-res family (JMA, AROME-France, MeteoSwiss, …) |
| `yarn refresh:wave-nests` | GFS-Wave basin nests (atlocn / epacif / wcoast / ecg) |
| `yarn refresh:rtofs-regional` | RTOFS regional windows (11 windows) |

Each weather refresh is **idempotent** — if that model+run is already published
it re-checks and skips (no re-bake, no upstream hammering).

## Maintenance / reset

| Command | What it does |
| --- | --- |
| `yarn reingest` | Delete every `WeatherRun` + `WeatherTexture`, then enqueue `weather.check` to re-ingest the latest GFS cycle from scratch. |
| `yarn reset:weather` | **Destructive.** Wipe all baked runs/textures and re-kick the **whole** ingest fleet so everything re-bakes onto the current grids. Use after a descriptor/grid change or when maps look stale/misaligned. Worker must be running. |

> Neither reset is needed for **compose-time** changes (how the manifest picks
> bases/nests) — those apply on the next manifest request; just restart `public`.
> Reset only when the **baked textures** themselves are wrong (grid/bbox change).
