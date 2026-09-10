# Live Weather Globe

A single-domain monorepo that turns NOAA **GFS** forecast data into a live,
broadcast-ready 3D weather globe. A worker ingests GFS, bakes the fields into PNG
textures, stores them plus a run manifest in **MongoDB**, and announces each new
run over the socket. A Next.js frontend renders a **MapLibre** globe from those
textures. An operator drives the on-air `/watch` view live over the socket, with
the end goal of streaming the globe to YouTube (e.g. via OBS).

> Single-domain by design: there is exactly one logical site, so there is **no**
> master/tenant DB split and no per-domain routing.

## How it works

```
            NOAA GFS (GRIB2)
                  │
                  ▼  worker/jobs/weather.ts  (check → ingest)
         decode w/ wgrib2 → bake PNG textures
                  │
                  ▼
            MongoDB  (textures + run manifest)
                  │            │
   weather:run ───┘            └─── /api/weather/manifest, /api/weather/tex/[id]
        │                                        │
        ▼                                        ▼
     socket  ──control:state / weather:run──▶ public (Next.js + MapLibre globe)
        ▲                                        │
        └──────────── /control operator ────────┘
```

1. The **worker** periodically checks for a fresh GFS run (`RUN_CHECK_CRON`).
   When one is available it ingests `FORECAST_HOURS` of forecast at `STEP_HOURS`
   resolution for `MODEL`, decodes the GRIB2 with `wgrib2`, bakes PNG textures,
   and writes them with a run manifest to Mongo. Old runs are pruned to the last
   `RETAIN_RUNS`.
2. After a successful run the worker emits a `weather:run` socket event.
3. The **socket** server relays worker `weather:run` events and operator
   `control:state` events to browsers.
4. The **public** app serves the globe pages and the API routes that expose the
   manifest + textures from Mongo.

## Packages

| Package   | Name                  | Purpose |
|-----------|-----------------------|---------|
| `shared`  | `@photonsurge/shared` | Shared lib: Mongo connection, DB CRUD factory, BullMQ queue, JWT, env, logger. Built to `dist/` and consumed via `file:../shared`. |
| `public`  | `public`              | Next.js 16 frontend. Renders the MapLibre weather globe, mints socket tokens, and exposes the weather/cities/broadcast/geocode API routes. |
| `socket`  | `socket`              | Socket.IO server. Authenticates `user` (browser) and `worker` (service) actors; relays `weather:run` and `control:state` events. |
| `worker`  | `worker`              | BullMQ worker. Auto-discovers job handlers in `src/jobs/`; ingests GFS, bakes textures into Mongo, emits `weather:run`. Needs `wgrib2` at runtime. |

There is no root `package.json`. Each package installs independently; `shared`
is linked into the others via a `file:` dependency.

## Pages

| Page       | Purpose |
|------------|---------|
| `/watch`   | Clean broadcast globe with no operator chrome — the on-air view to capture in OBS / stream to YouTube. Reacts live to `control:state` and `weather:run`. |
| `/control` | Operator page that drives `/watch` live over the socket (camera, layer, forecast hour, etc.). |
| `/cities`  | Manage the city list stored in Mongo (add / remove labelled points on the globe). |

## API routes (public)

| Route | Purpose |
|-------|---------|
| `GET /api/weather/manifest` | Latest run manifest (available layers, forecast hours, texture ids). |
| `GET /api/weather/tex/[id]` | Streams a baked PNG texture from Mongo by id. |
| `GET/POST/DELETE /api/cities` | CRUD for cities stored in Mongo. |
| `GET/POST /api/broadcast/state` | Read / set the current broadcast (control) state. |
| `GET /api/geocode` | Geocode a place name via `GEOCODER_URL` (Nominatim by default). |

## Local development

This is the primary way to run the stack — **no Docker needed**. Requires Node
24+, Yarn 1.x, a local (or remote) **MongoDB** and **Redis**, and `wgrib2` on
`PATH` only if you want the worker to ingest real GFS data (the `seedSample` demo
below needs neither NOAA nor `wgrib2`). Install wgrib2 with **`./buildWgrib.sh`**
(builds from NOAA source — needs cmake, which it installs).

### Ports

We run on a dedicated **`1010x`** range so nothing collides with hydra
(`3000`/`4000`/`5000`):

| Service | Port | URL |
|---|---|---|
| `public` (web) | **10100** | http://localhost:10100 |
| `socket` | **10101** | — |
| `worker` (HTTP health only) | **10102** | — |

These are wired in `.env` (`NEXT_PUBLIC_SOCKET_URL`, `SOCKET_URL`,
`ALLOWED_ORIGINS`) and baked into each package's `dev`/`start` script, so plain
`yarn dev` already binds the right port.

```bash
# 1. Env
cp .env.sample .env        # for local, point MONGODB_URI/REDIS_SERVER at 127.0.0.1
# generate secrets: openssl rand -hex 32  → JWT_SECRET, WORKER_AUTH_SECRET, SOCKET_TOKEN_SECRET

# 2. Build the shared lib (the others depend on its dist/)
cd shared && yarn install && yarn build && cd ..

# 3. Install + run each service (separate terminals)
cd socket && yarn install && yarn dev      # :10101  socket relay
cd worker && yarn install && yarn dev      # :10102  health + BullMQ consumer
cd public && yarn install && yarn dev      # :10100  Next.js globe
```

Open http://localhost:10100/watch for the globe and http://localhost:10100/control
to drive it.

> After changing anything in `shared`, run `./update-shared` to rebuild it and
> refresh the copy inside `worker`, `socket`, and `public`.

### Demo without external data (seed a synthetic run)

You don't need NOAA access (or `wgrib2`) just to see the globe render. The worker
exposes a `seedSample` handler that writes a synthetic run + textures to Mongo, so
`/watch` has something to draw immediately.

With the **worker running** (`cd worker && yarn dev`), in another terminal:

```bash
cd worker && yarn seed     # enqueues weather.seedSample; the worker bakes + publishes
```

Then load http://localhost:10100/watch — it should render the synthetic run.
(`check`/`ingest` are the real GFS path; `seedSample` is purely for local demos.
The worker auto-discovers `worker/src/jobs/weather.ts`, which exports `check`,
`ingest`, and `seedSample`.)

## Docker

Each service has a Dockerfile that builds from the **repo root** (so `shared` is
in the build context). The `worker` image is based on `node:24-bookworm-slim` and
installs `wgrib2` so it can decode GRIB2 at runtime. `docker-compose.yml` wires up
Mongo, Redis, and all three services. Storage is Mongo — there is no separate
static-file / object-store service; Next serves textures from Mongo via
`/api/weather/tex/[id]`.

```bash
cp .env.sample .env     # fill in secrets; use service-name hosts (mongodb/redis)
./build                 # build shared + all images
./start.sh              # docker compose up -d
./stop.sh               # docker compose down   (add -v to wipe data)
```

Published ports: `public` → 10100, `socket` → 10101 (the `1010x` range, off
hydra's 3000/4000/5000). Mongo, Redis and `worker` stay internal to the compose
network. The weather/geocode env vars flow into the `worker` and `public`
containers via `env_file: .env` — no per-service wiring needed.

### Deploy: test → live

Images move through two tags. `./build` pushes every service as `:test` (plus
its own `package.json` version); `./deployMiranda` runs `:test` on the test box
(miranda); once it looks right there, `./deployLive` re-pulls `:test` from the
registry, re-tags it `:latest`, pushes, and deploys the live box — so live runs
byte-for-byte the images that were tested. `:latest` is only ever written by
`deployLive`.

```bash
./build && ./deployMiranda      # build + push :test, deploy the test box
./deployLive                    # promote :test -> :latest, deploy the live box
TAG=1.4.2 ./deployLive          # roll live to one version tag (no promotion)
PROMOTE=0 ./deployLive          # re-deploy whatever :latest already is
NO_UP=1 ./deployMiranda         # sync compose + env + assets only
```

Each box has its own env file — `.env.deploy` for miranda, `.env.live` for the
live box asguard (`asguard@asguard.thronix.uk`; both gitignored; `.env.live` starts as a copy of `.env.deploy` with
every `CHANGEME.example` replaced by the live domain). The deploy pins
`TAG=<tag>` into the copy it syncs to the host as `~/weather/.env`, so a by-hand
`docker compose up` there resolves the same images. One public image serves both
boxes because the socket URL baked at build time (`NEXT_PUBLIC_SOCKET_URL`) is
overridable at runtime with `SOCKET_PUBLIC_URL` in the host env.

The live box fronts itself: `COMPOSE_PROFILES=caddy` + `SITE_DOMAIN=<domain>` in
its env enable the in-compose Caddy service (`infra/Caddyfile`) — HTTPS via
Let's Encrypt, the Next app at `/` and Socket.IO at `/socket.io/` on that one
domain, reaching the services over the compose network so `BIND_HOST` stays on
loopback. miranda has no caddy — it stays behind the host nginx
(`infra/nginx.weather-channel.conf`), and `deployMiranda` strips any
`COMPOSE_PROFILES` line from the env it syncs so the profile can't be switched on
there by accident.

### Run on another box (self-contained, no registry)

`./build` / `./start.sh` push to and pull from the private titan registry. On a
fresh box with no registry access, build the images **locally** instead — the
compose file already carries `build:` sections, so `--build` needs nothing but
the repo and Docker.

```bash
# 0. On the box: install Docker Engine + the compose plugin, then clone the repo
#    (the FULL repo is the build context — shared/ must be present).
git clone <repo-url> weather && cd weather

# 1. Env: copy the sample and fill it in.
cp .env.sample .env
#    - openssl rand -hex 32  → JWT_SECRET, WORKER_AUTH_SECRET, SOCKET_TOKEN_SECRET
#    - set MONGO_ROOT_PASSWORD / REDIS_PASSWORD (and match them in MONGODB_URI)
#    - NEXT_PUBLIC_SOCKET_URL is BAKED INTO the client bundle at build time, so it
#      must be the socket URL the *browser* will hit (e.g. http://<box-ip>:10101).
#    - ALLOWED_ORIGINS must list the public URL (e.g. http://<box-ip>:10100).
#    - BIND_HOST=0.0.0.0 to reach the ports directly (default 127.0.0.1 = nginx only).

# 2. Basemap assets are git-ignored — fetch them BEFORE building or the globe has
#    no satellite/terrain/borders (needs curl on the host).
./fetch-assets.sh

# 3. Build the images locally and start the whole stack (mongo + redis + 3 services).
docker compose up -d --build

# --- day to day ---
docker compose ps                 # status
docker compose logs -f worker     # follow a service (worker | socket | public)
docker compose up -d --build      # rebuild + restart after a git pull
docker compose down               # stop  (add -v to also wipe mongo/redis volumes)
```

Compose's `blob-init` service prepares the host blob directory for the worker
and public app (UID/GID 1001) before they start. For an older installation with
root-owned files already inside that directory, repair the mounted store once:

```bash
docker compose run --rm --no-deps --user 0:0 --entrypoint sh worker -c 'chown -R 1001:1001 /app/blobs'
docker compose up -d
```

This uses the configured blob mount, including a custom `BLOB_DIR`. It changes
ownership only; it does not delete cached textures or other blobs.


Then open `http://<box-ip>:10100`. If you front it with nginx/TLS instead, leave
`BIND_HOST` at `127.0.0.1` and point the vhost at `127.0.0.1:10100` (web) and
`127.0.0.1:10101` (socket). Re-run step 3's `--build` whenever `NEXT_PUBLIC_SOCKET_URL`
changes, since it's compiled into the client bundle.

## Environment variables

### Core / infra

| Variable | Used by | Notes |
|---|---|---|
| `MONGODB_URI` | shared/worker/public | Single database connection string. |
| `REDIS_SERVER`, `REDIS_PORT`, `REDIS_PASSWORD` | shared (BullMQ) | Queue + cache. |
| `JWT_SECRET` | shared | Default JWT signing secret (issuer `thronix`). |
| `WORKER_AUTH_SECRET` | worker, socket | Signs/validates the `worker` actor token. |
| `SOCKET_TOKEN_SECRET` | public, socket | Signs/validates the browser (`user`) token. |
| `SOCKET_URL` | worker | Server-to-server URL of the socket server. |
| `NEXT_PUBLIC_SOCKET_URL` | public | Browser-facing socket URL (inlined at build). |
| `ALLOWED_ORIGINS` | socket | CORS allow-list (comma separated). |
| `APP_DOMAIN` | public | Logical label carried on queue jobs. |

### Weather pipeline (worker)

| Variable | Default | Notes |
|---|---|---|
| `MODEL` | `gfs` | Forecast model to ingest. |
| `FORECAST_HOURS` | `48` | How far ahead to ingest each run. |
| `STEP_HOURS` | `3` | Spacing between ingested forecast hours. |
| `RUN_CHECK_CRON` | `*/30 * * * *` | How often the worker checks for a new run. |
| `RETAIN_RUNS` | `3` | Number of recent runs kept in Mongo (older ones pruned). |

### Geocoding (web `/api/geocode`)

| Variable | Default | Notes |
|---|---|---|
| `GEOCODER_URL` | `https://nominatim.openstreetmap.org` | Base URL of the geocoding service. |

## Testing

Each package has its own test suite — run `yarn test` inside any of `shared`,
`socket`, `worker`, `public`. The `public` package uses **Jest** + **React
Testing Library**. To run them all from the repo root:

```bash
./test
```

## Conventions

- **Never use Mongo `_id`.** Every entity has its own string `id` (UUID). The DB
  factory (`shared/src/db/generic.ts`) keys everything on `id` and strips `_id`.
- DB responses are always `{ success, data?, errors? }` (`tGeneralResponse`).
- Jobs are dispatched as `{ type, event, data }`; the worker routes them to the
  matching exported function in `src/jobs/<type>.ts`.

### Add a new background job

1. Create `worker/src/jobs/<type>.ts` exporting a function per event:
   ```ts
   import type { Job } from "bullmq";
   export async function create(job: Job) { /* ... */ }
   ```
2. Enqueue it from anywhere: `sendToQueue("default", "<type>", "create", { ... })`.
3. (Optional) emit a result to clients with `emitWorkerEvent({ type, data })`.

### Add a new collection

Add a `makeCollection<T>(conn, "name")` line to `createDb()` in
`shared/src/db/index.ts`, then rebuild shared.

## Scripts

| Script | What it does |
|---|---|
| `./buildWgrib.sh` | Build + install `wgrib2` from NOAA source (needs cmake; uses sudo). Required only for the real GFS path. |
| `./build` | Build `shared`, then build + push all Docker images as `:test` + `:<version>`. |
| `./deployMiranda` | Deploy `:test` to the test box (miranda) — syncs compose/env/infra/assets, `pull && up -d`. |
| `./deployLive` | Promote `:test` → `:latest` in the registry, then deploy the live box. |
| `./deploy` | Shared body behind the two above (`HOST`/`ENV_DEPLOY`/`TAG` required; not run bare). |
| `./start.sh` / `./stop.sh` | `docker compose up -d` / `down`. |
| `./test` | Run `yarn test` in `shared`, `socket`, `worker`, and `public`. |
| `./update-shared` | Rebuild `shared` and refresh it in every dependent. |
| `./version-update [-m] [pkg]` | Bump patch (or minor) version in one/all packages. |
