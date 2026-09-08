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

### Round 3 (2026-09-08)

Second re-profile (after round 2): busy 94 %, 16.4 fps, Layout STILL 349× / 2.7 s
(~1 per frame, ~8 ms each); AutoScroll's forced layout is gone. deck rose to 26 %
because this capture was a zoomed-in shot with XYZ tiles on: `TileLayer` is a
composite whose `shouldUpdateState` fires on every viewport change, so during any
camera motion deck re-walks the whole stack every frame and recomputes tile
bounding volumes (~9 %), and draw is 16 % (~100 sublayers × luma uniform
bookkeeping). `_createMesh` / `_updatePalette` stayed gone.

- **Alert poll identity** (the 1.7–1.9 s stall): `useAlertFeatures` now fingerprints
  each fetched set (id · sent · memberCount · severityRank · vertex count) and keeps
  the previous array when unchanged, so the four alert passes don't re-tessellate
  every dissolved polygon on every worker beat.
- **Ruled out by local trace experiments** (`scripts/profile-watch.mjs --trace` on a
  synthetic 11 k-node page): per-frame `transform` writes on absolutely positioned
  elements cause style recalc but NO layout (the icon pins are innocent); per-frame
  text changes DO (Added/Removed from layout · #text) and a following layout read
  forces them. The sub-globe readout is not rendered on air (`showReadout={false}`).
  All chrome `@keyframes` animate transform/opacity/stroke-dashoffset only.
- **Next**: run `--trace 8` on the OBS box. The report names the node, reason and JS
  caller of every layout invalidation plus which JS forces layouts, and breaks the
  `(program)` bucket down by renderer event (Layout / UpdateLayoutTree / PrePaint /
  Paint / Layerize / Commit …).

### Round 4 (2026-09-08) — the trace answers

`--trace 8` on gds1 (8 s window, ~100 frames): RunTask 7961 ms · **Layerize 4065 ms
(40 ms/frame)** · FunctionCall 1827 · **Layout 1302 ms (100×, 13 ms each, avg 115
dirty / 1050 objects)** · UpdateLayoutTree 476 · PrePaint 193 · Paint 159 · Commit 90.
No JS forces layout any more. Layout invalidations per frame: "Style changed ·
circle ×2, rect ×1" = the G.O.D.S. banner's CSS-animated SVG shapes (gbSpin /
gbSpinRev / gbDash / gbPulse / gbSweep) — a style change on an SVG child re-lays-out
the whole SVG root, and that root held a dozen letter-spaced `<text>` runs. Plus
~12 k "Added/Removed from layout · #text/SPAN/DIV" in 8 s from React commits
(`removeChild` ~40 ms self): some list is remounting ~1.5 k nodes/s (44 IMG
removals too). DOM was 13.2 k nodes in this window (7.8 k earlier).

- **Banner split** (`GodsBanner.tsx`): two stacked SVGs sharing the viewBox — the
  animated chrome (sweep, bezel rings, dashed orbit, pulse dot; no text) in the
  lower one, all text in the upper one. Per-frame relayout now touches ~25 plain
  shapes; the text SVG relayouts at 1 Hz (clock). Wrapper `<div role="img">`
  carries the accessible name; BrandPanel tests check `style.width` instead of a
  `width` attribute.
- **Profiler**: `--layers` (cc layer census with Blink's compositing reasons +
  DOM node) and `--dom-census N` (MutationObserver churn by parent path + inserted
  text) — Layerize scales with paint chunks × composited layers, and the DOM
  census names the remounting list.
- Local trace experiments: a `transform` write on an abspos element → style recalc
  only (no layout); a text change → layout. Canvas `fillText`/`strokeText` force a
  style recalc (Blink resolves the canvas font via style), which is why GlobeLabels'
  tick shows the pending layout-tree rebuild on its own stack — it's paying for
  React's DOM churn, not causing it.
- Next: `node scripts/profile-watch.mjs http://localhost:9221 --seconds 20 --layers
  --dom-census 5 --trace 8` — read the layer list (expect the 4 canvases, the
  crawl, the scrolling traces, the World Watch marquee; anything "Overlaps other
  composited content" in bulk is the Layerize driver) and the churn list.

### Round 5 (2026-09-08) — the DOM-size driver

Second `--trace` window (same build): DOM 5.6 k nodes → **Layerize 5.6 ms/frame**
(vs 40 ms at 13.2 k nodes). Layerize scales with the slide on air. The trace also
showed ~1.5 k nodes/s being ADDED (DIV/SPAN/#text triplets + ~5 IMG/s) with
removals arriving in bursts, and the hot row component `em` resolved to
`WorldFeed`'s `FeedRow`. Cause: the WORLD REPORT deck's per-kind slides render
the ENTIRE World Watch feed as DOM rows, twice (the old seamless CSS marquee), so
the ALERTS slice is ~1 000 boxed rows ≈ 13 k nodes + hundreds of thumbnail
`<img>`s, a compositor layer the height of the whole list, and thousands of nodes
mounted/unmounted on every deck rotation.

- **Windowed marquee** (`WorldFeed.tsx` → `MarqueeFeed`): only `visible + 2` rows
  in the DOM; sub-row motion is a transform written to the track each frame
  (compositor-only); the window shifts by one row every 2.4 s (a dozen-row React
  render); lap-counter keys keep row identity while sliding. Same pace and look,
  nothing capped — every row still scrolls through.
- Remaining per-frame work after this + the banner split: GlobeLabels' pin style
  writes (~18/frame) + canvas text forcing a style recalc (~3 ms/frame with a big
  DOM, less with a small one), deck draw (~10 %), CSS animations (reticle scan,
  syslog lines, traces).

### Round 6 (2026-09-08) — measured after rounds 4+5 deployed

`--layers --dom-census 5 --trace 8` on gds1: **busy 44.9 %** (was 93), **29.8 fps at the
OBS 30 fps cap, p95 33.4 ms** (no drops; one 167 ms hitch), Layout 0.3 ms avg,
Layerize 1.1 ms/frame, DOM 5.6 k, churn 22 nodes/s (feed window + clock text).
78 cc layers (32 overlap-squashed chrome, 4 canvases, 10 animations; the crawl is
a 39 103×34 px layer). Remaining: deck draw ~12 % of wall, GlobeLabels tick ~6 %
(26 pin style writes/frame → one of the two style recalcs per frame; canvas text
forcing the other), (program) ~15 %.

- **Labels as sprites** (`GlobeLabels.tsx`): every distinct name/colour, detail
  chip and icon glyph is rasterised once and `drawImage`d — no `strokeText`/
  `fillText` per frame (each resolves the font via the style engine) and the icon
  pins are no longer DOM: the React icons render into a `display:none` holder,
  are serialised to SVG images (CSS `var(--gods-*)` resolved) and drawn on the
  canvas. The page now writes NOTHING to the DOM per frame from the globe side.
  Unit vectors cached per label object. FIFO sprite cache (4 000).
- **deck draw census**: `Globe.tsx` exposes `window.__godsDeck` (diagnostics only);
  `profile-watch.mjs --deck` prints how many primitive layers deck draws per frame,
  grouped by id prefix. deck draw is now the largest per-frame item (~4 ms draw +
  ~2 ms luma uniform/bind bookkeeping per frame at ~50–70 draws); the census says
  which groups (tiles when zoomed in, the 4 alert passes, stations …) to thin.
- 60 fps (deferred by the operator): the rAF is pinned at 30 by the OBS browser
  source (`OBS_BROWSER_FPS`, docs/obs-setup.md "Pushing the frame rate up"). At
  ~15 ms main-thread per frame today, 60 would run ~90 % busy — needs the
  sprite round + a deck draw cut first; and on Linux OBS each browser source at
  60 doubles the CEF→OBS frame-copy cost per stream.

### Round 7 (2026-09-08) — spin segment + deck census

Run during a world spin: busy 49 % (34.6 % on a hold) — the difference was the
SUB-GLOBE locator (`SubGlobeWidget`, inside the G.O.D.S. logo): parked it skips
repaints, but on a spin it repaints every 80 ms tick and one paint (a few thousand
coastline vertices projected, horizon-clipped, filled: `closePath`/`lineTo`/
`projectOrtho`) measured ~7 ms → ~9 % of wall. `--deck` census: only **12
primitive layers drawn per frame** (basemap bg/land, 2 border passes, relief +
contour bitmaps, faults, volcano glow/marker, cities, pulse ping/dot) — deck's
~4 ms/frame is luma 9's per-draw bookkeeping (setProps/updateUniformBuffer/
setUniforms/bindBuffer ≈ 0.3 ms per draw), not an oversized stack.

- **Sub-globe → Web Worker + OffscreenCanvas** (`subglobe.worker.ts`,
  `subglobe-worker-client.ts`): the widget transfers its canvas and posts the
  chased camera per tick; the worker fetches/simplifies the land itself and paints.
  Main-thread fallback when Workers/OffscreenCanvas are missing (jsdom, old CEF);
  `<canvas key={size}>` remounts on a size change (a transferred canvas can't be
  re-transferred). `LAND_URL`/`COUNTRIES_URL` moved to `layers/data-urls.ts` so the
  worker bundle doesn't pull deck.gl. jest maps the worker client to a null stub.
- deck: nothing left to thin at 12 draws; further savings would need fewer layers
  per scene (e.g. merged border passes) or upstream luma work.

### Round 8 (2026-09-08) — the heaviest scene (`/watch/default`)

`--deck --trace 8` on the main scene: busy 75 %, 29.1 fps at the 30 cap, p95 33.4 ms
(holds frame rate). **31 primitive layers drawn/frame** (humidity raster + nest, wind
particles + nest, pressure contour + high/low text ×2, 4 alert passes ×2, country glow
×7, borders ×2, cities, volcano, weather point, basemap ×2) → deck 45 % of wall, of
which luma's per-draw uniform plumbing (setProps/updateUniformBuffer/getData/
setUniforms/bindBuffer/bufferSubData) ≈ 17 %; TextLayer draws twice per sublayer
(outline + fill), ParticleLayer runs a transform-feedback pass + draw per layer, so
~40 luma draws a frame at ~0.2 ms each. DOM side ~14 %, labels 5 %, GC 2 %.

- Pulse/glow commit cap 30 → **15 Hz** (`PULSE_FRAME_MS` 60): a 30 Hz cap was a no-op
  at the OBS 30 Hz rAF, so every frame re-walked the stack and re-rendered the
  pulse/glow composites' ~15 sublayers (~1.5 ms). Breathe steps in 25–40 increments —
  imperceptible.
- Profiler `--callees <substr>`: call-tree breakdown under one function.
- Checked and ruled out: WeatherLayers' HighLowLayer does NOT re-render its text per
  viewport change (the `shouldUpdateState || viewportChanged` override is a different
  class); its cost is plain draw count.
- Left on the table, each a few draws (~0.6 % wall per draw) with a visual trade-off:
  merge the alert glow-wide + glow-mid passes; drop the country-glow bloom pass; H/L
  text without outline (halves its draws); fewer particles/nests on wide shots.

### Round 9 (2026-09-08) — rounds 7+8 live: the DOM pipeline and the label canvas

Measured on `/watch/default` (20 s, country spotlight + alerts glow + particles on
air): busy 82.5 %, 28.7 fps (p50 33.3 / p95 33.4 ms, one 667 ms stall), heap
525 MB, 30 primitive layers. The sub-globe paint is gone from the table (round 7
landed) and `setLayers` is 3.6 % at the 15 Hz pulse (round 8). Where the frame goes:

| bucket | share of busy | ms / frame | what it is |
| --- | --- | --- | --- |
| deck `_animationFrame` | 57.7 % | ~16.6 | `Model.draw` 34.6 % (uniform-buffer plumbing ≈ 4.4 ms/frame, luma GL-state tracking + `bindBuffer` ≈ 1.6 ms, WeatherLayers `ensureDefaultProps` freeze+spread 0.4 s/20 s); ~26 real GL draws — every stroke-only GeoJsonLayer also lists a `polygons-fill` sublayer whose `draw()` is a no-op, which is what the census's "2×" rows are |
| `(program)` | 19.1 % | ~5 | the renderer pipeline, per the trace: Layerize 1.4 + Commit 1.2 + PrePaint 0.9 + style 0.6 + Paint 0.4 + Layout 0.2 |
| label canvas | ~12 % | ~3.5 | `drawImage` 1.32 s (icon sprites were SVG `<img>`s — Blink re-rasterises the vector on EVERY drawImage), loop/grid/project ≈ 0.6 s |
| pulse commits (15 Hz) | 3.6 % | ~1 | ~2 ms per commit, all deck prop-diffing of the GeoJsonLayer → PolygonLayer → Path/SolidPolygon trees the country glow rebuilds |
| GC | 2.3 % | | scavenges from per-frame allocation |

**Per-frame DOM invalidators** (8 s trace, 236 frames): the banner SVG's five
CSS-animated children (sweep rect, status rect, two spin circles, dashed
ellipse — the counts match exactly) → style + layout + paint + Layerize of that
root every frame; plus per frame 2 DIV + 1 SPAN + 3 `svg` "Animation" style
invalidations and ~2 inline-style DIV mutations. Local headless-Chrome test
(`scratchpad/anim-test*.html` + `--trace`): HTML-level opacity/transform
animations cost the main thread NOTHING in any context tried (flex item, inline
span, inline `<svg>` root, under clip-path / filter / backdrop-filter / a scaled
will-change stage); the same animation on an SVG child costs style + layout +
paint + Layerize every frame. So the OBS page's DIV/SPAN/svg ones are animations
CEF is refusing to composite for a reason only the live page can show.

Shipped:

- **Banner motion → canvas** (`GodsBannerMotion.tsx`, drawing in
  `banner-motion.ts`): sweep, bezel rings, aperture ticks, both orbit rings (the
  live-core back-arc hide is an even-odd clip), status pulse — geometry, dash
  patterns, colours and periods verbatim from the SVG. The panel SVG keeps only
  the static fill/border/grid and the aperture mask; no animated SVG child is
  left in the banner. Tests: `banner-motion.test.ts` (recording context).
- **Label canvas**: icon sprites baked to bitmaps on load; text sprites memoised
  per label object (no per-frame cache-key strings); numeric collision-grid
  keys; a frame whose camera + size + label generation + icon epoch are
  unchanged is skipped outright; `window.__godsLabels` last-frame counters
  (`--deck` prints them: labels drawn / facing / in zoom range, drawImage calls,
  frames skipped).
- **Profiler**: `--anim-census` (every running animation by target element +
  SMIL); `--trace` now resolves the nodes Blink re-styles/re-lays-out per frame
  with no JS involved to elements (ancestor chain, attached animations, inline
  style) — the list that names the DIV/SPAN/svg animations above.
- jest: global quiet `getContext` stub in `jest.setup.ts`.

Next run: `node scripts/profile-watch.mjs http://localhost:9221 --seconds 20 --deck --trace 8 --anim-census`.
Expect Layout ≈ 0 and the banner's rect/circle/ellipse rows gone; read "Nodes
re-styled every frame" to name the remaining DIV/SPAN/svg animations, then
either give them a compositable form or move them to a canvas — only once ALL
per-frame invalidators are gone do PrePaint/Paint/Layerize drop to the frames
with real DOM updates (~7/s). Still on the table for deck: countryGlow via
direct `PathLayer`/`SolidPolygonLayer` (≈¼ the layers diffed per 15 Hz commit),
a shader-side breathe (`DECKGL_FILTER_COLOR`/`_SIZE` injection with a time
uniform — no commit loop at all, 30 Hz breathe), and the visual-trade-off cuts
listed under round 8.

### Round 10 (2026-09-08) — the new diagnostics on the live page (pre-round-9 build)

The `--anim-census` + resolved-node run (busy 82 %, 28.5 fps) named every
per-frame invalidator on `/watch/default`: the banner's five SVG children
(round 9's fix, not yet deployed) plus the ticker crawl DIV, the GodsPanelHeader
pulse DIV (×2), the LiveAlertPanel dot SPAN and three monitor-row trace `<svg>`
roots — all CSS animations CEF ticks on the main thread. Only animations that
START inside the trace window carry a `compositeFailed` verdict (two page-dot
transitions did: 8192 = unsupported property, +32 = invalid compositing state);
the infinite ones started long before, so no verdict from this run.

What the trace's thread list adds: the renderer has a Compositor thread
(threaded compositing on); `RasterTask` runs in the renderer's worker pool
(software raster — every paint invalidation re-rasterises tiles on the CPU);
`HitTest` cost 1.6 ms/frame — Blink's hover update after each per-frame layout,
i.e. another banner tax.

Local reproduction, `google-chrome --disable-threaded-animation` +
`scratchpad/anim-test3.html`: the identical signature (a "style: Animation"
invalidation on every animated element per frame, `<svg>` roots included) — and
in that mode the change still takes the compositor's direct-update path (no
Paint, Layerize ≈ 2 µs) because Chrome gives an actively-animated element its
own layer. If CEF's build doesn't promote them, `will-change` forces the layer.

Shipped: `will-change: transform` / `opacity` on the ten CSS-animated elements
(ticker crawl, the four MonitorCluster traces, seismic + tide station traces,
GodsPanelHeader pulse, ON AIR dot, alert-panel dot, reticle scan, both spinners).

Next run (rounds 9 + 10 deployed): expect Layout ≈ 0, HitTest small, the
rect/circle/ellipse rows gone. The DIV/SPAN/svg rows will STILL be listed (they
are still ticked on the main thread) — what should change is Paint and Layerize
collapsing to the frames with real DOM updates (~7/s). If Paint/Layerize stay at
one per frame, CEF isn't taking the direct-update path either, and the fallback
is a shared rAF driver writing transform/opacity itself (or quantising the
pulses to a few Hz).

### Round 11 (2026-09-08) — rounds 9+10 measured, and the cover that never lifted

Measured with rounds 9 + 10 live (`/watch/default`, 20 s): busy 82 → **53.6 %**,
29.6 fps (p95 33.4 ms, max 200 ms). Trace, per 8 s: Layout 259 → 59 (one frame
in four), Paint 238 → 59, HitTest 411 → 0 ms, Layerize 1.46 → 0.6 ms/frame,
style 0.6 → 0.4 ms; Commit unchanged at 1.7 ms/frame and now the largest
pipeline item (the main thread waiting on the compositor's commit). Label canvas
`drawImage` 2.3 → 0.33 ms/frame (112 labels, 163 draws). The ticker crawl and
monitor traces are still main-thread ticked but cost a style recalc only.
Caveat: a lighter scene (21 layers, no alerts) — part of the drop is content.

**And an on-air bug the same run exposed.** The loading spinner was animating
throughout, the DOM was 534 nodes (a tenth of normal), every `ready`-gated
overlay was missing from the census, and the label counter put the page at
10.5 min uptime: the scene had been behind the cold-start cover for ten minutes
with the globe drawing underneath. `useGlobeReadyOnce` cancelled the previous
load's latch on every effect re-run (a refetched manifest object, an fhr step,
a new bake stamp), so whenever those inputs changed faster than a full texture
set loads it never latched — and nothing had a timeout, so one hung texture
fetch would wedge it for good. Fixed in `lib/globe-ready.ts` (URL-set keyed, no
cancellation, `READY_TIMEOUT_MS` 45 s fail-safe) and `lib/textures.ts` (90 s
per-texture timeout, entry dropped so the next request retries); tests cover
the churn, the timeout and the retry.

What's left is deck at 67 % of busy (~12 ms/frame at 21 layers, ~16 at 31):
per-draw luma plumbing as before. Two specific items stand out: the pressure
high/low TextLayer is 3.3 ms/frame for four draws (candidate: draw the H/L
glyphs on the label canvas instead — WeatherLayers keeps its point finder
internal, `getHighLowPointData`, so it needs investigating), and both wind
particle layers (global + nest) draw at once, 1.7 ms/frame.

### Round 12 (2026-09-08) — the H/L text and the label projection

First apples-to-apples read on the heaviest scene with the ready-latch fix live
(31 primitive layers, alerts + volcanoes + country glow on air): busy 82 →
**68.5 %**, 29 fps (p95 33.4 ms). Layout and Paint hold at one frame in four;
Layerize is still every frame (1.4 ms) with Commit 1.05, PrePaint 0.5 and
style 0.4 → ~3.4 ms/frame of pipeline. Its per-frame trigger is NOT identified:
the two JS transform writers (World Watch marquee, AutoScroll) already sit on
`will-change` layers, so the remaining suspects are the canvases or gaps in
CEF's direct-update coverage — open. deck is 63 % of busy (~15 ms/frame); the
pressure H/L TextLayers alone 3.4 ms/frame (four luma draws with per-draw
uniform re-uploads and glyph-atlas re-binding); particles 2.1 ms (global +
nest both drawn); the label loop 1.3 ms — 1 131 `project()` calls a frame to
draw 62 labels (a dense region: the collision grid needs every screen
position to declutter).

Shipped:

- **H/L centres → label canvas.** `lib/high-low.ts` finds them from the decoded
  pressure texture: byte grid → hPa, box blur scaled to the separation radius
  (~9 cells on the 0.25° grid, so a byte-quantised plateau gets one strictly
  highest cell), extrema = at least as high as the 8-neighbour ring and
  strictly higher than the ring two cells out (a plain "≥" admitted every flat
  cell beside a dip, ringing each low with fake 1013 hPa highs; a plain strict
  test missed peaks that straddle two cells), then bucket + radius suppression
  (WeatherLayers' own rule). `layers/high-low-labels.ts` turns them into
  centred label-canvas entries (13px bold letter, 11px value, Helvetica
  Neue/Arial, white on a dark halo — the deck layer's 12px white/black look),
  memoised per texture. `pressureLayers` returns the ContourLayer only: −4
  luma draws, −2 composite layers per frame. Tests: `lib/high-low.test.ts`
  (centres, values, radius suppression, antimeridian, plateau, no-data).
- **Label fast projection.** `GlobeLabels` caches each label's world position
  (`viewport.projectPosition` is pure lng/lat → sphere; zoom lives in the
  matrix) and projects with one allocation-free multiply through
  `pixelProjectionMatrix` — exactly deck's `project()` (GlobeViewport doesn't
  override it) minus the trig and three array allocations per label per frame.
  `align: "center"`, `font`, `detailStyle: "plain"`, `detailFont` added to
  `OverlayLabel` for the H/L look.

Next run: expect the `pressure-highlow` rows gone from the deck census, the
label census a few dozen labels higher, `project`/`projectPosition` gone from
the Bottom-Up table, and busy a few points lower. Still open: the per-frame
Layerize trigger, global + nest particles both drawing, and luma's per-draw
plumbing (only the visual-trade-off cuts and a shader-side breathe left there).

### Round 13 (2026-09-08) — the pulse loop, and texture decodes

Round 12 measured (full scene, 28 primitive layers, alerts + volcanoes + a
country glow on air): busy 68.5 → **57.5 %**, 29 fps. The H/L rows and
`project()` are gone as predicted; deck is 54 % of busy (~10.7 ms/frame,
down from 15). What the run turned up next: `setLayers` at 6.1 % — the 15 Hz
pulse loop re-diffing 42 layers per commit while a country glow was on air;
`getImageData` at 2.6 % — WeatherLayers decoding the map-type tour's nest
textures on the main thread (plus their 4 MB arrays on the GC); React DOM
commits ~1.2 ms/frame (not yet chased); and Layerize still every frame at
~1.3 ms with no identified trigger.

Shipped:

- **BreatheExtension** (`layers/breathe-extension.ts`): a deck LayerExtension
  whose `draw` hook writes two floats (alpha, size multipliers from a
  wall-clock phase) into a uniform block and injects `color.a *= …` /
  `size *= …` through `DECKGL_FILTER_COLOR` / `DECKGL_FILTER_SIZE`. The country
  glow's four stroke passes + fill and the on-air area highlight (fill + edge)
  are now STATIC layers carrying a `breathe` spec — Globe commits them once
  per spotlight and they breathe at the full frame rate. Semantics match the
  old `opacity` / `lineWidthScale` uniforms exactly (deck's pow(x, 1/2.2)
  opacity gamma included; base widths sit at or above the min-pixel clamp so
  the post-clamp scale is equivalent). Only the POINT ping (sonar ring + dot,
  whose ring width and radius move against each other, which one size uniform
  can't express) still rides per-commit uniforms, and the pulse loop now
  commits only while `pulseIsPoint()` says one is on air.
- **Texture decode worker** (`lib/texture-decode.worker.ts` + client): fetch,
  decode and readback in a two-worker pool, buffer transferred back; same
  Blink decode pipeline as an `<img>` on a canvas, so bytes match
  WeatherLayers' loader (which stays the fallback where Workers/OffscreenCanvas
  are missing — and in jest).
- **Texture state leak**: Globe's `loadedTextures` Map kept every texture ever
  loaded alive, defeating the LRU's memory bound on a 24/7 page (4 MB per map
  cycle / run / forecast hour). It's now pruned to the wanted set plus whatever
  the LRU still holds.

Next run: expect `setLayers` a few percent lower with a glow on air,
`getImageData` gone from the table, and a flatter JS heap over hours. Still
open: the per-frame Layerize trigger, React's per-frame commit work (run with
`--dom-census 5` to name the churn), global + nest particles both drawing, and
luma's per-draw plumbing.

### Round 14 (2026-09-08) — React re-renders, and what Layerize really is

Round 13 measured (full scene, 28 layers, country glow on air): busy 57.5 →
**54.4 %**, 29.3 fps. `getImageData` gone; `setLayers` 6.1 → 3.9 %. The DOM
census showed only ~30 node changes a second, yet React's commit phase
(`setProp`, `setValueForStyles`, `commitMutationEffects`) was ~1.2 ms/frame:
a large subtree re-rendering several times a second with fresh inline-style
objects, every element re-diffed key by key. Causes found in code: the
director heartbeat re-renders the page every second (and `WatchSurface` was
not memoised, so identical props still re-rendered the whole chrome); the
page minted fresh `[lng,lat]` / bbox / `[]` props per render; `WatchSurface`
passed `[]` literals for every "layer off" list; and `mergeControlState`
returned a new state object even for a heartbeat that changed nothing, so
socket beats re-rendered everything too.

A local experiment (`scratchpad/layerize-test.html`, 6 000 nodes, per-frame
canvas + a main-thread crawl animation, `--disable-threaded-animation`)
answered the Layerize question: locally it stays at ~17 µs/frame even at 6 k
nodes, while PrePaint scales with DOM size (~0.6 ms/frame at 6 k). The OBS
page's 1.3 ms Layerize is therefore a CEF-version tax (its Chromium does a
fuller compositor update per frame than current Chrome), not a page bug; the
lever that works everywhere is DOM weight, which the profiler's `--dom-census`
now reports per subtree.

Shipped:

- **`mergeControlState` returns `base` itself when nothing changed** (shared;
  `./update-shared` run) — a repeated heartbeat leaves React state identity
  alone and memoised consumers skip.
- **Memoised surface and chrome**: `WatchSurfaceBody` and `BroadcastFrame`
  wrapped in `React.memo` (in WatchSurface.tsx); all "layer off" props share
  one `NONE` array; both watch pages stabilise `pulseAt`, `glowRegionBbox` and
  `upNext` by value (`lib/use-stable.ts`, `useStableJson`). Render-time
  `Date.now()` uses in the chrome (map freshness, "ago" labels, 3 h buckets)
  are coarse and still refresh on the polls, so memoisation is safe.
- **Profiler**: `--dom-census` lists the heaviest subtrees (≥150 nodes).

Next run: expect React's share (`ua`, `i_`, `cr`, `t_`) to fall well below
1 %, and the census to name what holds the ~5.7 k nodes (suspects: SlideDeck
keeping every inactive slide mounted; the hidden icon holders). Still open:
global + nest particles both drawing; luma's per-draw plumbing (~10 ms/frame
at 28 layers — only the visual-trade-off cuts remain there).

### Round 15 (2026-09-08) — what the DOM census named

Round 14 measured on a HEAVIER moment (a Japan spotlight zoomed onto a dense
city region: 138 labels drawn, 209 `drawImage`, a JMA-MSM nest raster, 29
layers): busy 59.5 %, 28.9 fps — labels alone ~1.7 ms/frame at that density,
which is scene, not regression. React's share did NOT fall as expected
(~600 ms/20 s again). The new DOM-weight census explained both open items:

- `main > div.deck-widget-container` = 3 602 nodes. That is OUR Globe host
  (deck 9.3's WidgetManager adds its class to the canvas's parent), and the
  nodes are GlobeLabels' hidden icon holders: ~350 station/volcano/gauge pins
  as `display:none` SVGs. Free for layout/paint, but React re-diffs all of them
  and every one is re-serialised (`serializeToString` 59 ms) each time the
  label list rebuilds — and `seismoActive` (the station cycle) rebuilds it every
  few seconds. That was the surviving React cost.
- The bottom ticker crawl = 1 636 nodes (two 818-node copies of the whole
  entry list for the seamless loop). In the layout tree and inside the
  per-frame-animated track.

Shipped: **keyed icon sprites**. `OverlayLabel.iconKey` names an icon's LOOK
(`heartbeat:on`, `volcano:<rgb>:<status>`, `wave:off`, `pin:<colour>`); the
canvas rasterises one sprite per (look, dpr, current theme-variable values —
`iconSig`), serialises each look once to learn which `--gods-*` variables it
reads (`iconVarsOf`), and drops the hidden holder as soon as its sprite exists
(`holderLabels`). ~350 holders → ~10, no per-rebuild serialisation, no React
diff of the pins. Tests in `GlobeLabels.test.ts`.

Next run: expect the census's Globe-host subtree to shrink from ~3.6 k to a
few dozen nodes and React's frames (`cr`, `i_`, `ua`) to drop. Still open: the
1.6 k-node ticker crawl (a windowed crawl like World Watch's marquee would
cut ~1.5 k nodes → less PrePaint/Layerize per frame), global + nest particles
both drawing, luma's per-draw plumbing.

### Round 16 (2026-09-08) — dense label shots, and the cross-fade

Round 15 measured: DOM 5 913 → **2 488** nodes, React's frames 597 → 391 ms
per 20 s, `serializeToString` gone, heap 179 → 70 MB. Busy read 68.4 % because
this was the densest label shot yet — 270 labels drawn of 1 122 facing the
camera, 375 `drawImage` calls — putting the label canvas at ~3.3 ms/frame:
1.7 ms of blits plus ~1.5 ms projecting and collision-testing a thousand
candidates to keep a quarter of them. `setLayers` was still 3.7 %: the
map-type cross-fade stepped `progress` every 60 ms and every step rebuilt and
re-diffed the whole deck stack (~12 commits per cut).

Shipped:

- **View culling before projection** (`viewCosMin`): the four viewport corners
  are unprojected once a frame and every label beyond their angular reach
  (+25 % and a degree for the label margin) is skipped before projection and
  the collision grid — on a zoomed shot that is most of the ~1 000 facing
  labels. Whole-globe shots fall back to the hemisphere test unchanged.
- **Combined name + detail sprites**: the left-anchored layout pre-composes the
  two sprites once per label (`comboSprite`, keyed on its parts) so a label
  with its detail line is ONE `drawImage`, not two — 375 → ~270 calls on that
  shot, placement identical.
- **Cross-fade on the GPU**: `BreatheExtension` gained a one-shot `ramp` wave
  (`startMs` → over `periodMs`, stops requesting frames when done); every
  scalar raster now carries the extension (with a null spec when not fading,
  so `extensions` never changes and no shader is recompiled mid-cut), and
  `useCrossfadeVariable` no longer ticks — it records the start and clears
  `from` once, so a map-type cut is two commits (start, settle) instead of ~12.
  The finest nest now fades with the base instead of popping.

Next run: expect the label loop's frames (`h`, `forCells`, `collides`) to
shrink on zoomed shots, `drawImage` calls ≈ labels drawn, and `setLayers` a
couple of points lower during the tour. Still open: the 1.6 k-node ticker
crawl; a label canvas in a worker (would take the whole ~3 ms off the main
thread in dense shots, but risks a one-frame lag between labels and their
dots during fast pans — a design call); global + nest particles; luma.

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
- **No per-frame layout** (round 2, after the first re-profile still showed
  Layout ~1/frame at ~11 ms and AutoScroll's step as the top JS frame): the
  pedestal ring's SVG `transform` attribute rotation (SVG layout every frame the
  globe turns) and its SMIL sweep (style invalidation every frame) were the
  per-frame dirtiers, and AutoScroll's `scrollTop` write then paid for that
  layout synchronously. `GlobeAtmosphere.tsx` is now ONE canvas (glow, ring,
  ticks, sweep, disc punch-out via destination-out) — no DOM style writes at
  all; host size via ResizeObserver. `AutoScroll.tsx` moves an inner wrapper
  with `transform` and measures box/content height from ResizeObserver entries —
  it never reads `scrollHeight` or writes `scrollTop`.
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

First re-profile (after round 1): busy 93 → 89 %, `setLayers` 7.8 → 0.5 %,
`_createMesh`/`_updatePalette` gone, will-change 1498 → 1, heap 161 → 106 MB — but
Layout still ~1/frame (356× = 3.8 s) and 16.5 fps, which is what round 2 targets.

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
