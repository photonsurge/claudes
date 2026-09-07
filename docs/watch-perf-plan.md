# /watch main-thread performance — findings + fix plan

Context: a 35 s DevTools profile of `/watch/seismic` inside the OBS browser source
(gds1, CEF via remote debugging) shows the renderer main thread busy ~99 % of the
time: Scripting 23.2 s, Rendering 9.0 s, Painting 0.9 s, Idle 0.3 s. Nearly every
frame is dropped. The GPU/NVENC side is fine — this is CPU work on one thread.

The hot stack in the screenshot (`_animationFrame → redraw → _onRenderFrame →
updateLayers → setLayers → _updateLayers → _updateSublayersRecursively →
updateState → _updatePalette → fillRect`) is deck.gl applying a **new layer
array** and WeatherLayers **re-baking a palette texture** inside that update.
That only happens when a raster layer is re-instantiated with a fresh `palette`
reference — i.e. the whole base layer stack is being rebuilt, not just redrawn.

## Measured on gds1 (2026-09-07, `scripts/profile-watch.mjs`, 20 s, GTX 1080 Ti, OBS CEF)

- Main thread busy **93.2 %** · rAF **15.9 fps** · frame gap p50 33 ms, p95 133 ms, **max 1900 ms**.
- `(program)` (native: style/layout/compositor/paint prep) **59 %** of busy. Layout ran
  **372× = 3510 ms** (~once per frame, ~9 ms each); RecalcStyle 712× = 718 ms.
- DOM: 7407 nodes, **1498 inline `will-change` elements** (the label divs), JS heap 161 MB.
- deck.gl `_animationFrame` inclusive **16 %**: draw ≈ 8 %, `setLayers` ≈ 8 % — of which
  `_createMesh` 695 ms and `_updatePalette` ≈ 300 ms → the base stack rebuilds ~2×/s.
- Top JS self time: GlobeLabels tick **6 %**; `get scrollHeight` (AutoScroll forced layout)
  **5.4 %**; React DOM style commits (label divs re-diffed every `tracks` tick) ≈ 5 %; GC 2 %.
- rAF census: ~7 callbacks/frame (labels, atmosphere, deck, pulse commit, spin loop, AutoScroll).
- Not seen in this sample: earcut / country glow (no storm or country cut was on air).

Conclusion: roughly two-thirds of the busy time is DOM-overlay driven (labels + per-frame
layout + React commits); deck.gl is about one-sixth. Fix order below is re-ranked on this.

## Findings (from source, ranked by likely share of the main thread)

### 1. The on-air pulse/glow loop re-commits the whole deck stack every frame — and re-tessellates
- `public/src/components/Globe.tsx:1162-1177`: while `pulseAt` / `glowCountryIso` /
  `glowRegionBbox` is set (every quake, storm, volcano and country cut) a rAF loop
  calls `commitLayers()` **every frame**, which does `deck.setProps({ layers })`
  with `[...baseLayers, ...pulse, ...glow]`.
- deck then walks every layer + sublayer per frame (`_updateSublayersRecursively`
  over ~100+ sublayers). Same-instance base layers are cheap, but not free.
- `public/src/components/layers/alerts.ts:361`: the area breathe layer is built
  with `data: [onAir]` — a **fresh array each frame**. deck sees `dataChanged` and
  the GeoJsonLayer → PolygonLayer path **re-tessellates (earcut) the dissolved,
  country-sized alert polygon every frame**. This fires whenever the on-air point
  is within ~0.5° of an alert's rep point (`ON_AIR_EPS2`, alerts.ts:298) — always
  for `storm` cuts, often for `quake` cuts in warned areas.
- `public/src/components/layers/countryGlow.ts:166-205`: three stroke layers over
  the country outline with `updateTriggers: { getLineColor: now, getLineWidth: now }`
  → deck re-runs both accessors over **every outline vertex, every frame, ×3**
  (`public/data/countries.geojson` is 4 MB, so big countries are tens of
  thousands of vertices).

### 2. Every base-stack rebuild re-bakes palettes and re-meshes rasters (and it rebuilds often)
- `public/src/components/layers/props.ts:283-286` (`scalePaletteToDomain`) returns a
  new array on every call. WeatherLayers compares by reference
  (`palette !== oldProps.palette && this._updatePalette()` in
  `weatherlayers-deck.min.js`), so each rebuild re-parses the ramp, redraws a
  256-px canvas (`fillRect`) and uploads a new GPU texture — for every raster,
  contour, high/low and elevation layer on screen (base + nests + crossfade pair).
- `props.ts:22-25` (`manifestBounds`) returns a new array each call; deck's
  BitmapLayer does `if (props.bounds !== oldProps.bounds) _createMesh()`
  (`@deck.gl/layers/dist/bitmap-layer/bitmap-layer.js:61`) — a 2° globe mesh per
  full-globe raster, per rebuild.
- The rebuild effect (`Globe.tsx:857-1087`) has ~70 deps and fires on:
  `tracks` (1 s dead-reckon tick, `lib/tracks/useTracks.ts:340`; 1.5 s satellites,
  `:182`), `seismoActive`/`tideActive` (8 s station cycle,
  `lib/focus/focus-client.tsx:141-152`), each alert-cycle fade step (6 per
  boundary), every `loadedTextures` Map replacement, every socket beat
  (`shared/src/control.ts:838` `mergeControlState` allocates fresh `wind`,
  `basemapColors`, `units`, `elevation` objects even when unchanged — and those
  objects are deps), `sunTick`, region city fetches…
- Each rebuild diffs every layer's props, re-renders every composite's sublayers,
  and regenerates attributes for any accessor whose trigger moved. Tens of ms each,
  several times a second.

### 3. DOM label overlay: thousands of composited layers + per-frame style writes (the "Rendering" 9 s)
- `public/src/components/GlobeLabels.tsx:224`: **every** label div has
  `willChange: transform` (hidden ones included) → each is its own compositor
  layer. Base set is 300 cities, plus up to 2000 region cities once zoomed past
  3.2 (`app/api/cities/route.ts:48`, `lib/useRegionCities.ts`), plus stations,
  volcanoes, track names.
- The rAF loop (`GlobeLabels.tsx:141-217`) projects every label and writes
  `style.opacity` / `style.transform` per frame → style recalc for thousands of
  elements + a layer-tree update over thousands of compositor layers per frame.

### 4. Forced layout every frame from read-after-write across the rAF loops
- `GlobeAtmosphere.tsx:75-112` writes `width/height/left/top` and a new
  `mask-image` radial-gradient string every frame (during a push-in or breathe
  the values change every frame → layout + mask re-raster per frame).
- `components/broadcast/AutoScroll.tsx:58` reads `scrollHeight`/`clientHeight`
  every frame **after** the label/atmosphere writes → forced synchronous layout
  each frame. Same for any other per-frame DOM read in the chrome.

### Why this matches the profile
- Scripting 66 %: (1) per-frame deck walk + earcut + accessor regen, (2) rebuild
  bursts with palette/mesh rebakes, (3) label projection loop.
- Rendering 26 %: (3) style recalc + layer tree over ~2 k `will-change` divs,
  (4) forced layouts and mask re-raster.
- Painting small: the GPU is fine; this is all main-thread bookkeeping.

## Fix plan (re-ranked by measured payoff)

1. **Labels off the DOM** — render GlobeLabels into a single 2D `<canvas>` overlay
   (`fillText` per visible label, keep the collision grid). Removes ~1.5 k compositor
   layers, the per-frame style recalc, the React re-diff of 1.5 k divs every `tracks`
   tick, and most of the layout cost. Fallback if kept as DOM: no `willChange`,
   `visibility: hidden` for culled labels, write styles only on ≥0.5 px change, and
   split track labels from city labels so a track tick doesn't rebuild every label.

2. **Kill the per-frame layout** — `AutoScroll`: measure `scrollHeight`/`clientHeight`
   once and on `ResizeObserver`, write `scrollTop` only while moving.
   `GlobeAtmosphere`: write size/position/mask only when the disc changed (0.5 px
   tolerance, quantised mask geometry).

3. **Stop the rebuild churn** — cache `manifestBounds` per manifest and
   `scalePaletteToDomain` per `paletteId|domain` (stable identity → no `_createMesh`,
   no `_updatePalette`); make `mergeControlState` return `base.wind` / `basemapColors` /
   `units` / `elevation` untouched when the patch doesn't include them; split
   tracks/trails/orbits, quakes/stations and alerts into their own effects that replace
   their slot in `baseLayersRef` (the `refreshCityZoom` pattern).

4. **Pulse/glow uniform-only** — stable `data` identity (memoised `[onAir]` /
   `[{ position }]`), breathe via `opacity` / `lineWidthScale` / `radiusScale` instead of
   `updateTriggers: now` on accessors; same for the three `countryGlow` stroke layers.
   Matters most on storm and country cuts (not in the measured sample).

5. **Chase the 1.9 s stall** — open the saved `.cpuprofile` in DevTools and find the
   long task. Suspects: an alert poll handing a new array to the four alert
   GeoJsonLayers (full re-tessellation of every dissolved polygon on the main thread),
   or a region-city fetch mounting ~1.2 k label divs at once.

## Shipped (2026-09-07)

- **Labels → canvas**: `GlobeLabels.tsx` draws text labels on one 2D canvas
  (halo stroke + fill, detail chip); only icon pins stay DOM, hidden via
  `visibility` and positioned write-on-change. No `will-change` layers.
- **No per-frame layout**: `AutoScroll.tsx` measures overflow via
  ResizeObserver/MutationObserver (+ one settle re-measure), tracks position
  locally and writes `scrollTop` only while moving. `GlobeAtmosphere.tsx` writes
  size/position/mask only when the rounded disc changed; ticks rotate at 0.1°
  quantisation.
- **Stable references**: `props.ts` caches `manifestBounds` (per manifest),
  `scalePaletteToDomain` (per palette + domain) and `hexToRgba` (per hex) so deck
  never re-meshes and WeatherLayers never re-bakes a palette on a rebuild.
  `shared/control.ts` `mergeControlState` now reuses `base`'s nested objects and
  arrays when structurally unchanged (identity == changed).
- **Layer effect split**: `Globe.tsx` builds four groups (weather / events /
  cities / tracks) in separate effects with their own deps; `commitLayers`
  concatenates. The 1 s track tick and the station cycle rebuild only their group.
- **Pulse/glow uniform-only**: `alerts.ts` `onAirPulseLayers` uses stable `data`
  (memoised `[onAir]` / point) and animates via `opacity` / `lineWidthScale` /
  `radiusScale` — the area highlight is now a fill layer + an edge layer.
  `countryGlow.ts` bakes colour/width at the breath's peak and breathes via
  uniforms; flag-colour cycling is quantised to 200 ms. The pulse loop commits at
  ~30 Hz (`PULSE_FRAME_MS`).
- Still open: item 5 (the 1.9 s stall) — needs the long task from a saved profile.

Verify on the OBS box with `node scripts/profile-watch.mjs http://localhost:9221 --raf-census`
and compare with the 2026-09-07 baseline above (busy 93 %, 16 fps, Layout ~1/frame,
1498 will-change elements).

## Verification
- `node scripts/profile-watch.mjs http://localhost:9221 --seconds 20 --raf-census`
  against the forwarded OBS remote-debugging port (or a local Chrome) prints the
  Bottom-Up self-time table, fps, RecalcStyle/Layout counts and the number of rAF
  callbacks per frame. Run before/after each step; targets: busy < 40 %, Layout
  ≈ 0/frame, RecalcStyle ≪ frames, `_updatePalette`/`_createMesh` absent from the
  table, earcut absent while a storm is on air.
- No-code A/B on air: on /control, stop the director (pulse/glow off) → if CPU
  collapses, item 1 dominates; then toggle Cities off → item 3's share.
