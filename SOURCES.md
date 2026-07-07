# Data Sources

Everything the globe shows comes from somewhere. This is a browsable map of every
external feed the worker ingests (or the browser fetches directly), what it gives
us, and where the code that talks to it lives.

> Looking for licensing, attribution wording, or which sources need a credits UI?
> See the full audit in [docs/external-sources-register.md](docs/external-sources-register.md).
> This file is the friendly tour; that one is the compliance ledger.

## How to read the tables

- **Cadence** is the worker's poll/refresh interval (cron, BullMQ repeatable job,
  or "manual" for a `yarn refresh:*` / `yarn seed:*` script).
- **Auth** is "—" when the feed is fully keyless/open.
- **Adapter** is the file that actually calls out to the source.

---

## 🌍 Global weather models

The base layers everyone sees — pick one as the primary model, the rest are
alternates/comparisons.

| Source | Coverage | What it gives us | Cadence | Auth | Adapter |
|---|---|---|---|---|---|
| **NOAA/NCEP GFS** 0.25° | Global | wind, temp, humidity, rain, storm/CAPE, gust, pressure, SST fallback, cloud, snow | model runs every 6h; worker checks per `RUN_CHECK_CRON` | — | `worker/src/sources/gfs.ts` |
| **ECMWF IFS** 0.25° | Global | wind, temp, pressure (alt. base, off by default) | model runs every 6h; worker polls every 60min | — | `worker/src/sources/ifs.ts` |
| **DWD ICON global** 13km | Global | wind, temp, humidity, gust | model runs every 6h; worker polls every 60min | — | `worker/src/sources/iconGlobal.ts` |
| **NOAA GFS-Wave** 0.25°/0.16° | Global oceans | wave height/period/direction, basin nests | model runs every 6h; worker polls every 60min | — | `worker/src/sources/gfswave.ts`, `waveNests.ts` |
| **NOAA Global RTOFS** 1/12° | Global oceans | SST, currents, salinity | daily (00Z) model run; worker polls every 180min | — | `worker/src/sources/rtofs.ts`, regional windows in `rtofsRegional.ts` |
| **NOAA RTOFS temperature-at-depth** | Global oceans | temp at 100/500/2000/5000m | same daily run; worker polls every 180min | — | `worker/src/sources/rtofsDepth.ts` |

## 🗺️ Regional high-res nests

Zoom-gated overlays that kick in over their home region.

Cadence below is the worker's poll interval (`worker/src/weather/sourceSchedule.ts`),
not the upstream model's own run frequency — a nest polls far more often than its
model actually publishes a new run, since the poll is cheap (a no-op until a new
run appears).

| Source | Region | Resolution | Worker poll | Adapter |
|---|---|---|---|---|
| **DWD ICON-D2** | Germany/Europe | 2.2km | every 30min | `worker/src/sources/iconD2.ts` |
| **DWD ICON-EU** | Europe | 6.5km | every 30min | `worker/src/sources/iconEu.ts` |
| **NOAA HRRR** | CONUS | 3km | every 30min | `worker/src/sources/hrrr.ts` |
| **NOAA MRMS** | CONUS | radar mosaic | every 2min | `worker/src/sources/mrms.ts` |
| **ECCC HRDPS** | Canada | 2.5km | every 30min | `worker/src/sources/hrdps.ts` |
| **UK Met Office UKV** | UK | 2km (temp/humidity only) | every 30min | `worker/src/sources/ukv.ts` |
| **NOAA GFS-Wave regional/RTOFS regional nests** | N. Atlantic, US West Coast, Bering, Arctic, Hawaii, Guam, Samoa, etc. | basin-dependent | every 60–180min | `worker/src/sources/waveNests.ts`, `rtofsRegional.ts` |
| **JMA MSM** (via Open-Meteo) | Japan | 5km | every 30min | `worker/src/sources/openMeteo.ts` |
| **Météo-France AROME HD** (via Open-Meteo) | France | 1km | every 30min | same |
| **MeteoSwiss ICON-CH2** (via Open-Meteo) | Alps | 2km | every 30min | same |
| **KNMI HARMONIE** (via Open-Meteo) | Netherlands | 2km | every 30min | same |
| **DMI HARMONIE-AROME** (via Open-Meteo) | Nordics/Baltic | 2km | every 30min | same |
| **GeoSphere AROME** (via Open-Meteo) | Austria | 2km | every 30min | same |
| **ItaliaMeteo ICON-2I** (via Open-Meteo) | Italy | 2km | every 30min | same |
| **MET Norway Nordic-PP** (via Open-Meteo) | Scandinavia | 1km | every 30min | same |

The Open-Meteo family rides one shared adapter (`worker/src/sources/openMeteo.ts`)
that reads `.om` files off `s3://openmeteo` — all CC BY 4.0. `ukmo-uk` (a second
UK route through Open-Meteo) is wired but disabled — projected-grid alignment
wasn't validated.

## ⛈️ Alerts & disaster events

Four independent feeds, deliberately overlapping in places (US covered by both
NWS and WMO, Europe by both WMO and MeteoAlarm) so nothing gets missed.

| Source | Coverage | Adapter | Cadence |
|---|---|---|---|
| **WMO SWIC** | Global CAP aggregator | `worker/src/alerts/wmo.ts` | every 10min |
| **MeteoAlarm** (EUMETNET) | ~36 European countries | `worker/src/alerts/meteoalarm.ts` | every 5min |
| **GDACS** | Cyclones, floods, drought, wildfire, volcanic (quakes excluded — USGS owns those) | `worker/src/alerts/gdacs.ts` | every 15min |
| **NWS** (api.weather.gov) | US-specific, richer detail | `worker/src/alerts/nws.ts` | every 60s (off by default) |

## 🌋 Hazards & geophysics

| Source | What it gives us | Adapter | Cadence |
|---|---|---|---|
| **USGS earthquake feed** | Live quake events (GeoJSON) | `shared/src/tracks/usgs.ts` | every 5min |
| **EarthScope FDSN / IRIS SeedLink** | Global Seismographic Network station catalog + live waveform streaming | `shared/src/seismo/fdsn.ts`, `worker/src/seismo/seedlink-client.ts` | stations daily; waveforms streamed live |
| **Smithsonian/USGS Weekly Volcanic Activity Report** | Active volcano status bulletin | `shared/src/volcanoes/gvp.ts` | every 30min |
| **NASA FIRMS** (VIIRS/MODIS) | Active fire hotspots | `shared/src/fires/firms.ts` | every 30min (needs `FIRMS_MAP_KEY`) |
| **IOC Sea Level Monitoring Facility** | ~900 global tide-gauge stations | `shared/src/tides/ioc.ts` | stations daily, readings every 10min |
| **Bird (2003) PB2002** plate boundaries | Tectonic fault lines | `shared/src/faults/bird.ts` | monthly |
| **TeleGeography Submarine Cable Map** | Fiber-optic cable routes + landing points | `shared/src/cables/telegeography.ts` | weekly |

## 🌌 Space weather & imagery

| Source | What it gives us | Adapter | Cadence |
|---|---|---|---|
| **NOAA SWPC OVATION Prime** | Aurora probability oval | `shared/src/aurora/ovation.ts` | every 5min |
| **NOAA SWPC planetary Kp** | Geomagnetic activity index | `shared/src/aurora/kp.ts` | every 5min |
| **IGRF-14** (IAGA) | Geomagnetic field coefficients | `shared/src/geomag/igrf.ts` | weekly |
| **NASA GIBS WMS** | Global true-colour + GOES/Himawari geostationary looks | `worker/src/satimg/gibs.ts` (GIBS base URL) | every 30min |
| **EUMETSAT EUMETView WMS** | Meteosat MTG (0°) + MSG (0°/IODC) geostationary looks — geocolor, IR, water vapour, airmass, dust, fire temp, lightning imager | `worker/src/satimg/gibs.ts` (`EUMETVIEW_WMS`) | every 30min |

## ✈️🚢🛰️ Live tracks

| Source | What it tracks | Adapter | Cadence |
|---|---|---|---|
| **CelesTrak** | Satellite TLEs + SATCAT metadata | `shared/src/tracks/celestrak.ts` | every 12h |
| **OpenSky Network** | Global aircraft state vectors | `shared/src/tracks/opensky.ts` | ~every 60–144s (rate-budgeted) |
| **adsb.lol / adsb.fi** | Regional aircraft positions (keyless fallback) | `shared/src/tracks/adsb.ts` | — |
| **hexdb.io** | Aircraft registration/type lookup | `shared/src/tracks/hexdb.ts` | every 60s |
| **planespotters.net** | Aircraft photo + photographer credit | `shared/src/tracks/planespotters.ts` | on enrichment |
| **aisstream.io** | Live ship AIS positions (websocket) | `shared/src/tracks/aisstream.ts` | every 6min (needs `AISSTREAM_API_KEY`) |

## 📷 Webcams

| Source | Coverage | Adapter | Cadence |
|---|---|---|---|
| **Windy Webcams API v3** | ~70k global webcams | `worker/src/cams/windy.ts` | daily (needs `WINDY_WEBCAMS_API_KEY`) |
| **TfL JamCams** | London traffic CCTV | `worker/src/cams/tfl.ts` | every 10min |
| **National Highways CCTV** | UK motorway cameras | `worker/src/cams/nationalHighways.ts` | every 15min (currently gated off) |

## 🏙️ Places, history & narration

| Source | What it gives us | Adapter | Cadence |
|---|---|---|---|
| **GeoNames** | World city gazetteer (4 population tiers) | `shared/src/cities/geonames.ts` | manual seed |
| **Wikipedia REST Summary API** | Photo + blurb enrichment for cities/volcanoes/notable tracks | `shared/src/utill/wikipedia.ts` | volcanoes every 6h; notable tracks hourly; cities are admin-button only (`/admin/jobs` → `enrichWikiAll`), no automatic schedule |
| **Open-Meteo Archive API** (ERA5) | Historical daily climate, worker-cached per focus point (on-air camera + recent M5.5+ quakes) for the history/climate panel | `shared/src/climate/openmeteo.ts`, `worker/src/jobs/climate.ts` | every 10min |
| **Nominatim** (OpenStreetMap) | Operator place-name search → coordinates | `public/src/app/api/geocode/route.ts` | on demand |
| **NOAA NCEI ETOPO 2022** | Static global elevation/bathymetry DEM | `worker/src/weather/elevation.ts` | one-shot bake |
| **OpenRouter** | LLM-generated narrative for scheduled event round-ups | `worker/src/summaries/openrouter.ts` | hourly/12h/daily |

## 🧭 Basemaps & tiles (fetched by the browser, not the worker)

| Provider | Style |
|---|---|
| **CARTO** | Dark Matter (the default night-broadcast look) |
| **Esri** | World Imagery (satellite) |
| **OpenTopoMap** | Terrain/topo |
| **NASA GIBS** | VIIRS Black Marble night-lights |

---

## Everything in one place

- Weather-model registry (cadence, priority, attribution strings):
  [`shared/src/sources.ts`](shared/src/sources.ts) + `shared/src/sources.*.ts`
- Alert source registry: [`worker/src/alerts/registry.ts`](worker/src/alerts/registry.ts)
- Camera source registry: [`worker/src/cams/registry.ts`](worker/src/cams/registry.ts)
- All BullMQ repeatable jobs (the real "who's scheduled" truth):
  [`worker/src/index.ts`](worker/src/index.ts)
- All manual `refresh:*` / `seed:*` / `enrich:*` / `ingest:*` scripts:
  `worker/package.json`
- Env var names per source, licensing detail, monitoring cadences, open P0/P1
  attribution gaps: [`docs/external-sources-register.md`](docs/external-sources-register.md)
