# External data, API, media, and attribution register

| Audit field | Value |
| --- | --- |
| Last audited | **2026-07-07** |
| Scope | Repository source code, scripts, sample configuration, and current provider guidance |
| Owner | Assign a named maintainer before production use |

## Count summary

**54 external-source entries** are documented:

- **43** APIs, feeds, buckets, or live-data integrations
- **6** browser-fetched map/media services
- **5** build-time or seed-time downloads

Some entries group multiple upstream models—for example DWD ICON and the
Open-Meteo national-model family—so the number of individual datasets/models is
higher than 50.

This is the project's answer to **what comes from whom, where it enters the system,
what it powers, what needs credit, and what can break**. It intentionally does not
record API keys, passwords, tokens, or values from local `.env` files.

> This is an engineering and attribution checklist, not legal advice. Provider
> terms change. Re-check the linked terms before public, commercial, or high-volume
> use and record the review date in this file.

## Status legend

| Status | Meaning |
| --- | --- |
| **Default** | Scheduled or used by the code unless explicitly disabled. |
| **Conditional** | Used only when a key or feature flag is configured. |
| **Disabled** | Adapter exists but is excluded by the current code default. |
| **Manual** | Used only by an operator job/script or an end-user action. |
| **Build/seed** | Downloaded while preparing assets or seeding the database, not on each page view. |
| **Dynamic** | The hostname comes from provider/admin data and cannot be fully enumerated in source. |

“Default” is the **code default**, not proof that a particular deployment has the
job running. Check the worker repeatable-job list and the latest Mongo timestamps.

## Attention needed before calling attribution “done”

| Priority | Finding | Why it matters | Suggested action |
| --- | --- | --- | --- |
| P0 | Weather `SourceDescriptor.attribution` values do not reach `WeatherManifest` or the on-air UI. `WatchSurface` shows an uppercase source ID, not the legal credit. | DWD, ECMWF, Open-Meteo and several national models require attribution. | Add attribution fields to the manifest and render active base + nest credits in both clean and broadcast-chrome layouts. |
| P0 | Deck.gl globe basemaps use the tile templates directly, with no visible attribution control. The strings in `shared/src/basemaps.ts` only help MapLibre-style consumers. | OSM/CARTO, Esri, OpenTopoMap and NASA imagery credits can disappear on the actual broadcast globe. | Render a persistent basemap credit overlay from the selected basemap registry entry. |
| P0 | TeleGeography's public Submarine Cable Map endpoint is fetched as if its data were freely reusable. TeleGeography currently advertises the underlying JSON/GeoJSON data as an annually licensed product. | A public endpoint is not itself a reuse licence. | Confirm written permission/licence for this use, or replace the dataset. Do not rely only on `“Submarine cables © TeleGeography”`. |
| P0 | Windy V3 image URLs are persisted and the catalogue defaults to a daily refresh. Windy says free-tier image tokens expire in about 10–15 minutes and professional tokens in 24 hours. | Cached still URLs can become 401s long before the next ingest. | Fetch per view or refresh within token life; confirm the plan's listing limit. Keep the required link and courtesy beside every image. |
| P1 | Overlay credit constants for FIRMS, OVATION, IGRF, cables and plate boundaries are not consumed by the public UI. | The source is invisible when the overlay is on. | Add them to the same active-credit overlay/credits drawer. |
| P1 | PlaneSpotters photographer text is drawn on broadcast photos, but the broadcast card does not link to the photo page. | PlaneSpotters requires sufficient author attribution; the integration itself says linkback is required. | Make the photo/credit a link to `photoLink` wherever the photo is shown. |
| P1 | Wikipedia extracts and thumbnails appear in some broadcast panels without an article link or image-specific licence metadata. | Wikipedia text is CC BY-SA; Commons images can have different licences/credits. | Link the article for text and store/render Commons `extmetadata` for images, or omit remote thumbnails from broadcast. |
| P1 | Nominatim results and Open-Meteo climate charts have no obvious on-screen credit. | Both services require attribution; public Nominatim also has strict usage limits. | Add OSM/Open-Meteo credits and cache/throttle geocoding to at most 1 request/second. |
| P1 | IOC tide code uses an HTTP-only, keyless endpoint, while the current IOC help page asks API users to register. | Cleartext transport and access-policy drift are operational risks. | Ask IOC/VLIZ for the supported HTTPS/authenticated endpoint and migrate. |
| P1 | Windy, TfL and National Highways attribution is rendered in `CamViewer`, but any other camera presentation must independently use that component or render `cam.attribution`. | Credits can vanish in alternate cards/broadcast compositions. | Centralise camera media + attribution rendering and test every display path. |
| P2 | Most service-specific environment variables are absent from `.env.sample` and the README. | Operators cannot easily tell what is active, keyed, or intentionally disabled. | Add a commented “external services” section generated from this register. |

## Weather and ocean model inputs

The worker downloads these sources, bakes local PNG textures, and stores them in
Mongo. Browsers normally read the project's own API, not these upstreams.

| Status | Source / owner | What it supplies | Endpoint and auth | Code locations | Credit / terms | What to watch |
| --- | --- | --- | --- | --- | --- | --- |
| **Default** | NOAA/NCEP **GFS** | Global wind, temperature, humidity, rain, CAPE/storm, gust, pressure, SST fallback, cloud and snow | `nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl`; keyless | `worker/src/sources/gfs.ts`, `worker/src/weather/ingest.ts`, `worker/src/weather/check.ts` | `NOAA/NCEP GFS`; NOAA material is generally public information, but acknowledge NOAA and do not imply endorsement. [NOAA data/citation guidance](https://www.noaa.gov/information-technology/open-data-dissemination) | Latest complete cycle, HTTP errors, field count, generated texture ranges; check every 30 min, but judge freshness against 6-hour model cycles and publication lag. |
| **Default** | NOAA/NCEP **GFS-Wave** | Global wave base, regional mosaic and basin nests | GRIB filter plus `nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod`; keyless | `worker/src/sources/gfs.ts`, `gfswave.ts`, `waveNests.ts`; `worker/src/weather/multiSource.ts`, `waveNests.ts` | `NOAA/NCEP GFS-Wave` | All expected tiles, mosaic coverage/seams, forecast-hour availability; poll hourly. |
| **Default** | NOAA/NCEP **Global RTOFS** | Sea-surface temperature, currents and salinity; global netCDF plus regional GRIB windows and a separate temperature-at-depth (100/500/2000/5000 m) cube | `nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod`; keyless | `worker/src/sources/rtofs.ts`, `rtofsRegional.ts`, `rtofsDepth.ts`; `worker/src/weather/multiSource.ts`, `rtofsRegional.ts` | `NOAA/NCEP Global RTOFS` | Daily 00Z run, netCDF variables/grid, regrid success and regional window geometry; poll every 3 h, alert after roughly 36 h without a new run. |
| **Default** | NOAA/NCEP **HRRR** | High-resolution CONUS temperature, wind and gust nest | `nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl`; keyless | `worker/src/sources/hrrr.ts`, `worker/src/weather/hrrr.ts` | `NOAA/NCEP HRRR` | Hourly model freshness and Lambert-to-lat/lon alignment; poll every 30 min. |
| **Default** | NOAA/NCEP **MRMS** | Live-ish CONUS radar reflectivity nest | `mrms.ncep.noaa.gov/data/2D`; keyless | `worker/src/sources/mrms.ts`, `worker/src/weather/mrms.ts` | `NOAA/NCEP MRMS` | Directory/file-name changes and observation age; poll every 2 min, alert if the cached frame is older than 10–15 min. |
| **Default** | Deutscher Wetterdienst (**DWD ICON global, ICON-EU, ICON-D2**) | Global 13 km and European high-resolution temperature/wind/gust/humidity nests | `opendata.dwd.de/weather/nwp/...`; keyless; global remap weights also come from DWD | `worker/src/sources/iconGlobal.ts`, `iconEu.ts`, `iconD2.ts`; matching files under `worker/src/weather/`; descriptors in `shared/src/sources*.ts` | `© Deutscher Wetterdienst (DWD)`. [DWD open-data terms](https://opendata.dwd.de/climate_environment/REA/Terms_of_use.pdf) | Run-directory/filename changes, `.bz2` integrity, missing f000 gust, weights archive and map alignment; D2/EU poll every 30 min, global hourly. |
| **Default** | Environment and Climate Change Canada (**ECCC HRDPS**) | Canada 2.5 km temperature/wind/gust/humidity nest | `dd.weather.gc.ca/.../model_hrdps/...`; keyless | `worker/src/sources/hrdps.ts`, `worker/src/weather/hrdps.ts`, `shared/src/sources.hrdps.ts` | `© Environment and Climate Change Canada`. [MSC Datamart documentation and change notices](https://eccc-msc.github.io/open-data/msc-datamart/readme_en/) | Dynamic date tree, short retention, filename/grid changes and new-run age; poll every 30 min. Subscribe to the Datamart announcement list. |
| **Default** | UK Met Office **UKV** public AWS mirror | UK 2 km temperature and humidity nest | `met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com`; keyless | `worker/src/sources/ukv.ts`, `worker/src/weather/ukv.ts`, `shared/src/sources.ukv.ts` | Code currently says `© Crown copyright Met Office`; confirm the precise AWS dataset terms and whether `Powered by Met Office data` is required. [Met Office DataHub licence FAQ](https://datahub.metoffice.gov.uk/support/faqs) | Bucket key/schema changes, latest run and cdo remap alignment; poll every 30 min. |
| **Disabled** | ECMWF **IFS** | Global wind, temperature and pressure alternative base | `data.ecmwf.int/forecasts`; keyless open-data subset | `worker/src/sources/ifs.ts`, `worker/src/weather/multiSource.ts`, `shared/src/sources.ts` | `© ECMWF`; include CC BY 4.0 link and say if modified. [Official ECMWF open-data attribution example](https://www.ecmwf.int/en/about/media-centre/news/2025/ecmwf-makes-its-entire-real-time-catalogue-open-all) | Currently `enabled: false`; validate CCSDS decoding, value ranges and map alignment before enabling. The `IFS_AS_DEFAULT_BASE` flag alone does not make the static descriptor enabled. |
| **Default** | **Open-Meteo** public spatial bucket, carrying JMA MSM, Météo-France AROME, MeteoSwiss ICON-CH2, KNMI HARMONIE, DMI HARMONIE, GeoSphere Austria AROME, ItaliaMeteo/ARPAE ICON-2I and MET Norway Nordic-PP | National high-resolution temperature/humidity/wind/gust nests in `.om` format | `openmeteo.s3.amazonaws.com/data_spatial/...`; keyless | `worker/src/sources/openMeteo.ts`, `worker/src/weather/openMeteo.ts`, `shared/src/sources.openMeteo.ts` | Credit both the national model owner **and Open-Meteo**, link CC BY 4.0, and indicate the data were reprojected/processed. [Open-Meteo licence](https://open-meteo.com/en/license) | `latest.json` schema, `.om` variable presence, dimensions/projection, f0 availability and per-model failures; poll every 30 min. `ukmo-uk` is disabled because its reprojection is not validated. |
| **Manual / static** | NOAA/NCEI **ETOPO 2022** | Global land elevation and ocean-floor bathymetry | `www.ngdc.noaa.gov/.../ETOPO_2022_v1_60s...tif`; keyless, large download | `worker/src/weather/elevation.ts`, `worker/src/jobs/elevation.ts` | `Relief: NOAA NCEI ETOPO 2022` | Large download/cache integrity and source-version changes; re-run only intentionally. |

The source registry and its canonical weather credit strings live in
`shared/src/sources.ts` and `shared/src/sources.*.ts`. The scheduling truth is
`worker/src/weather/sourceSchedule.ts`; GFS's separate check cron is in
`worker/src/index.ts`.

## Satellite, hazards, geophysics, and environmental overlays

| Status | Source / owner | What it supplies | Endpoint and auth | Code locations | Credit / terms | What to watch |
| --- | --- | --- | --- | --- | --- | --- |
| **Default** | NASA EOSDIS **GIBS** | Daily global true colour, GOES-East/West GeoColor, Himawari clean IR; also Black Marble basemap imagery | `gibs.earthdata.nasa.gov` WMS/WMTS; keyless | `worker/src/satimg/gibs.ts`, `worker/src/jobs/satimg.ts`, `shared/src/satimg/types.ts`, `shared/src/basemaps.ts` | `Imagery © NASA EOSDIS GIBS` plus the named instrument/product where practical. [NASA Earthdata use and citation guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy) | WMS layer IDs, timestamp/blank images, regional feed age, output under Mongo's 16 MB limit; scheduled every 30 min. |
| **Default** | EUMETSAT **EUMETView** WMS (GeoServer) | Meteosat MTG (0°) and MSG (0°/IODC) geostationary looks: geocolor, IR, water vapour, airmass, dust, fire temp, lightning imager | `view.eumetsat.int/geoserver/wms`; keyless | `worker/src/satimg/gibs.ts` (`EUMETVIEW_WMS`), `worker/src/jobs/satimg.ts` | `Imagery © EUMETSAT`; name the instrument/product (MTG/MSG) where practical. Confirm current EUMETSAT open-data re-use terms. | Same `satimg` job as GIBS; layer name changes, blank/stale discs; scheduled every 30 min. |
| **Conditional** | NOAA/AWS **Himawari-9 Open Data** | Raw full-disk HSD segments, reprojected by Satpy | Anonymous S3 bucket `noaa-himawari9`, prefix `AHI-L1b-FLDK` | `worker/src/satimg/himawari.py`, `worker/src/satimg/bake.ts` | `Himawari-9 imagery via NOAA Open Data on AWS`; also credit JMA as instrument/operator where required | Enabled by `SATIMG_SOURCE=satpy`; Python environment, all ten scan segments, S3 object lag and job timeout. |
| **Default** | NOAA Space Weather Prediction Center (**SWPC**) | OVATION Prime aurora probability grid and planetary Kp | `services.swpc.noaa.gov/json/ovation_aurora_latest.json` and `/products/noaa-planetary-k-index.json`; keyless | `shared/src/aurora/ovation.ts`, `shared/src/aurora/kp.ts`, `worker/src/jobs/aurora.ts` | `Aurora: NOAA SWPC OVATION Prime` and `Kp: NOAA SWPC` | Observation/forecast timestamps, grid dimensions and peak probability; refresh every 5 min. |
| **Default** | IAGA **IGRF-14**, hosted by NOAA/NCEI | Geomagnetic model coefficients | `www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt`; keyless | `shared/src/geomag/igrf.ts`, `worker/src/jobs/geomag.ts` | `Geomagnetic field: IGRF-14 (IAGA)` | URL/model-generation changes; fetch failure silently uses embedded 2025 dipole coefficients. Weekly rebake is sufficient. |
| **Conditional** | NASA **FIRMS** | VIIRS/MODIS near-real-time active-fire detections | `firms.modaps.eosdis.nasa.gov/api/area/csv`; `FIRMS_MAP_KEY` required | `shared/src/fires/firms.ts`, `worker/src/jobs/fires.ts` | `Active fires: NASA FIRMS (VIIRS/MODIS)` and cite the selected product. [NASA FIRMS reuse/citation answer](https://forum.earthdata.nasa.gov/viewtopic.php?t=5184) | Key/quota, CSV headers, selected `FIRMS_SOURCE`, latest acquisition time; scheduled every 30 min only when a key is present. |
| **Default** | U.S. Geological Survey (**USGS**) | Recent earthquake GeoJSON feed | `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}.geojson`; keyless | `shared/src/tracks/usgs.ts`, `worker/src/jobs/tracks.ts` | `Earthquakes: U.S. Geological Survey` with event link | Feed name, event count and latest event/update time; defaults to `2.5_day`, polled every 5 min. |
| **Default** | EarthScope **FDSN station service** (Global Seismographic Network — IU/II/IC) | Broadband seismograph station catalog (lat/lng/channel/sample rate) | `service.earthscope.org/fdsnws/station/1/query`; keyless, identifying User-Agent | `shared/src/seismo/fdsn.ts`, `worker/src/jobs/seismo.ts` | `Seismic stations: Global Seismographic Network (EarthScope/IRIS)` | Station catalog refreshed daily (`SEISMO_STATIONS_MS`); redirect/hostname drift (moved from `service.iris.edu`). |
| **Default** | IRIS **SeedLink** real-time waveform stream | Live miniSEED broadband seismograph waveform records | `rtserve.iris.washington.edu:18000` (persistent TCP, not polled); `SEEDLINK_HOST`/`SEEDLINK_PORT` | `worker/src/seismo/seedlink-client.ts`, `worker/src/seismo/miniseed.ts`, `worker/src/seismo/loop.ts` | `Live waveforms: IRIS SeedLink` | Connection persists at boot unless `SEISMO_ENABLED=false`; decoder is a hand-rolled STEIM2 implementation — watch for dropped/reconnecting streams. |
| **Default** | Smithsonian Institution / USGS **Weekly Volcanic Activity Report** (Global Volcanism Program) | Active-volcano status bulletin (dormant/unrest/erupting) with coordinates | `volcano.si.edu/news/WeeklyVolcanoRSS.xml`; keyless | `shared/src/volcanoes/gvp.ts`, `worker/src/jobs/volcanoes.ts` | `Volcano activity: Smithsonian/USGS Global Volcanism Program` with report link | Snapshot every 30 min (`VOLCANO_SNAPSHOT_MS`); Wikipedia photo/blurb enrichment every 6 h (`VOLCANO_ENRICH_MS`), same rights caveats as the Wikipedia row below. |
| **Default** | UNESCO-IOC / VLIZ **Sea Level Station Monitoring Facility** | Tide-gauge station catalogue and recent water-level series | `http://www.ioc-sealevelmonitoring.org/service.php`; code is keyless | `shared/src/tides/ioc.ts`, `worker/src/jobs/tides.ts` | `Sea level: IOC Sea Level Station Monitoring Facility / VLIZ`, and preserve the original station/provider identity. [Service/API help](https://www.ioc-sealevelmonitoring.org/service.php?query=help) | HTTP transport, registration requirement, station/sensor schema and limited QC. Stations daily; focused series every 10 min. Do not poll a station more than once/minute. |
| **Default** | Peter Bird **PB2002** via `fraxen/tectonicplates` | Global plate-boundary GeoJSON | `raw.githubusercontent.com/fraxen/tectonicplates/.../PB2002_boundaries.json`; keyless | `shared/src/faults/bird.ts`, `worker/src/jobs/faults.ts` | `Plate boundaries: Bird (2003) PB2002, via fraxen/tectonicplates (ODC-By)` | Repository/path/licence changes and non-empty geometry; refresh monthly. |
| **Default — licence review required** | **TeleGeography Submarine Cable Map** | Cable routes and landing points | `www.submarinecablemap.com/api/v3/...`; keyless in code | `shared/src/cables/telegeography.ts`, `worker/src/jobs/cables.ts` | Code says `Submarine cables © TeleGeography`, but [TeleGeography's current data-licensing page](https://www2.telegeography.com/license-geocoded-map-data) describes the JSON/GeoJSON API as an annual-licence product. Confirm permission. | Authorization/legal approval, endpoint/schema and row-count shifts; weekly refresh. |

## Public warnings and disaster events

Warnings are cached in Mongo by the worker. Always retain the issuing authority,
original warning link, issue/expiry times, and “not a substitute for official
instructions” wording.

| Status | Source / owner | Coverage | Endpoint / cadence | Code locations | Credit / terms | What to watch |
| --- | --- | --- | --- | --- | --- | --- |
| **Default** | WMO **Severe Weather Information Centre (SWIC)**, warnings issued by national meteorological and hydrological services | Global CAP warning aggregation | `severeweather.wmo.int/g/ows/`; 10 min | `worker/src/alerts/wmo.ts`, `registry.ts` | Credit the **issuing NMHS** and say `via WMO SWIC`; WMO says re-users should identify the respective issuing service. [WMO notes to users](https://severeweather.wmo.int/note.html) | Feature cap, `capurl`/WFS schema, country coverage, issue/expiry age and missing geometry. |
| **Default** | **MeteoAlarm / EUMETNET members** | Pan-European warnings, one country feed per request | `feeds.meteoalarm.org/api/v1/warnings/feeds-{country}`; 5 min | `worker/src/alerts/meteoalarm.ts`, `registry.ts` | `Warnings: MeteoAlarm / EUMETNET member services`, CC BY 4.0. [Current MeteoAlarm API portal and status link](https://api.meteoalarm.org/) | Country-by-country failures, feed migration (the current portal promotes OGC EDR/MeteoGate), country list and duplicate WMO coverage. |
| **Default** | **GDACS** (UN/European Commission cooperation) | Cyclones, floods, volcanoes, drought and wildfire events; earthquakes deliberately excluded in code | `www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP`; 15 min | `worker/src/alerts/gdacs.ts`, `registry.ts` | `Source: GDACS`; preserve report links and automatic-estimate disclaimer. [GDACS terms and disclaimer](https://gdacs.org/About/termofuse.aspx) | Schema/event-code changes, report URLs and latest event age. Do not present modelled GDACS notifications as official evacuation advice. |
| **Conditional** | NOAA/NWS **api.weather.gov** | Richer US active alerts | `api.weather.gov/alerts/active`; 60 sec; identifying User-Agent required | `worker/src/alerts/nws.ts`, `registry.ts` | `Source: U.S. National Weather Service`; retain issuing office and original alert URL | Included only with `ALERTS_NWS_ENABLED=true`; rate errors, User-Agent, geometry and expiry. Exclude US from WMO to avoid duplicates. |

Current default configuration enables both WMO and MeteoAlarm while
`WMO_EXCLUDE_CC` defaults empty, so European warnings can overlap. Treat source
deduplication as an operations check, not an assumed property.

## Live vehicles, satellites, cameras, and enrichment

| Status | Source / owner | What it supplies | Endpoint and auth | Code locations | Credit / terms | What to watch |
| --- | --- | --- | --- | --- | --- | --- |
| **Default** | **adsb.lol**; optional **adsb.fi** | Regional point/radius aircraft positions | `api.adsb.lol/v2` or `opendata.adsb.fi/api/v2`; keyless | `shared/src/tracks/adsb.ts`, `worker/src/jobs/tracks.ts` | Show the selected community feed as the track source; review its current reuse terms before redistribution | Provider availability, coverage gaps, 250 nm radius cap, 429s and frame age. Default regions: UK/Ireland, NW Europe, US Northeast; snapshot every 60 sec. |
| **Conditional** | **OpenSky Network** | Global aircraft state vectors | OAuth at `auth.opensky-network.org`; data at `opensky-network.org/api/states/all`; client ID/secret recommended | `shared/src/tracks/opensky.ts`, `worker/src/jobs/tracks.ts` | `Aircraft data: The OpenSky Network`; follow [OpenSky API/rate-limit guidance](https://opensky-network.org/about/faq) | OAuth changes/expiry, credits/rate limit, 401/429; the worker falls back to regional adsb.lol on failure. |
| **Conditional** | **AISStream.io** | Live ship AIS position reports | `wss://stream.aisstream.io/v0/stream`; `AISSTREAM_API_KEY` required | `shared/src/tracks/aisstream.ts`, `worker/src/jobs/tracks.ts` | `Ship positions: AISStream.io`; verify downstream redistribution terms | Service is beta with no SLA, schema is marked unstable, API key must stay server-side, coverage and collection-window age. Default job every 6 min with a 5 min collection. [AISStream docs](https://aisstream.io/documentation.html) |
| **Default** | **CelesTrak** | GP/TLE groups and SATCAT metadata | `celestrak.org/NORAD/elements/gp.php` and `/satcat/records.php`; keyless | `shared/src/tracks/celestrak.ts`, `worker/src/jobs/tracks.ts` | `Orbital elements and catalog data: CelesTrak`; follow [CelesTrak usage policy](https://www.celestrak.org/usage-policy.php) | Group names, new 6-digit catalog-number implications, response size and freshness; refresh every 12 h. Avoid polling huge groups unnecessarily. |
| **Default** | **hexdb.io** | Aircraft registration/type/operator metadata | `hexdb.io/api/v1/aircraft/{icao24}`; keyless | `shared/src/tracks/hexdb.ts`, `worker/src/jobs/tracks.ts` | Credit `hexdb.io` if this metadata is surfaced; verify current terms | Capped/paced enrichment, cached misses and schema; default 150 lookups/run with 120 ms spacing. |
| **Default for notable aircraft enrichment** | **Planespotters.net public photo API** | Aircraft thumbnails, photographer and photo-page link | `api.planespotters.net/pub/photos/hex/{icao24}`; keyless | `shared/src/tracks/planespotters.ts`, `worker/src/jobs/notable.ts` | Render `© {photographer}` and link the image/credit to its PlaneSpotters page. [PlaneSpotters terms](https://www.planespotters.net/legal/termsofuse?desktop=true) | Cache and rate-limit; broken/changed thumbnail URLs; never drop `photoCredit` or `photoLink`. |
| **Default** | **Transport for London Unified API — JamCams** | London traffic-camera stills and MP4 clips | `api.tfl.gov.uk/Place/Type/JamCam`; keyless, optional `TFL_APP_KEY`; 10 min | `worker/src/cams/tfl.ts`, `registry.ts` | `Powered by TfL Open Data`. [TfL open-data guidance](https://tfl.gov.uk/info-for/open-data-users/our-open-data?intcmp=3671) | Feed/AdditionalProperties schema, media age, broken URLs and app-key quota. Current code persists and renders attribution in `CamViewer`. |
| **Conditional** | **Windy Webcams API V3** | Global webcam catalogue, stills and embed players | `api.windy.com/webcams/api/v3/webcams`; `WINDY_WEBCAMS_API_KEY` required | `worker/src/cams/windy.ts`, `registry.ts` | Link every image to the Windy webcam/player and show Windy's prescribed courtesy, including the “add a webcam” link where required. [Windy Webcam terms](https://api.windy.com/webcams/terms) | Short-lived image URLs, free-tier offset cap, plan limits, 401s and attribution on every rendering path. Current daily poll is not compatible with free-tier image token life. |
| **Conditional / gated** | **National Highways CCTV** | England strategic-road camera catalogue/images | `api.data.nationalhighways.co.uk/cctv/v1/cameras`; subscription key plus `CAMS_NH_ENABLED=true` | `worker/src/cams/nationalHighways.ts`, `registry.ts` | `Contains National Highways data © Crown copyright and database right`; confirm the portal licence and CCTV privacy obligations | Adapter expects JSON even though comments say the canonical DATEX II feed is XML; validate before enabling. Poll every 15 min. |
| **Manual / Dynamic** | YouTube and arbitrary admin camera providers | YouTube embeds, HLS, MP4, iframe, still and timelapse URLs | Hostnames supplied by admins; YouTube embeds use `youtube.com/embed/{id}` | `public/src/components/cams/AddCamForm.tsx`, `CamViewer.tsx`; `shared/src/cams/*` | Store provider, exact required text and link for every manual camera. YouTube and each stream owner have separate embed/content rights. | URL allow-list/SSRF policy, iframe sandbox/CSP, mixed content, expiry, rights and takedowns. |

## Place, climate, editorial, and AI services

| Status | Source / owner | What it supplies | Endpoint and auth | Code locations | Credit / terms | What to watch |
| --- | --- | --- | --- | --- | --- | --- |
| **Manual / request-driven** | OpenStreetMap Foundation **Nominatim** | Forward geocoding for operator searches | `nominatim.openstreetmap.org/search`; keyless | `public/src/app/api/geocode/route.ts` | `© OpenStreetMap contributors`, link ODbL. Public Nominatim requires a valid identifying User-Agent, visible attribution, caching and an absolute maximum of 1 request/sec. [Usage policy](https://operations.osmfoundation.org/policies/nominatim/) | Add cache + rate limiter; no autocomplete/bulk use; 403/429 and provider-switch readiness via `GEOCODER_URL`. |
| **Default** | **Open-Meteo Archive API** / ERA5-family archive | Past-year daily temperature, humidity, rain and wind charts, worker-cached per focus point (current on-air camera + recent M5.5+ quakes), one Mongo doc per 0.1° key | `archive-api.open-meteo.com/v1/archive`; keyless | `shared/src/climate/openmeteo.ts` (`fetchClimateYear`), `worker/src/jobs/climate.ts` (`snapshotClimate`) | `Weather data by Open-Meteo.com`, CC BY 4.0, with underlying dataset attribution as required. [Licence](https://open-meteo.com/en/license) | Worker-scheduled every 10 min (`CLIMATE_SNAPSHOT_MS`), capped at `CLIMATE_MAX_FETCHES` (default 4) per tick to stay polite; re-fetches a cached point after `CLIMATE_MAX_AGE_MS` (default 24 h); disable with `CLIMATE_ENABLED=false`. The public `/climate` route reads Mongo only, never Open-Meteo directly; configurable upstream with `OPENMETEO_ARCHIVE_URL`. |
| **Manual / seed** | **GeoNames** | City/town gazetteer and country names | `download.geonames.org/export/dump`; keyless ZIP/TSV | `worker/src/jobs/cities.ts`, `shared/src/cities/geonames.ts` | `City data © GeoNames, CC BY 4.0`. [GeoNames](https://www.geonames.org/) | Tier size, ZIP member/schema and database replacement; reseeding drops cached Wikipedia enrichment. |
| **Manual enrichment** | English **Wikipedia / Wikimedia** | City/notable extract and thumbnail | `en.wikipedia.org/api/rest_v1/page/summary/{title}`; keyless, identifying User-Agent | `shared/src/utill/wikipedia.ts`, `worker/src/jobs/cities.ts`, `notable.ts` | Link the article for CC BY-SA text attribution. Images require their own Commons/source-page licence and author metadata. [Wikimedia Terms of Use](https://foundation.wikimedia.org/wiki/Terms_of_Use/en) | REST endpoint retirement, User-Agent/contact, disambiguation, 429s and image rights. City cache stales after 30 days. |
| **Conditional** | **OpenRouter** and the selected downstream model provider | Broadcast-style narrative generated from cached event facts | `openrouter.ai/api/v1/chat/completions`; bearer `OPENROUTER_API_KEY` | `worker/src/summaries/openrouter.ts` | No data credit substitute: the generated prose must retain/carry the underlying alert/event sources. Record selected model/provider according to OpenRouter terms. | Spend/token usage, latency, model retirement, content errors and accidental sensitive prompt data; degrades to no prose without a key. |

## Browser-fetched basemaps, fonts, images, and media

Unlike worker-cached feeds, these requests can leave each viewer's browser and
expose the viewer IP/referrer to the provider.

| Status | Provider / asset | Runtime host | Code location | Credit / licence note | What to watch |
| --- | --- | --- | --- | --- | --- |
| **Default when selected** | CARTO Dark Matter tiles based on OpenStreetMap | `a/b/c.basemaps.cartocdn.com` | `shared/src/basemaps.ts`, `public/src/components/layers/basemap.ts` | `© OpenStreetMap contributors © CARTO`. CARTO says commercial basemap use needs an Enterprise licence; confirm this deployment is eligible. [CARTO basemap FAQ](https://docs.carto.com/faqs/carto-basemaps) | Visible credit, licence/account status, tile 403/429s and browser privacy. |
| **When selected** | Esri World Imagery, including imagery partners | `server.arcgisonline.com` | Same | Preserve `Imagery © Esri, Maxar, Earthstar Geographics` and any dynamic service credits; confirm Esri basemap terms for direct tile use. | Attribution, direct-tile permission, tile errors and provider-credit changes. |
| **When selected** | OpenTopoMap tiles, based on OSM and SRTM | `a/b/c.tile.opentopomap.org` | Same | `© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)`; review [OpenTopoMap usage/credits](https://opentopomap.org/about) | Fair-use capacity, visible credit and tile failures. |
| **When selected** | NASA GIBS VIIRS Black Marble | `gibs.earthdata.nasa.gov` | Same | `Imagery © NASA EOSDIS GIBS (VIIRS Black Marble)` | WMTS max zoom 8, visible credit, tile/layer changes. |
| **Potential MapLibre style request** | MapLibre demo glyphs | `demotiles.maplibre.org/font/...` | `shared/src/basemaps.ts` | Demo infrastructure is not a production SLA. Self-host glyphs if labels begin using them. | Availability and unexpected production traffic. |
| **Dynamic** | Provider/admin camera media, PlaneSpotters/Wikipedia images and sponsor click URLs | Returned/stored hostnames | Camera, vehicle and ad components under `public/src/components` | Credits/rights travel with each record; sponsor click URLs are references, while uploaded ad media is served locally. | CSP, mixed content, malicious URLs, expiry, takedowns and client privacy. |

## Build-time and seed-time downloads

| Status | Asset / owner | Downloaded from | Code location | Credit / licence note |
| --- | --- | --- | --- | --- |
| **Build/seed** | Solar System Scope 8k Earth day texture | `www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg` | `fetch-assets.sh` → local `/data/satellite.jpg` | Credit `Solar System Scope`; the texture library is commonly published as CC BY 4.0, but preserve a copy of the exact terms/version used. |
| **Build/seed** | NASA GSFC Blue Marble/topography/bathymetry image | `eoimages.gsfc.nasa.gov/.../world.topo.bathy...jpg` | `fetch-assets.sh` → `/data/terrain.jpg` | Credit NASA/GSFC and identify the Blue Marble/topography product. |
| **Build/seed** | NASA GIBS VIIRS Black Marble JPEG | GIBS WMS | `fetch-assets.sh` → `/data/night.jpg` | Credit NASA EOSDIS GIBS / VIIRS Black Marble. |
| **Build/seed** | Natural Earth 50m land/countries and 110m populated places | `d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/...` | `fetch-assets.sh`, `worker/src/scripts/seedCapitals.ts` | Natural Earth is public domain; optional credit `Made with Natural Earth`. [Terms](https://www.naturalearthdata.com/about/terms-of-use/) |
| **Image build dependency** | NOAA/NCEP `wgrib2` source | `www.ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/wgrib2.tgz` | `buildWgrib.sh`, `worker/Dockerfile` | Tool/source dependency rather than broadcast data. Pin/checksum the archive for reproducible and safer builds. |

Generated country bounds in `shared/src/countries.generated.ts` ultimately come
from the local Natural Earth `countries.geojson` asset.

## External-service configuration index

These are names only. Never put their values in this register or in tickets/logs.

| Area | Environment variables |
| --- | --- |
| Geocoding / climate | `GEOCODER_URL`, `OPENMETEO_ARCHIVE_URL` |
| Aircraft | `AIRCRAFT_PROVIDER`, `ADSB_API_BASE`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, legacy `OPENSKY_USERNAME`, `OPENSKY_PASSWORD`, `SNAPSHOT_REGIONS`, `AIRCRAFT_SNAPSHOT_MS`, `AIRCRAFT_ENRICH_*` |
| Ships / satellites / earthquakes | `AISSTREAM_API_KEY`, `SHIP_BBOXES`, `SHIP_COLLECT_MS`, `SHIP_SNAPSHOT_MS`, `SATELLITE_GROUPS`, `TLE_INGEST_MS`, `USGS_FEED`, `SEISMIC_SNAPSHOT_MS` |
| Seismograph stations / volcanoes | `SEISMO_ENABLED`, `SEISMO_STATIONS_MS`, `SEEDLINK_HOST`, `SEEDLINK_PORT`, `VOLCANO_SNAPSHOT_ENABLED`, `VOLCANO_SNAPSHOT_MS`, `VOLCANO_ENRICH_MS` |
| Climate / history archive | `CLIMATE_ENABLED`, `CLIMATE_SNAPSHOT_MS`, `CLIMATE_MAX_AGE_MS`, `CLIMATE_MAX_FETCHES`, `CLIMATE_FOCUS_MIN_MAG` |
| Alerts | `ALERTS_WMO_ENABLED`, `WMO_*`, `ALERTS_METEOALARM_ENABLED`, `METEOALARM_*`, `ALERTS_GDACS_ENABLED`, `GDACS_POLL_SEC`, `ALERTS_NWS_ENABLED`, `ALERTS_*_USER_AGENT` |
| Cameras | `CAMS_INGEST_ENABLED`, `CAMS_TFL_ENABLED`, `TFL_APP_KEY`, `TFL_JAMCAMS_URL`, `TFL_INGEST_SEC`, `CAMS_WINDY_ENABLED`, `WINDY_WEBCAMS_API_KEY`, `WINDY_WEBCAMS_URL`, `WINDY_INGEST_SEC`, `WINDY_MAX_WEBCAMS`, `CAMS_NH_ENABLED`, `NATIONAL_HIGHWAYS_API_KEY`, `NH_CCTV_URL`, `NH_INGEST_SEC` |
| Fires / aurora / geomag | `FIRMS_MAP_KEY`, `FIRMS_API_BASE`, `FIRMS_SOURCE`, `FIRMS_DAYS`, `FIRE_*`, `OVATION_AURORA_URL`, `KP_INDEX_URL`, `AURORA_*`, `IGRF_COEFFS_URL`, `GEOMAG_*` |
| Cables / faults / tides | `CABLE_API_BASE`, `CABLE_REFRESH_*`, `FAULT_GEO_URL`, `FAULT_REFRESH_*`, `TIDES_ENABLED`, `TIDE_*` |
| Weather sources | `RUN_CHECK_CRON`, `MULTISOURCE_INGEST_ENABLED`, `WEATHER_INGEST_ON_BOOT`, source-specific `*_INGEST_MS` and `*_FORECAST_HOURS`, `NOMADS_MIN_GAP_MS`, `IFS_AS_DEFAULT_BASE`, `ELEVATION_DEM_URL`, `ELEVATION_DEM_PATH` |
| Satellite imagery | `SATIMG_SOURCE`, `SATIMG_REFRESH_ENABLED`, `SATIMG_REFRESH_MS`, `SATIMG_*` bake settings |
| AI narrative | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `SUMMARIES_ENABLED`, `SUMMARY_*_CRON` |

## Suggested monitoring register

Use the worker's stored results and logs as the primary signal. Do not double the
load by running aggressive synthetic checks against free community services.

| Family | Code cadence | Suggested stale alert | Minimum checks |
| --- | --- | --- | --- |
| GFS / GFS-Wave / ICON global | 30–60 min polling; 6-hour runs | No usable active run for 10–12 h | Last published run/model/variable, expected forecast hours, non-flat texture min/max, job failure count |
| Regional forecast nests | 30 min polling | No new run for 6 h, adjusted for provider schedule | Latest run per source, variable presence, dimensions and coastline-alignment smoke image |
| RTOFS | 3-hour polling; daily run | No new run for 36 h | netCDF/GRIB presence, cdo/wgrib2 exit, grid geometry, current-vector sanity |
| MRMS | 2 min | Cached radar older than 10–15 min | Upstream observation timestamp, non-empty bytes, reflectivity range |
| Satellite imagery | 30 min | Live regional image older than 90 min; global mosaic older than 48 h | Per-feed success, observation time, dimensions, blank-image detection, BSON size |
| WMO / MeteoAlarm / GDACS / NWS | 1–15 min | Repeated job failure for 3 cycles; also alert on implausible zero counts during known activity | HTTP/schema, fetched-at, active/expired counts, duplicates by issuer+identifier |
| Aircraft | 60 sec | Latest frame older than 3 min | Provider used/fallback, track count by region, 401/429, zero-coordinate filtering |
| Ships | 6 min job / 5 min collection | Latest successful frame older than 15 min | WebSocket/auth errors, messages/sec, unique MMSIs, collection duration |
| TLEs | 12 h | Cache older than 36 h | Group-level failures, parsed count and epoch freshness |
| Cameras | TfL 10 min; NH 15 min; Windy daily in current code | Catalogue job misses 3 cycles; media probe failure rate | Row count delta, sample image/player HEAD/GET, attribution presence, token expiry |
| Aurora / Kp | 5 min | OVATION observation older than 30 min | Feed timestamps, grid shape, Kp parse and image bytes |
| FIRMS | 30 min when keyed | Job misses 3 cycles or all detection acquisition times exceed configured lookback | Key/quota, CSV schema, count by source/satellite, latest acquisition |
| USGS quakes | 5 min | Job misses 3 cycles | Feed update time, parsed count, max event age |
| Seismograph stations / waveforms | Stations daily; waveform stream persistent | Station catalog older than 48 h; SeedLink connection down/reconnect-looping | FDSN catalog freshness, SeedLink connect state, STEIM2 decode errors, per-station last-sample age |
| Volcanoes | Snapshot 30 min; enrichment 6 h | Snapshot job misses 3 cycles | RSS parse success, active-volcano count, Wikipedia enrichment failure rate |
| Tides | Stations daily; series 10 min | Station catalog older than 48 h or focused series older than 30 min | HTTP/auth policy, sensor type, sample ordering, missing-value rate |
| Climate / history archive | 10 min, capped fetches/tick | Job misses 3 cycles or focus points stop refreshing | Fetch count vs `CLIMATE_MAX_FETCHES`, cache-age vs `CLIMATE_MAX_AGE_MS`, focus-point derivation (camera + quakes) |
| Static cables/faults/geomag/elevation | Weekly/monthly/manual | Job failure or unexpected large row-count/hash change | Source hash/version, licence review date, geometry/data sanity |
| OpenRouter | Hourly/12 h/daily summaries | Narrative error ratio or spend threshold | Status, selected model, latency, tokens/cost, empty/unsafe output; source facts remain available without prose |

For each provider, keep these dashboard fields: `last_attempt`, `last_success`,
`last_source_timestamp`, `HTTP/status`, `records/files`, `bytes`, `latency`,
`consecutive_failures`, `credential_expiry/plan`, `terms_reviewed_at`, and
`maintainer`. Avoid logging query strings that contain keys.

## Credit strings to expose in the product

At minimum, the Credits panel/footer should be able to compose the following
only when the corresponding source is actually visible:

- Weather: active model owner(s), including every visible regional nest; include
  licence/link and “processed/modified” where required.
- Basemap: the exact selected basemap registry credit.
- Alerts: issuing national authority, then aggregator (`via WMO SWIC`,
  `via MeteoAlarm`, or `GDACS`).
- Overlays: `NASA FIRMS`, `NASA EOSDIS GIBS`, `EUMETSAT EUMETView`,
  `NOAA SWPC OVATION Prime`, `IAGA IGRF-14`, `USGS`, `EarthScope/IRIS GSN`,
  `Smithsonian/USGS Global Volcanism Program`, `IOC/VLIZ`, PB2002 and the
  authorised cable dataset.
- Tracks/media: actual ADS-B/AIS provider, `CelesTrak`, `hexdb.io`, and
  PlaneSpotters photographer + source link.
- Place/content: `© OpenStreetMap contributors`, `GeoNames`, `Open-Meteo`, and
  article/image-specific Wikimedia credits.
- Cameras: the persisted `cam.attribution.requiredText` and link beside the
  media, not only in a separate legal page.

## Ownership checklist

Review quarterly and whenever a provider changes API version, licence, pricing,
authentication, hostname, dataset name, or attribution wording.

- [ ] A maintainer is named for every **Default** and **Conditional** source.
- [ ] Key owners, plan limits, renewal dates and emergency revocation steps are in
      the private secrets/operations system—not this repository.
- [ ] The on-air credits are tested in clean view, broadcast chrome, admin cards,
      screenshots and recorded output.
- [ ] Each cached record preserves source, source timestamp, fetched timestamp,
      original link and required credit fields.
- [ ] Stale data is labelled or hidden rather than silently presented as live.
- [ ] Provider terms and attribution were rechecked and dated.
- [ ] Failover providers are credited when they actually take over.
- [ ] Dynamic media has an allow-list, rights record, takedown path and visible
      source credit.

## Deliberate exclusions

MongoDB, Redis, BullMQ, Socket.IO, npm packages and the application's own
`/api/*` routes are internal infrastructure/software dependencies, not external
data sources, so they are not inventoried above. Package licences should be
handled by a separate software-bill-of-materials and dependency-licence report.
