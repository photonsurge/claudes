# Architecture — Live Weather Globe

The "wtf is all this" guide. Read this first; per-file header comments cover the details.

## What it is
A broadcast-ready 3D weather globe for live streaming (YouTube/OBS). A worker ingests
NOAA **GFS** forecast data, bakes it into PNG textures stored in **MongoDB**, and a Next.js
app renders them on a **deck.gl GlobeView** sphere — animated wind, colour fields, contours,
country borders, cities, and live tracks. An **operator** page drives a clean **broadcast**
page live over a socket.

## Monorepo (no root package.json; each package installs independently)
| Package | Role |
|---|---|
| `shared` (`@photonsurge/shared`) | The contract. Mongoose models, the realtime `ControlState`, the weather `WeatherManifest`, the variable/palette/region/basemap registries, Mongo + BullMQ + JWT helpers. Built to `dist/`; consumed via `file:../shared`. After editing `shared/src`, run `./update-shared`. |
| `worker` | BullMQ consumer. Ingests GFS (→ `wgrib2` → PNG → Mongo), publishes a run, emits `weather:run`. Job handlers auto-discovered from `src/jobs/<type>.ts`; weather impl lives in `src/weather/*`. |
| `socket` | Socket.IO relay. Fans `worker:event` (e.g. `weather:run`) and operator `control:state` out to browsers in the `public` room. |
| `public` | Next.js app. Pages `/watch` (clean broadcast globe), `/control` (operator), `/cities`, `/admin`. Serves textures/manifest/cities/state via API routes; renders the globe. |

## Data flow
```
NOAA GFS (NOMADS) ─► worker (wgrib2 → PNG) ─► Mongo: WeatherTexture + WeatherRun(manifest)
                                                   │           │ emit weather:run
                                                   ▼           ▼
            public /api/weather/manifest + /tex/[id]      socket ──► browsers
                                                   │                    │
operator /control ─ control:state (socket) + PATCH /api/broadcast/state │
                                                   ▼                    ▼
                                          /watch  ◄── deck.gl GlobeView renders it
```

## Weather pipeline (worker)
> **Detailed file-by-file source map:** [`docs/weather-source-map.md`](docs/weather-source-map.md)
> — every ingest adapter, the bake pipeline, grid transforms, manifest composition, the
> nest resolver, data contracts, and the hard-won gotchas. Start there when touching maps.

- `src/sources/gfs.ts` builds NOMADS GRIB-filter URLs + finds the latest complete cycle.
- `src/weather/ingest.ts` downloads each variable×forecast-hour, bakes via `src/grib/*`
  (`wgrib2` → raw Float32 → `sharp` PNG), stores `WeatherTexture` docs, then writes the
  `WeatherRun` manifest with `published:true` **last** (atomic publish), emits `weather:run`,
  runs retention. Per-variable resilience: a missing field (e.g. APCP/rain has no record at
  f000) skips that variable, it doesn't fail the run.
- `src/weather/seed.ts` (`weather.seedSample`) fabricates a synthetic run with no
  network/wgrib2 — the offline demo path.
- Trigger on demand from `worker/`: `yarn seed` (synthetic), `yarn pull` (real GFS),
  `yarn seed:cities` / `yarn seed:capitals` (city overlay data).

## Textures (the worker↔web contract)
All textures are **PNG**, decoded on the GPU via WeatherLayers `imageUnscale`:
- **wind**: RGBA, R=u G=v, `imageUnscale` range → `ParticleLayer`.
- **scalar** (temp/humidity/rain/storm/gust): value in a channel, `imageUnscale` decode +
  `palette`+`domain` colour → `RasterLayer`. Palette stops must be **physical units**
  (scaled to the domain) or every value clamps to the hottest colour.
- Texture URLs end in `.png` (`/api/weather/tex/<id>.png`) so the loader picks the decoder.

## Web rendering (public)
- **`components/Globe.tsx`** — thin orchestrator: a deck.gl `Deck` + `_GlobeView`
  (controller), camera ref + transitions, three effects (init / external-camera-follow /
  layer-rebuild). It composes layer builders; it does NOT define them.
- **`components/layers/basemap.ts`** — basemap builders. Dark = ocean SolidPolygon +
  land/border GeoJSON (recolourable via `basemapColors`). Satellite/terrain = a single 4k
  global image base, with sharp XYZ `TileLayer` overlaid only above `TILE_MIN_ZOOM` (small
  tiles avoid the flat-quad chord artifacts that big low-zoom tiles cause on a sphere).
- **`components/layers/*`** — weather (raster/particle/pressure), cities, tracks builders.
- Basemap assets are served locally from `/data` (gitignored; `./fetch-assets.sh`).

## Realtime control (operator → broadcast)
`shared/control.ts` defines `ControlState` (active variable, fhr, basemap + colours, layer
toggles, wind settings/mode, camera, units, track toggles). `/control` is the source of
truth: every change emits `control:state` over the socket (instant) and debounce-PATCHes
`/api/broadcast/state` (durable). `/watch` cold-starts from the API then live-applies
`control:state`. `mergeControlState` (pure, tested) merges untrusted patches safely.

## Cities & tracks
- **Cities**: ~7.3k Natural Earth places in Mongo (name/country/cc/region/population/
  isCapital/rank). `/api/cities?limit&minPop&capital` powers filterable overlays.
- **Live tracks** (`lib/tracks/*`, `components/tracks/*`): satellites (SGP4 from Celestrak
  TLEs, client-side), aircraft (ADS-B/OpenSky), ships (AIS/aisstream). Toggled in control.

## Ports & running (local, no Docker)
Ports `1010x` (off hydra's 3000/4000/5000): **web 10100 · socket 10101 · worker 10102**.
Mongo (27017) + Redis (6379) run locally. Per package: `yarn dev`. Build `shared` first.
See README for the full local-dev steps.

## Hard-won gotchas (don't regress these)
- Weather must render on **deck.gl GlobeView**, not a MapLibre globe — deck can't bind
  layers to MapLibre's globe projection.
- **deck.gl + luma.gl pinned to match weatherlayers-gl** (currently 9.3.x ↔ weatherlayers
  2026.x). Mismatch → `bitmapUniforms` shader error.
- weatherlayers-gl is **lazy-imported browser-only** (it touches `Worker` at import → SSR
  crash otherwise).
- `wgrib2` needs `-inv /dev/null` or it writes its inventory into the binary stream.
- Texture route returns 404 (no-store) for empty bodies — never an immutable empty PNG.

## Testing
Every package has `yarn test` (jest); run all with `./test`. Pure logic is tested "to
breaking"; WebGL/MapLibre/deck are mocked under `public/src/test/mocks`.
