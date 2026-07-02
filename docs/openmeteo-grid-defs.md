# Open-Meteo `.om` nest grid definitions (for the reprojection port)

Several Open-Meteo `.om` spatial nests are on **projected native grids** — baking them
flat as lat/lon mis-registers the map (see memory `openmeteo-projected-grids`). To fix,
reproject at ingest using the authoritative `ProjectionGrid` from Open-Meteo's Swift
source (`github.com/open-meteo/open-meteo`, `Sources/App/<Provider>/<Provider>Domain.swift`).

**All grids are row 0 = south (first grid point = min latitude / bottom).**
**Reproject:** for each output lat/lon cell → forward-project to the native grid →
`col=(x−x0)/dx`, `row=(y−y0)/dy` → sample; mask out-of-grid ("fan") corners → alpha 0.

## `ProjectionGrid` origin conventions (differ per model!)
- **first-point lat/lon** (dmi): project `(latitude, longitude)` → `(x0,y0)` metres, step `dx,dy` metres.
- **corner lat/lon range** (metno): project SW `(latMin,lonMin)`→`(x0,y0)` and NE `(latMax,lonMax)`→`(x1,y1)`; `dx=(x1−x0)/(nx−1)`, `dy=(y1−y0)/(ny−1)`.
- **projected-metre origin** (ukmo): `longitudeProjectionOrigin`=`x0` m, `latitudeProjectionOrigin`=`y0` m; step `dx,dy` m.
- **rotated-degree origin** (meteoswiss): origin + `dx,dy` are in ROTATED DEGREES; forward-project real→rotated, then index.

## dmi-europe — Lambert Conformal Conic
```swift
ProjectionGrid(nx: 1906, ny: 1606, latitude: 39.671, longitude: -25.421997,
  dx: 2000, dy: 2000,
  projection: LambertConformalConicProjection(λ0: 352, ϕ0: 55.5, ϕ1: 55.5, ϕ2: 55.5, radius: 6371229))
```
bbox (crs_wkt) [W,S,E,N] = [-25.421997, 39.670998, 40.069855, 62.667618]. VALIDATED ✅

## metno-nordic — Lambert Conformal Conic (range-form origin)
```swift
ProjectionGrid(nx: 1796, ny: 2321, latitude: 52.30272...72.18527, longitude: 1.9184653...41.764282,
  projection: LambertConformalConicProjection(λ0: 15, ϕ0: 63, ϕ1: 63, ϕ2: 63, radius: 6371229))
```
bbox [W,S,E,N] = [1.918457, 52.302723, 41.764282, 72.18527]. VALIDATED ✅

## ukmo-uk — Lambert Azimuthal Equal-Area (projected-metre origin)
```swift
ProjectionGrid(nx: 1042, ny: 970, latitudeProjectionOrigin: -1036000, longitudeProjectionOrigin: -1158000,
  dx: 2000, dy: 2000,
  projection: LambertAzimuthalEqualAreaProjection(λ0: -2.5, ϕ1: 54.9, radius: 6371229))
```
bbox [W,S,E,N] = [-17.152863, 44.508755, 15.352753, 61.92511].
NOTE: same model as our DIRECT `ukv` nest (cdo-remapped, already aligned) → ukmo-uk is
REDUNDANT; can stay disabled unless we want its gust field. Def kept for completeness.

## meteoswiss-ch2 — Rotated lat/lon (rotated-degree origin)
```swift
let projection = RotatedLatLonProjection(latitude: 43.0, longitude: 190.0)   // rotated N-pole
let dx: Float = 0.02, dy: Float = 0.02
ProjectionGrid(nx: 545, ny: 353, latitudeProjectionOrigin: -4.06, longitudeProjectionOrigin: -6.46,
  dx: dx, dy: dy, projection: projection)
```
bbox [W,S,E,N] = [1.2333984, 42.57854, 16.846222, 49.786846]. PROVISIONAL ⚠️ (inland, no
coastal ref; use the DOCUMENTED pole 43/190, verify vs Lake Geneva/Constance thermal signal).

## NOT projected — genuine WGS84 lat/lon (no reprojection; keep/enable as-is)
`arome-france-hd`, `knmi-nl`, `arome-austria`, `icon-2i-italy`, `jma-msm`.
(`arome-austria` + `icon-2i-italy` were FALSE-flagged earlier — they're fine, re-enable.)

Sources: [Open-Meteo source](https://github.com/open-meteo/open-meteo) · per-model `latest.json` `crs_wkt`.
