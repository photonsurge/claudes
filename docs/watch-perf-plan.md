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

### Round 17 (2026-09-08) — luma's uniform buffers, and the label grid

Round 16 measured (two runs, the first mid-cut on a fresh load): busy 68.4 →
**58.7 / 56.0 %**, DOM 2 563 / 2 286 nodes, heap 237 → 129 MB once settled.
`drawImage` calls now track labels drawn (243 for 230; 63 for 61) and the culled
label loop is ~1.1 ms/frame on the dense shot. Deck is ~10 ms/frame (51–56 % of
busy) and the Bottom-Up table says where: luma's uniform plumbing — `bindBuffer`
(0.7 s), `getData` (0.4 s), `updateUniformBuffer` (0.38 s), `setUniforms` ×2
(0.45 s), `bufferSubData` (0.26 s), `_flattenCompositeValue`, `_updateCache` —
≈ 2.6 s of the 20 s, ~4 ms/frame across 22 real draws. Root cause in luma 9.3.5:
`UniformBlock.setUniforms` sets `needsRedraw` on EVERY call, whether or not
`_setUniform` found a changed value, so every block of every model (project,
picking, the layer's own, each extension's) is repacked into a fresh ArrayBuffer
and re-uploaded on every draw when only `project` moved with the camera.

Also read off the trace: the renderer pipeline is ~4.6 ms/frame (Commit 1.9,
Layerize 1.4, PrePaint 0.5, style 0.4); Layout ran 37× per 8 s at 1.6 ms each
because the page-indicator squares animate `width` on every deck flip; the two
per-frame inline-style writers left are the World Watch marquees (`WorldFeed`,
`AutoScroll`), both already on their own layer; and the `clear` frame at
~0.3 ms/frame is the full-canvas `clearRect` on the software 2D canvas
(`Map.clear` is 0.1 µs) — the fixed cost of a viewport-sized label canvas.

Shipped:

- **luma uniform patch** (`lib/luma-uniform-patch.ts`, installed in `Globe.tsx`
  before `new Deck`): `setUniforms` flags a redraw only when `_setUniform`
  recorded a change (`modifiedUniforms`, which `getAllUniforms` clears together
  with the flag at write time). A runtime prototype patch guarded on the 9.3
  method shapes — a different luma leaves the class alone and logs once. jest
  maps `@luma.gl/core` to a verbatim 9.3.5 `UniformBlock` copy
  (`test/mocks/luma.ts`) so both the bug and the fix are tested.
- **LabelGrid without per-frame allocation**: a frame stamp instead of
  `Map.clear()` + regrow, flat rect arrays, inlined cell loops (no closures).
- **Page squares off layout** (`page-dots.ts`, used by `GodsPanelFooter`,
  `WorldReportDeck`, `SlideDeck`): the active square `scaleX`s from its left
  edge, later ones `translateX` by the extra width, the row carries that width
  as slack — same picture, same easing, and a flip no longer lays the page out
  for nine frames.

Next run: expect `getData`, `updateUniformBuffer`, `bufferSubData` and luma's
`bindBuffer` wrapper to fall by well over half (only `project` and animating
`breathe` blocks rewrite), and Layout near zero outside slide swaps. Still open:
ticker windowing (1.6 k nodes — needs a one-time entry-width measurement so the
strip stays continuous); the label canvas in a worker; merging the 3-ring glows
into one banded draw (visual trade-off at joins); luma `_applyBindings` looking
up block indices per draw (~0.25 ms/frame); WeatherLayers' `ensureDefaultProps`
per draw (~0.3 ms/frame + GC).

### Round 18 (2026-09-08) — the frozen frame the profiler finally caught

Round 17 measured: busy 58.0 % (from 58.7 / 56.0) with deck's frame 10 → **7.5 ms**
— `getData` 387 → 97 ms, `bufferSubData` 256 → 135, luma's `bindBuffer` wrapper
(570 ms) gone from the table, `setUniforms` 457 → 204; Layout 37 → 28× per 8 s.
But rAF read 25.8 fps with a **2 467 ms** maximum frame gap, and two new frames
sat at the top of the table: 1 678 + 642 + 88 ms in `lib/high-low.ts` (`boxBlur`,
the extremum scan, `decodeScalar`) — ONE synchronous pressure H / L scan, run
inside Globe's render when the pressure texture changed. The scan was sized for
the 0.25° GFS grid (~30 ms); the pressure bake on air is far finer, and
`smoothRadiusCells`' 12-cell cap meant it under-smoothed it as well. So since
round 12 every new pressure texture — each forecast hour, each new run, each
reload after LRU eviction — froze the broadcast for ~2.4 s, and no earlier 20 s
window happened to overlap one. A regression of this plan's own making.

Also from the trace: the page squares' `transform: none` ↔ transform transitions
created and destroyed paint layers, which Blink lays out for (`layout: style
changed` on exactly those spans).

Shipped:

- **Search grid sized to the radius** (`workGridFactor`: 70 cells per
  separation radius, so 0.25° is unchanged and 0.125° / 0.0625° / 0.05° bakes
  fold 2× / 4× / 5× by NaN-aware block means), with each kept centre **refined**
  back onto the bake's own cells (`refine`: the locally smoothed extremum within
  its work cell and the eight around it, reporting that cell's centre and
  decoded value). Parity test on a 0.05° regional bake: full-grid vs folded
  within one cell and one byte step. Node timing on a 0.125° global grid:
  538 → 165 ms, identical centres and values.
- **Off the main thread**: `lib/high-low.worker.ts` + `high-low-client.ts`
  (one lazy worker; the texture is copied and the copy transferred).
  `layers/high-low-labels.ts` is async — `highLowLabelsFor` (one scan per
  texture + key, joined while in flight), `highLowLabelsReady`, and
  `useHighLowLabels`, which returns the memoised labels synchronously and
  re-renders once when a fresh texture's scan lands. Globe keeps a
  `pressureHighLow` memo and calls the hook. Without Workers the scan is
  deferred out of the render instead.
- **Page squares** carry `translateX(0)` instead of `none`, so their paint
  layer persists and a flip is style + paint only.

Next run: rAF back at ~29.5 fps with the max frame gap down to a texture load,
no `high-low.ts` frames, Layout ≈ slide swaps only. Still open: ticker
windowing (1.6 k nodes; one-time entry-width measurement), the label canvas in
a worker, merging the 3-ring glows (visual trade-off at joins), luma
`_applyBindings` block-index lookups per draw, WeatherLayers' `ensureDefaultProps`
per draw.

### Round 19 (2026-09-09) — what is left, and whose it is

Round 18 measured: busy 58.0 → **53.0 %**, rAF 29.6 fps with the maximum frame
gap 2 467 → **267 ms** (a texture load), no `high-low.ts` frames, Layout 28 →
25× per 8 s and no longer on the page squares. Deck 7.5 ms/frame (unchanged,
31 draws). The per-frame budget now reads: deck ~7.5 ms, the CEF pipeline
~6 ms (Commit 3.2, Layerize 1.5, PrePaint 0.5, style 0.5 — `(program)` at 37 %
of busy is this), the label canvas ~1.7 ms on a 137-label shot, GC 0.55,
React/DOM ~0.5.

`Commit` is now the largest single item and it is not DOM work: with
`--disable-gpu-compositing` cc composites 29 layers of 1920×1080 on the CPU every
frame (and reads the WebGL frame back for it) while the main thread waits at
commit. That is a host setting — OBS's browser-source hardware acceleration —
not something the page can change; round 10's local reproduction with
`--disable-threaded-animation` matched the animation signature, and GPU
compositing is the same switch family. The profiler now reports it (below).

Shipped:

- **Profiler**: `gpuFeaturesOf` opens the browser-level CDP target
  (`/json/version` → `SystemInfo.getInfo`) and prints `gpu features:` (gpu
  compositing, rasterization, 2d canvas, webgl…) and the interesting `browser
  flags:` from CEF's command line — decisive for the pipeline share.
- **Label index** (`indexLabels`): the sorted priority list plus flat
  `Float64Array`s of unit vectors and `minZoom`; the frame loop reads those for
  the cull pass and, because the list is sorted, `break`s at the first label
  above the zoom instead of scanning the tail (~1 000 objects a frame on this
  shot). Same labels, same order.
- **luma update-loop patch** (`patchUniformStore`): `updateUniformBuffers`
  iterates the block map once and writes only flagged blocks — luma's version
  re-fetched block and buffer per block, read the uniforms again for a level-4
  log line and joined reasons for a level-3 one (~0.4 ms/frame across ~120
  block visits now that most have nothing to write). Same writes, same flag
  clearing; shape-guarded like the block patch; the mock carries a verbatim
  `UniformStore` slice.

Next run: read the new `gpu features:` line first. If it says
`gpu_compositing=disabled_software`, the ~6 ms pipeline is the software
compositor, and the host-side lever is OBS → Settings → Advanced → Sources →
"Enable Browser Source Hardware Acceleration" (a restart of OBS / the browser
source) — worth a before/after profile. On our side expect `u`/`place` a touch
lower and `updateUniformBuffer` gone from the table. Still open (trade-offs,
the user's call): ticker windowing, the label canvas in a worker, merging the
3-ring glows, global + nest particles both drawing.

### Round 20 (2026-09-09) — the cut, named

Round 19 measured (`/watch/default`, country spotlight + alerts + volcanoes on
air, 29 draws): busy 59.9 %, rAF **26.5 fps** with p50 33.3 / p95 33.4 ms and a
**833 ms** maximum gap. `gpu features:` now says `gpu_compositing=enabled` —
the host lever took: Commit 3.2 → **1.5 ms/frame**. Steady state holds the 30
fps cap; the fps loss is stalls, and the saved `profile.cpuprofile`
(`scratchpad/stalls.mjs`-style split into busy stretches) names them:

| stall | inside | what |
|---|---|---|
| 822 ms | `setLayers → _initializeLayer → SolidPolygonLayer.updateState → PolygonTesselator` | earcut + globe grid-cut of the 4 MB country outline, **×4** |
| ~500 ms | `(program)` + `_linkShaders/_getLinkStatus` | shader compile + link for the freshly created layers |
| 888 ms | React commit for the cut | 47 ms `haversineKm` from `eventNearbySlideHasContent` (mode-slides memo), 30 ms `measureText` for new label sprites |

Two deck facts explain the first two rows. **GeoJsonLayer always builds its
`polygons-fill` SolidPolygonLayer sublayer** when polygon features exist
(`CompositeLayer.shouldRenderSubLayer` checks only `data.length`; `filled` only
reaches the sublayer's `draw()`), and that sublayer tessellates in
`updateState`. So every stroke-only GeoJsonLayer pays a full earcut for
nothing — the four country-glow rings paid it four times per cut, and the three
alert glow rings tessellate thousands of alert polygons three extra times per
refresh. And the glow layers only existed while a country was on air, so each
cut was a cold `_initializeLayer`; deck released their models on the way out
and luma freed the shared pipelines, hence the re-link.

Shipped:

- **`layers/outline-rings.ts`**: `outlineRings(features)` (every Polygon /
  MultiPolygon ring as `{ path, feature }`, memoised on the features array
  identity — exactly what GeoJsonLayer's own stroke sublayer draws),
  `polygonParts(feature)` for a direct SolidPolygonLayer, shared `NO_RINGS` /
  `NO_PARTS`, and `pickedFeature()` to unwrap a ring pick.
- **Country glow**: the four rings are PathLayers over the rings (no fill
  sublayer, no earcut) and are ALWAYS returned — empty + `visible: false`
  between spotlights — so deck keeps the models and luma the
  PathLayer+Breathe pipeline. A cut now builds four path tessellations of the
  outline (~35 ms each on the profile) and links nothing.
- **Alerts**: `alerts-glow-wide/mid` and `alerts-edge` are PathLayers over
  `outlineRings(features)`; only `alerts-fill` still tessellates. The on-air
  AREA pair is a direct SolidPolygonLayer + PathLayer and is always in the
  stack (`onAirPulseLayers(features, null, …)` = idle, empty, hidden), so a
  polygon cut costs one tessellation of that shape and no shader link. Globe
  commits the idle pair when nothing is on air and unwraps ring picks with
  `pickedFeature` in `onHover` / `onClick`.
- **`geo.nearby`**: `radiusBox` / `withinRadiusBox` pre-cull (latitude from
  the radius, longitude at the box's pole-ward edge, dateline-aware, all
  longitudes once a pole is inside) before any haversine — property-tested
  against the brute-force scan. The mode-slides scan drops from ~15k trig
  calls to a few dozen.

Next run: expect the country-cut gap to read a few hundred ms at most (four
path tessellations + the React commit) instead of ~2.2 s across three stalls,
`getProgramParameter` gone from the busy stretches, and `c`/`u` (haversine /
nearby) gone from the table. Still open: the outline itself (a simplified
boundary for the glow is the only remaining lever on that tessellation — a
visual call), ticker windowing, worker label canvas, glow merge, global + nest
particles both drawing, and the small luma/WL per-draw items
(`_setDebugData`, `ensureDefaultProps`).

**Round 20 measured** (2026-09-09 14:28, `/watch/default`, country spotlight + alerts +
particles on air, 21 draws): busy 59.9 → **53.4 %**, rAF 26.5 → **28.9 fps**, maximum
frame gap 833 → **233 ms**; no PolygonTesselator / `getProgramParameter` / haversine rows
in the table. Census: every glow ring is one PathLayer entry (the `2×` polygons-fill
rows are gone from country-glow and alerts). The first attach of the day sat on a
DEAD `/watch/default` target for 10 s — its id changed by the next run, so an OBS
reset had replaced the page; the profiler now lists every match, tries each with a
timeout and can be pinned with `--target`. Per frame now: deck ~9.6 ms (draw 8.2, of
which ~4.8 is per-draw bookkeeping across 21 draws — luma state tracker/bindings,
deck shader-inputs merge, WL `ensureDefaultProps`+freeze 0.46), CEF pipeline ~5.2 ms
(Layerize 1.5, Commit 1.2, PrePaint 0.6, style 0.5), labels ~0.5, GC 0.55. The window
held no spotlight cut, so the post-fix cut cost is still unmeasured. A 60 s run
(14:42, same page, glow on air throughout a world spin): busy **48.4 %**, 29.6 fps,
max gap **200 ms**, heap 158 MB (57 MB fifteen minutes earlier on the same page —
watch it). Its three longest busy stretches (321 / 307 / 266 ms) are map-type
changes during the spin: `_initializeLayer` of the new raster stack (BitmapLayer
`_createMesh`, WL raster `updateState`, particle `_setupTransformFeedback`) plus a
React commit and GC — no PathTesselator anywhere (PolygonTesselator 2 ms total in
60 s). So the glitch class is gone from a spin; the cut itself still needs a run
with a country cut triggered from /control inside the window. Per frame over the
60 s: deck 7.2 ms (particles 2.2, paths 1.1, solid polygons 0.75, scatter 0.7,
lines 0.6, bitmaps ~1.2), `(program)` 6.1, labels ~1.1 on a 244-label shot, GC 0.4.
The basemap `country-bor` was still a stroke-only GeoJsonLayer (2× row): it
tessellated every country polygon once at page load and drew a no-op each frame.
SHIPPED after the 60 s run: `layers/country-features.ts` fetches + parses
countries.geojson ONCE per page (the borders layer and countryGlow used to each
fetch the 4 MB file) and `countryBorderRings()` hands the borders PathLayer one
page-lifetime promise as `data` (deck compares async props by identity — a fresh
promise per rebuild would refetch and re-tessellate); `countriesLayer` is that
PathLayer (same stroke, no polygons-fill sublayer). Effect: no world-wide earcut on
a cold start (every OBS hard reset), one fetch instead of two, one draw fewer.
Next target by visibility: the map-type change during a spin — the 60 s window's
longest busy stretches (321 / 307 / 266 ms, rAF gap 200 ms) are `_initializeLayer`
of the new raster stack (~80–100 ms: BitmapLayer `_createMesh`, WL raster
`updateState`, particle `_setupTransformFeedback`) + a ~60 ms React commit + ~55 ms
GC + native. Keeping every scalar raster layer mounted (hidden) so a change only
swaps the texture, and looking at what the chrome re-renders on a map-type change,
would take most of it. Draw-count levers left (~0.14 ms each): country glow 4 rings
→ 1 PathLayer with a per-level breathe attribute (−3), alert wide+mid → 1 (−1),
halo+marker pairs (−2).

### Round 21 (2026-09-09) — measured over a minute: the lossless floor

Round 19 measured over 60 s: busy **44.9 %** (from 99 % on 2026-09-07), rAF
29.7 fps, max frame gap 433 ms (a cut), `updateUniformBuffer` gone from the
table (the lean loop `iM` is 0.21 ms/frame, from 0.41). The new `gpu features:`
line settles round 19's question the other way: `gpu_compositing=enabled ·
rasterization=enabled · 2d_canvas=enabled`, CEF launched with `--enable-gpu`
(OBS's browser-source hardware acceleration is already ON). So the ~5–6 ms
per-frame pipeline (Commit ~3 ms, Layerize ~1.5) is CEF's off-screen-rendering
frame path plus its main-thread animation ticking — not a host setting the
page can have flipped. There is no host lever left.

Separately, the parallel session's commits 5d14b17 / 2959772 (2026-09-09)
turned the stroke-only GeoJsonLayers (alert glow rings, country glow rings,
borders) into PathLayers over pre-extracted rings (`outline-rings.ts`,
`country-features.ts`): the census is now 23 primitive / 21 drawn per frame
(from 31), and a cut no longer re-links shaders.

Per-frame budget now (30 fps cap, 33 ms): deck ~7.2 ms (particles 1.7 across
the two wind layers, path strokes 1.1, polygons 0.8, scatter 0.7, bitmaps 0.5,
rasters 0.5, contour 0.3, deck/luma bookkeeping ~1.5 — `setProps`, WL
`ensureDefaultProps`, `bindBuffer`), CEF pipeline ~5–6 ms, label canvas
~1.2 ms on a 138-label shot (`drawImage` 0.65), GC 0.3, style recalc 0.5
(every frame: the crawl, three monitor-row sweeps, two pulses, the alert dot).

Everything lossless that pays more than a tenth of a millisecond has shipped.
What remains is a trade-off menu (the user's call), with estimated returns:

| lever | est. gain | what changes |
|---|---|---|
| label canvas in a worker | ~1.2 ms/f (3–4 pts) on dense shots | labels may trail their dots by one frame during fast pans |
| merge the 3-ring glows into one banded draw (alerts + countries) | ~0.7 ms/f | identical bands; slight difference where rings self-overlap at joins |
| particle counts (or one wind layer under a nest) | up to ~0.8 ms/f | visibly fewer particles |
| ticker crawl windowing (1.6 k nodes → ~200) | ~0.3–0.5 ms/f | none, but needs a one-time entry-width measurement to keep the strip continuous |
| monitor-row sweeps + pulses to canvas | ~0.2–0.4 ms/f | none if drawn faithfully; three small components |

### Round 22 (2026-09-09) — the label canvas's last two levers, and naming a stall

Shipped (lossless):

- **Sprite atlas** (`components/label-atlas.ts`): every label sprite (name,
  detail chip, combined, icon glyph) was its own small `<canvas>` — up to
  4 000 of them — so each of a frame's ~140 `drawImage`s bound a different
  source and nothing batched (0.65 ms/frame, the label canvas's largest cost).
  Sprites are now painted into a few 2048² pages (shelf packing, 1 px gutter,
  integer device-pixel regions → identical pixels), blitted from one source per
  frame. Past three pages the oldest page is retired whole and its sprites
  re-rasterise on demand; an icon whose page retired keeps drawing from it
  until its re-bake lands.
- **Declutter split** (`components/label-declutter.ts` + `.worker.ts` +
  `-client.ts`): the per-frame decision — which labels to draw, in priority
  order, with or without their detail line (view cull, projection, progressive
  reveal, collision grid over the whole zoom-eligible list) — is pure data in,
  pure data out, and runs in a Worker on the PREVIOUS frame's camera. The main
  thread projects only the chosen labels against the CURRENT matrix and blits,
  so positions are exact; a one-frame-old decision only means a label at the
  edge of a collision appears or hides a frame late. Inline fallback for the
  first frame after a rebuild, a busy worker, or no Worker. Expected: `u`,
  `place`, `collides` and the projection frame leave the table (~0.5 ms/frame).
- **Profiler stalls**: `findStalls` splits the profile into stretches with no
  idle sample for ≥ 100 ms (`--stalls N`), each with its own Bottom-Up and the
  deck/React entry points on the stack; `--cpuprofile <file>` re-analyses a
  saved run offline; `--stall-trace` records the timeline trace DURING the
  sampling window (same clock as the profile) and lists, per stall, the
  renderer events — Layout, Paint, Commit, GC, script compiles, JS callbacks by
  name — that made up its native "(program)" time. Re-analysing the 60 s run:
  two stalls, the cut at 3.7 s = 554 ms of which 71 % "(program)" + 17 % GC —
  i.e. not JavaScript, which is exactly what a CPU profile alone can't name
  and the concurrent trace can.

On 60 fps: at 30 fps the page sits at ~45 % busy ≈ 15 ms of main-thread work
per 33 ms frame; the fixed per-frame costs (deck ~7, CEF pipeline ~5–6, labels
~1, GC) are not far from a 16.7 ms budget, so a 60 fps trial will read ~85–95 %
busy and drop frames on every cut. Worth trialling only after the cut stall is
gone — a stall costs twice the frames at 60.

How to capture the cut glitch: `node scripts/profile-watch.mjs
http://localhost:9221 --seconds 60 --deck --stall-trace`, then trigger two or
three cuts / fly-tos from /control during the minute; read the `## Stalls`
section — each stall's Bottom-Up names the JS, its "renderer events" line names
the rest.

### Round 23 (2026-09-09) — the cut, split into its stalls

Round 22 measured over 60 s: busy 44.9 → **42.7 %**, 29.6 fps. The label
canvas's tick frame 0.23 → 0.08 ms/frame, `place` / `collides` gone from the
table (the worker has them), `drawImage` 0.65 → 0.43 ms/frame on a DENSER
last frame (267 blits vs 141) — the atlas roughly tripled blit throughput.

The new `## Stalls` section named the "glitch when translating": not one stall
but a chain — 232, 263, 331, 129 and 190 ms between 1.8 s and 5.6 s, ~1.1 s of
jank across a cut (13 stalls, 2.4 s, over the minute). What they are made of:

- **Alert "near …" lookups on the main thread**: three of the stalls carry
  `nearbyPlaces` → for every alert, quake and volcano in the World Watch feed,
  a fresh `cities.filter(notable)` over the ~15 k-city list and a scan — ~30 ms
  per feed rebuild, and the feed rebuilds whenever its inputs' identities change
  during a cut.
- **BitmapLayer `_createMesh`**: each cut creates fresh raster / contour bitmap
  instances and deck re-tessellates the same bounds at the same resolution
  (~40 ms per cut across the stalls, plus the luma `lerp` inside it).
- **WeatherLayers ParticleLayer `_setupTransformFeedback`**: a new wind layer
  instance (or a `visible` flip — WL tears the transform feedback down when
  hidden and rebuilds it when shown) recreates its particle buffers and links
  the update shader — ~30–60 ms per layer, native "(program)" share included.
  WL-internal; only a kept-alive, visible layer avoids it.
- **"(program)" 60–160 ms stalls** right after the JS ones: the chrome
  re-render's layout / paint and GPU link waits — the `--stall-trace` run names
  these; and `iM` (the luma buffer-write loop) at 49 ms in one stall is
  `bufferSubData` blocking on GPU back-pressure straight after the uploads.

Shipped (lossless):

- **`GeoGrid`** (`lib/geo.ts`): 1° lat/lng buckets over the notable cities,
  built once per city list (`WeakMap`), answering `nearby()` from the buckets
  under the radius box with exactly the same box + haversine test and the same
  ordering (ties in original order — parity-tested against `nearby()` on 4 000
  random cities at seven centres incl. the dateline and both poles).
  `nearbyPlaces` in `broadcast.ts` uses it: a few hundred lookups now touch a
  few hundred cities instead of a few million.
- **BitmapLayer mesh memo** (`lib/bitmap-mesh-patch.ts`, installed with the
  luma patches): `_createMesh` memoised by bounds + resolution (LRU 32), shared
  across instances — the arrays are only read, each instance uploads its own
  GPU buffers. Shape-guarded like the luma patches.

Next run: `--seconds 60 --deck --stall-trace` with two or three manual cuts —
expect the alert-lookup frames (`u`, `b` in the alerts chunk) and `_createMesh`
gone from the stalls, and the "renderer events" line to say what the remaining
"(program)" is (layout/paint of the chrome vs GPU link). Particle re-init is
WeatherLayers' and stays unless the wind layer is kept alive across cuts (the
other session's raster-mounting work is the place for that decision).

### Round 24 (2026-09-09) — the cut comes in pairs; three more named costs

Round 23 measured over 60 s: busy 42.7 → **40.5 %**, 29.7 fps, max frame gap
**200 ms** (from 267–433), stalls 13 → **8** (2 405 → 1 598 ms over the
minute). `_createMesh` is gone from every stall; the feed's alert lookups are
now `GeoGrid.nearby` at 3.6 ms across a stall instead of ~30.

Each cut now shows as a **pair**: a layer-update stall (200–340 ms: GC 23–48 ms,
`getGLKey` 6–25 ms, `_setupTransformFeedback` 7–9 ms, `bufferSubData`,
`_autoUpdater` / `getColor` for the alert attributes) and, ~0.8 s later, a
130–180 ms stall that is **65 % "(program)"** with only 15–24 ms of JS under
rAF. That second one is the chrome's own work after the cut (layout / paint —
the ticker crawl's `entries.map` render and the World Report slide appear in
the JS slice beside it) or a GPU wait; this run had no `--stall-trace`, so it
is still unnamed. The trace run is the next step, unchanged.

Named from this run and shipped (lossless):

- **luma `WebGLDevice.getGLKey`** (`lib/luma-glkey-patch.ts`): names a GL
  constant by walking every property of the WebGL2 context (~900) until one
  matches, and `WEBGLTexture._setSamplerParameters` calls it twice per sampler
  parameter of every new texture — as the argument of a level-2 log line that
  never prints (built before the level check). A cut creates dozens of textures
  (rasters, contour bitmaps, palettes, particle state): 25 ms of one stall.
  Replaced by a value → key table built once per context by the same
  enumeration (UPPER_CASE constants only; a miss falls through to luma's loop),
  so every answer is the original's. Installed off the live device in deck's
  `onDeviceInitialized` (no `@luma.gl/webgl` import), shape-guarded.
- **Ticker flag lookup** (`nearestFlag` in `lib/broadcast.ts`): still a linear
  scan of the ~15 k notable places per alert per crawl build — 3.5–5.7 ms in
  two stalls. Now `GeoGrid.nearest()` (new: `nearby()[0]` without building the
  list, same tie rule, parity-tested) over one grid shared with the World Watch
  feed: `notableCities()` is memoised per input array, so the crawl's subset and
  the feed's key the same `cityGrid`.
- **`utcLabel`** (`lib/manifest.ts`): `Date.toLocaleString(locale, options)`
  constructs an `Intl.DateTimeFormat` per call (~0.2 ms); the map-freshness
  chip derived its two labels on every render of a cut — 5.2 ms of one stall.
  One shared formatter, identical output.

Still in the JS half of a cut: GC (23–48 ms per cut — the layer rebuild's
allocation churn on a 137 MB heap; a retained-size question, not a hot loop),
WeatherLayers' transform-feedback re-init (theirs; only a kept-alive wind layer
avoids it — the other session's raster-mounting decision), and the alert
attribute fills (legit work for new alert geometry).

Next run, please WITH the flag: `--seconds 60 --deck --stall-trace` and two or
three manual cuts. The "renderer events in this window" line under each
"(program)" stall is what decides between chrome layout/paint and a GPU wait.

### Round 25 (2026-09-09) — the trace run: wind barbs, and what "(program)" was

The `--stall-trace` run landed on a heavier scene than rounds 21–24: wind
mode **barbs**, two humidity rasters, 154 labels drawn. Busy **57.7 %**,
27.5 fps, **31 stalls / 17.0 s** of the minute, one of 3.2 s and one of 2.0 s.
The operator's "wind looks slightly off in the output" is this: barbs stutter
and jump through every move. No source change in the last two days touches
barb geometry or colour (checked `layers/index.ts`, `layers/props.ts`,
`Globe.tsx`); the patches of rounds 17–24 alter no vertex, uniform value or
pixel.

What the barbs cost, from the profile — WeatherLayers' `GridLayer` composite:

- **It never caches its grid.** Positions come from an icosphere whose order
  follows the zoom (up to 163 842 points at zoom ≥ 5) and a KDBush over it;
  two module-level Maps are read as caches but nothing writes them. Every
  camera tick rebuilds both: icomesh 1.8 s + kdbush sort 1.6 s + helpers
  0.9 s ≈ **4.3 s of the minute**.
- **It re-samples every visible point every tick.** `shouldUpdateState` fires
  on `viewportChanged`, `_updatePositions` → `_updateFeatures` cubic-samples
  the raster at each visible point (16 texel reads, an array per read):
  `eG`/`eX`/`e1`/`ez`/`eW` ≈ **7 s of the minute**, plus most of the 1.2 s GC.
  Inclusive, `updateState` was 12.0 s — 33.6 % of the main thread — and the
  300–2 000 ms stalls from 7.8 s to 15 s are one fly-to with barbs on.

Shipped (lossless):

- **`lib/wl-grid-positions.ts`**: WeatherLayers' globe grid builder with the
  caches it intended — the same icomesh / kdbush / geokdbush / geodesy-fn calls
  with the same arguments (sphere radius 6 370 972 m, the same edge-pixel
  radius, Float32 KDBush, `around` nearest-first), icosphere and index memoised
  per order. Parity-tested against a brute-force radius filter; the seam
  duplicates WeatherLayers keeps are kept.
- **`lib/wl-grid-patch.ts`**: two prototype patches on the internal composite,
  reached through `GridLayer.renderLayers`. `_updatePositions` takes the
  memoised positions (globe viewports; Mercator falls through). `_updateFeatures`
  keeps a per-layer cache of each point's feature keyed by the point (the
  memoised icosphere hands out the same arrays every tick), emptied when any
  sampling prop changes; only unseen points are sampled — by WeatherLayers'
  own `_updateFeatures` on that subset — so the features are exactly its own,
  in position order, NaN points remembered as absent. A composite whose
  features are not built on their positions hands back for good. Installed
  in `Globe.tsx` with the other patches; jest transforms the four ESM
  packages; the packages are declared at WeatherLayers' own ranges (lockfile
  unchanged).
- **`repPoint` memo** (`layers/alerts.ts`): `onAirFeature` walked every alert's
  geometry for its rep point on each rebuild — 572 ms of the minute.

The trace answered round 24's question. The native share of a stall is
**Layerize** (13–70 ms per stall — CEF's off-screen compositing), GC, and in
the 3.2 s cut stall **Layout 312 ms + Paint 46 ms + a 547 ms React task**
(`FunctionCall O`) with `removeChild` 228 ms: the chrome re-render is the other
half of a cut (the other session's area). Not GPU waits.

Still open from this run: a single **`texSubImage2D` of 382 ms** at 2.3 s (one
synchronous texture upload — a raster or nest image; which one, and whether it
can be split or made async, is the next question); main-thread `getImageData`
169 ms inside the cut = WeatherLayers' `loadTextureData` (our worker-pool
fallback, or WeatherLayers' own loads — check the `[globe]` console line in
CEF); `e.s.r @ 0yj.p.itd4~mp.js` 571 ms unnamed (dotted names miss the
profiler's snippet filter — widen `MANGLED_RE`). `getGLKey` at 2.7 ms in one
stall means the deploy predated round 24.

### Round 26 (2026-09-09) — round 25 measured; the cut's layout, named to the node

Round 25 over 60 s with barbs in the mix: busy 57.7 → **42.9 %**, 29.1 fps,
stalls **31 → 8** (17.0 → 3.1 s of the minute). The grid layer's `updateState`
fell from 12.0 s to **0.35 s** inclusive; what remains of it is one icosphere
build per order (`iN` 15 ms, icomesh 29 ms, kdbush 18 ms in one stall — once,
as intended). The `--stall-trace` invalidation tracking then named the rest of
a cut to the DOM node:

- **Two ~270 ms full-page layouts** (dirty 1 566 of 2 947 objects; 1 673 of
  3 331), each preceded by ~740 "Text changed #text" invalidations and a few
  hundred SPAN adds/removes: the **ticker crawl**. `CrawlContent` keyed its
  entries by index, so one new line at the front rewrote the text of every
  span after it (twice — the crawl is rendered twice for the loop) and Blink
  re-shaped every run of the ~100 000 px line.
- **"Fonts changed" ×211** inside the first of them, with a Saira `.woff2`
  arriving from fonts.gstatic.com mid-cut: Google Fonts serves each weight in
  unicode-range subsets (latin, latin-ext, vietnamese) with `display=swap`, so
  the first cut to show a "Kraków" fetched a subset and invalidated every text
  node of the family.
- **`nearestCityDetails`** (`BroadcastFrame`): with a flight or ship on air,
  every frame render filtered the 15 k cities to the notable subset and ran the
  unbounded linear `nearest()` over it — `e.s.r` 129 ms of the minute (571 ms
  in the barbs run), 17 ms inside the cut.
- Chrome re-render proper (React `O` tasks 43–76 ms, 557 DIV / 322 SPAN / 52
  svg adds in the 48 s cut, `removeChild` 22 ms) — the other session's area.
- One-offs: `getImageData` 124 ms = WeatherLayers decoding its barb icon atlas
  (cached per URL and per device inside WL — first appearance of barbs only);
  `getProgramParameter` 16 ms = a shader link wait for a new pipeline;
  `_setupTransformFeedback` 30 ms = WL particle re-init (unchanged).

Shipped (lossless):

- **Stable crawl keys** (`Ticker.tsx` `entryKeys`): an entry's text (repeats
  suffixed) keys its fragment, so a feed change adds and removes only the
  changed entries' nodes. Test: an entry's DOM node survives an insertion in
  front of it.
- **Font warm-up** (`useFontWarmup.ts`, mounted in `BroadcastFrame`): every
  face of the ramp — Saira 300/400/500/600, JetBrains Mono 400/500 — requested
  once at mount through `document.fonts.load` with a sample spanning the served
  subsets, so no cut ever triggers a font fetch. Same faces render either way.
- **`nearestNotableCity`** (`lib/broadcast.ts`): the moving target's "Nearest
  City" from the shared city grid in widening rings (350 / 1 400 / 5 600 km,
  then the sphere) — a hit inside a ring is the global nearest since everything
  outside is farther; parity-tested against the linear `nearest()` incl. a
  Point-Nemo case and ties.
- Profiler: `MANGLED_RE` accepts dotted short names, so a frame like `e.s.r`
  gets its source snippet next time.

Next run: expect the two ~270 ms layouts to shrink to the changed entries, no
"Fonts changed", and `e.s.r` gone. What is left of a cut is then the chrome
re-render and the GPU-side one-offs (a 382 ms `texSubImage2D` in the barbs run
is still unexplained — which texture, and whether it is the humidity raster's
first upload).

### Round 27 (2026-09-09) — the crawl's size, the barbs proven, the panels' scans

Round 26 measured on a seismic scene (night tiles, geomag, cables, faults, no
weather rasters): busy 51.5 %, 28.3 fps, 28 stalls / 8.0 s. The ticker keys
worked — "Text changed" fell from ~740 to 1 per cut — but the crawl itself
was the layout: a 246 ms one at 0.6 s (1 236 SPANs added at once) and a 154 ms
one at 58.7 s adding **6 898 SPANs** (dirty 13 820 of 14 937 layout objects).
The seismic feed put ~1 700 lines in the crawl, rendered twice; the page ended
at 8 305 DOM nodes and every frame's PrePaint / Layerize paid for them.

**Wind barbs, checked.** "Barbs fucked again" showed the calm glyph (a circle,
WeatherLayers' icon 0 for < ~2.5 m/s) over Tibet at midnight local. A
differential test (`public/scripts/wl-grid-parity.cjs`) drives WeatherLayers'
OWN composite `_updatePositions` / `_updateFeatures` and the patched versions
side by side — the real CJS build, deck's real `_GlobeViewport`, a synthetic
uv image — across 27 camera steps, an image swap and back, nest bounds and a
density change: every position list and all 22 810 features (value +
direction) identical. The patch draws what WeatherLayers draws; the circles
are the data (or the choice of texture the barbs sample — the single-winner
nest rule — which is the same as before the patch).

Shipped (lossless):

- **Windowed crawl** (`crawl-window.ts`, `Ticker.tsx`): only a segment is in
  the DOM — a head (≥ 400 chars, ~a minute) that slides out and a tail that
  keeps the viewport full (measured; grows if short). A segment's track is
  keyed, so the next remounts and restarts at translateX(0) exactly where the
  previous ended (its head is the previous tail; the feed's first entry gets
  the 24 px lead-in and no separator, wherever it falls). Speed is the old
  formula's px/s, estimated from the segment's px-per-character, so short feeds
  still crawl at the floor. Still pure CSS (no rAF). A feed whose *content*
  changes restarts at its first line (the old crawl also jumped, arbitrarily);
  a re-derived array with the same lines — the track feed, every second —
  keeps rolling and keeps its nodes. ~40 spans instead of 6 900.
- **Nearby panels on the city grid** (`nearbyCities`, `nearestCities` in
  `lib/broadcast.ts`): the event, quake-report and volcano panels filtered
  the 15 k cities and scanned them on every render (`e.s.r` 200 ms of the
  minute — the profiler now names it: geo.ts `nearby`). Grid-backed, with the
  panel's own predicate applied to the answer (same set, same order), and the
  quake report's sphere-wide "10 nearest sizeable towns" from widening rings.
  Parity-tested.
- Profiler: `disabled-by-default-v8.compile` in the trace, so a first-time
  code path's lazy compile shows in a stall's renderer events instead of
  hiding in "(program)".

Still open: the slow-frame burst during the night-tile cut (100–430 ms frames
with ~60 % "(program)" INSIDE deck's frame — GPUTask 686 ms in the window,
Layerize 30 ms a frame; the next trace's V8.Compile events will say whether
first-run compiles are part of it); `requestAnimationFrame` itself at 800 ms
of the minute across ~8 per-frame callers (a shared frame hub would be
lossless); the alert fingerprint walk (9 ms per poll).

### Round 28 (2026-09-09) — the crawl fix confirmed live; barbs re-checked under a long run

Round 27's DOM fix landed: this run's page carried 562 DOM nodes, down from
8 305 the round before — the windowed crawl is doing its job in production.
Busy time 42.1 %, 6 stalls totalling 1.5 s (was 8.0 s), 29.6 fps. Nothing new
in the stall list beyond what's already tracked (a `getBoundingClientRect` +
`getImageData` pair in a tile-load stall, `_setupTransformFeedback` in
another — both WeatherLayers-internal / the other session's particle work).

**Wind barbs, re-checked.** "Fucked again after a while... it was working,
[then] displays nowt but artifacts" describes a *degrade-over-time* pattern
the earlier 27-camera-step differential test couldn't have caught — that test
built a fresh composite state per case. `wl-grid-parity.cjs` now also runs a
600-tick stress case on **one persistent composite pair** (the same instance
living the whole time, matching how the real layer id persists for a session):
a seeded pseudo-random camera walk with hard cuts every ~23 ticks, an image
swap every 11 (fhr advance/loop) and a density flip every 17, sweeping every
icosphere order boundary repeatedly. 460 066 feature-list entries compared,
identical to WeatherLayers' own methods at every single tick — no divergence
appears no matter how long the cache lives or how it's disturbed.

That rules out cache corruption in the patch itself. Left unverified (needs
the user's eyes on the live render, not something checkable from here): the
crops show a fixed 40 px `iconSize` (`props.ts` `windBarbPropsFromEntry`,
unchanged since the barbs feature shipped, not touched by the round-25 grid
patch) against a grid that gets finer as you zoom in (WeatherLayers' own
`density + 3` → icosphere order formula, proven byte-identical above) — at
some zoom that's simply more 40 px glyphs than fit without overlapping into a
fuzzy mass. Asked the user to confirm whether that's what "artifacts" means
(overlapping/unreadable, not wrong-shaped) before touching `iconSize`.

### Round 29 (2026-09-09) — wind barbs closed; the mode-slides re-render

A different run, a night-tiles scene: busy 47.8 %, 21 stalls totalling 8.2 s,
28.8 fps, DOM 1 171 nodes. `--deck` census explains a chunk of it: with the
XYZ night-tile overlay active (`basemap.ts` `tileBasemapLayer`, deck's own
`TileLayer`), the visible viewport at this zoom needed ~38 separate
`basemap-tiles-night-*` sublayers (80 layers total incl. sublayers, 75
primitive) — each its own BitmapLayer with its own buffers/texture, so a cut
into this basemap is `bindBuffer` (463 ms self), `useProgram`,
`bindBufferBase`, `getUniformBlockIndex` — classic per-draw-call GL state
cost, multiplied by tile count — plus a single 364 ms `texSubImage2D` upload
in the first stall (the tile textures landing at once on the cut). This is
`TileLayer` working as designed (one BitmapLayer per visible XYZ tile); not
touched this round.

**Wind barbs — closed.** Walked the user through it live: a lone glyph over a
scalar raster ("what I assume is direction placeholders") turned out to be
WeatherLayers' own light-wind icon — confirmed by extracting the actual
built-in `iconAtlas` PNG from the bundle and cropping icons 0–7 (icon 0 =
calm circle; icon 1 = a shaft with one short tick, i.e. exactly the lone mark
photographed). Their next screenshots (Chile/Santiago, a full field of
correctly-rotated barbs) and the follow-up ("now gone back to that part of
world and it's fine") confirm the field renders correctly once the camera
settles — the sparse, lonely-glyph moment is the icosphere grid legitimately
having fewer, wider-spaced points at lower zoom / mid-transition (unchanged
WeatherLayers formula, proven byte-identical in rounds 27–28), not a loading
race needing a background pre-generate as first guessed — the grid already
recomputes fresh every tick (that's what rounds 25/28 made cheap, not
deferred). No code change; iconSize/density tuning stays on the table if the
user wants sparse moments to look fuller, but that would be a deliberate
visual change, not a fix.

**Shipped (lossless).** The night-tiles run's `e.s.r` (self time 315 ms,
present in nearly every stall window) is `lib/geo.ts`'s `nearby()` again —
traced this time to `BroadcastFrame.tsx`'s `modeSlides(onAirSegment, ctx)`
call, made inline in the render body (not memoised — `ctx` carries 40+
fields, several rebuilt as fresh objects every render, so memoising the call
itself risks a stale-dependency bug). Every render re-runs
`eventNearbySlideHasContent` / `volcanoNearbySlideHasContent` (deciding
whether the slide belongs in the deck) AND the slide's own panel
(`EventNearbyPanel` / `VolcanoNearbyPanel`), each asking `nearbyCities` the
SAME (list, point, radius) question. `broadcast.ts` now memoises the scan
itself (`nearbyScan`, WeakMap<cities, Map<"lng,lat,radius", hits>>, capped at
64 entries per list) — `keep` is applied fresh to the cached hits rather than
part of the key, since it's cheap (filters the hits, not the list) and call
sites often pass a fresh closure every render. Parity + cache-hit-counting
tests (spies `GeoGrid.prototype.nearby`: a repeat call or a different `keep`
closure is a hit; a different radius or a different list array is a real
scan).

### Round 30 (2026-09-09) — deck's own tile bounding-box math, unmemoised (investigation only)

A busier scene (geomag + faults + seismic + seismograph stations + cables +
alerts all active, tiles spanning zoom 4 AND 5 at once — a zoom transition
mid-capture): busy 64.2 %, 46 stalls totalling 15.4 s, 27.8 fps. `e.s.r`
(`nearby`) is down to a minor share (1.2 %, ~464 ms) despite the busier
scene — the round-29 scan cache is holding. The new dominant cost, present in
nearly every one of the 46 stalls (7–15 % of each): three `@math.gl/culling`
frames (`0rsgoc26bflf1.js:633:41198/41490/40736`, `si@…:23456`) — Cesium's
oriented-bounding-box-from-points algorithm (mean point, covariance matrix,
Jacobi eigen-decomposition) — over 2 s of self time combined.

Traced it: `@deck.gl/geo-layers`' `TileLayer` (used for the night/satellite/
terrain sharp-tile overlays, `basemap.ts`) selects visible tiles by walking
an OSM quadtree (`tileset-2d/tile-2d-traversal.js`, private `OSMNode` class,
rebuilt `new OSMNode(0,0,0)` from the root on **every call**). On a
`_GlobeViewport` (always, here — never the cheap `WebMercatorViewport` /
`AxisAlignedBoundingBox` branch) `OSMNode.getBoundingVolume` calls
`makeOrientedBoundingBoxFromPoints` fresh for every node it visits, every
time the tileset re-evaluates — which is every frame during any camera
motion (`shouldUpdateState` fires on `viewportChanged`, and a spin/orbit/
fly-to changes the viewport every frame), not just on a cut.

That recompute is provably unnecessary: `GlobeViewport.projectPosition`
(`@deck.gl/core`) is a pure function of `[lng, lat, Z]` alone — no
`this.longitude/latitude/zoom/bearing/pitch` anywhere in it (checked the
source). So a tile's reference-point positions, and therefore its oriented
bounding box, depend ONLY on the tile's own `(x, y, z)` and the elevation
range — never on where the camera is. The exact same OBB gets rebuilt from
scratch, every frame, for every tile node the traversal visits, for the life
of the session.

**Not patched — flagging first.** Every patch shipped so far reached a
class via something PUBLIC (`GridLayer`, `WebGLDevice`, `BitmapLayer`,
`UniformBlock` — import it, mutate `.prototype`). This one doesn't have that
seam: `makeOrientedBoundingBoxFromPoints` is a plain exported *function*, not
a class method — ES/bundler live-binding semantics won't let an outside
module reassign it — and the class actually doing the redundant work
(`OSMNode`) is private to `tile-2d-traversal.js`, never handed out by the
`Tileset2D` class that IS exported. Reaching it would mean either finding an
`OSMNode` instance leaking out somewhere reachable (unconfirmed — `Tileset2D`
maps tile indices to its own `Tile2DHeader` objects, and it's not yet checked
whether those retain the node) or re-implementing the quadtree walk ourselves
— a materially bigger, riskier patch than anything shipped in rounds 17–29.
It's also squarely tile-mounting/raster territory during a camera change,
which may overlap the parallel session's map-type-change work — asked the
user which of us should pick this up before spending more time on it, given
the size of the win if it lands (the dominant cost in nearly every stall this
round) against the size of the risk (an undocumented private class, no
existing shape-guard pattern to lean on).

### Round 31 (2026-09-09) — the tile bounding boxes, patched (and the trap in it)

Ownership settled first: the parallel session (weatherchannel-48) confirmed it
owns none of the deck.gl paths — its scope this session is broadcast chrome
(`LiveAlertPanel`, `lib/broadcast.ts` helpers, a `ResizeObserver` stand-in in
`jest.setup.ts`). So round 30's finding is this session's, and it is now
**shipped**: `lib/tile-obb-patch.ts`, installed in `Globe.tsx` beside the other
four patches.

**The seam round 30 couldn't find.** `OSMNode` is private to
`tile-2d-traversal.js`, but it leaks: `getOSMTileIndices` returns
`root.getSelected()`, which pushes **the nodes themselves**, and `utils.js`
`getTileIndices` hands that array straight back through the PUBLIC
`Tileset2D.prototype.getTileIndices`. So the class is reached exactly the way
the WeatherLayers composite was in round 25 — wrap the public method, take
`.constructor` off the first result, patch that prototype. No re-implementation
of the quadtree walk, no reassigning a module-level function binding. The
wrapper then restores the original method, so nothing of it survives past the
first geospatial result.

**The trap: the projection is a per-frame object.** Round 30 checked that
`GlobeViewport.projectPosition` is pure — it is, a class-body method whose body
reads no `this` at all (deck calls it UNBOUND, which under ESM strict mode is
the proof: any `this` access would already throw). What round 30 did NOT check
is its *identity*. `Viewport`'s constructor runs
`this.projectPosition = this.projectPosition.bind(this)` (`viewports/viewport.js:63`),
so every viewport hands out its own bound copy — and deck builds a new viewport
every frame the camera moves. The first cut of this patch keyed its cache on
that function object and was therefore a **silent no-op**: a fresh table every
frame, 0.0 % hit rate, and ~4 % SLOWER than not patching for the churn. It
passed every unit test, because a test naturally reuses one projection.

The fix is to key on what the projection DOES, not which object it is: a bound
copy is fingerprinted once against four sample points and the volumes live
under that fingerprint, the fingerprint held in a `WeakMap` so it dies with its
viewport. One WeakMap miss per frame, four projection calls, then every node
lookup hits the shared table. A genuinely different projection fingerprints
differently and gets its own volumes; anything that isn't a projection
(non-finite, too short, throws) is never cached and passes straight through.

**Measured, against the real classes.** The unit tests can't catch an identity
bug, so the patch was also driven end-to-end in node against deck 9.3.5's real
`Tileset2D` and a real `_GlobeViewport` — 240-frame camera walks in three
regimes, tile selection compared with the cache off and on:

| regime (240 frames)          | traversal off | on   | OBBs asked | computed | hit rate |
|------------------------------|---------------|------|------------|----------|----------|
| slow spin (0.1°/frame, z4)   | 568 ms        | 27 ms| 73 140     | 329      | 99.6 %   |
| idle orbit (0.05°/frame, z5) | 673 ms        | 29 ms| 86 848     | 393      | 99.5 %   |
| fly-to (fast, zoom ramp)     | 369 ms        | 22 ms| 47 732     | 809      | 98.3 %   |

Those are single COLD passes from an empty cache — the hit rate is already
98–99 % within one sweep, because consecutive frames revisit the same tiles;
a warmed cache lands at 99.9 %. **Zero mismatched frames in all three
regimes**: the same tiles, in the same order, every frame. That last line is
the one that matters — the win is worthless if a tile ever goes missing.

**Guarded by behaviour, not by reading the source.** The other four patches
sniff the method's text, which is all you can do when what you depend on is a
shape. Here everything the cache assumes is *checkable*, so the guard runs the
real method against bare `{x, y, z}` probe nodes and requires it to be finite,
to repeat itself, to ignore `worldOffset` on that branch, and to actually vary
with the tile and with the elevation range. Probing with a node carrying
nothing but coordinates is what proves it reads nothing else off the node:
anything it expected to find there comes back `undefined` and the volume stops
being finite. A deck that fails any of those keeps its own method and logs one
line. (The guard earned its keep immediately — it correctly rejected the
counter wrapper the measurement harness tried to install underneath it.)

Only the custom-projection branch is cached; the Web Mercator branch builds a
cheap `AxisAlignedBoundingBox` and genuinely does depend on `worldOffset`, so
it hands straight back to the original. Volumes are shared between frames,
which is safe because they are read-only downstream —
`CullingVolume.computeVisibility` only calls `intersectPlane` (reads
centre/half-axes) and `distanceSquaredTo` works in module-level scratch
vectors. 32 768 entries then start over (the `wl-grid-patch` rule).

18 tests (`lib/tile-obb-patch.test.ts`), including a parity suite running deck
9.3.5's `getBoundingVolume` verbatim over the real `@math.gl/culling` across
the 11-, 9- and 5-reference-point tiers, and a regression test for the bound-
copy bug above. Suite green: 194 files, 1 464 tests. `tsc --noEmit` clean,
`next build` clean (jest mocks `@deck.gl/geo-layers`, so the build is what
actually exercises the real `_Tileset2D` import).

Not yet measured on the box — this session has no way to profile it (port 9221
is the user's own SSH forward, off-limits from here). Next run to confirm:

    node scripts/profile-watch.mjs http://localhost:9221 --seconds 60 --deck --stall-trace

with a couple of manual cuts and a spin or fly-to over a night-tiles or
satellite-tiles scene — the tile overlays are the only layers that walk the
quadtree. What should be gone from the Bottom-Up table: the three
`@math.gl/culling` frames (Cesium's mean-point / covariance / Jacobi
eigen-decomposition), round 30's 7–15 % of every stall. What should be
unchanged: which tiles are on screen. If a tile ever fails to appear, or one
appears that shouldn't, this patch is the first suspect —
`installTileObbPatch()` in `Globe.tsx` is one line to comment out for an A/B.

### Round 32 (2026-09-09) — two runs; the tile patch is still unverified, and the raster upload is named

Two 60 s `--deck --stall-trace` runs on `/watch/default`.

| run              | busy   | fps  | max gap | stalls        | DOM | heap   | scene (drawn)                                                      |
|------------------|--------|------|---------|---------------|-----|--------|--------------------------------------------------------------------|
| 22:24 (raster)   | 49.2 % | 28.6 | 400 ms  | 29 / 7 228 ms | 781 | 148 MB | humidity ×2 + wind + alerts (glow/fill/edge) + country glow, 21 drawn |
| 22:28 (light)    | 35.5 % | 29.7 | 200 ms  | 6 / 1 253 ms  | 532 | 125 MB | elevation relief + contours + faults + volcanoes + cities, 11 drawn  |

**The 22:28 run is the best figure of the whole investigation** — 35.5 % busy
against the 44.9 % "lossless floor" of round 21, 29.7 fps, max frame gap down to
the 200 ms floor, six stalls totalling 1.25 s of the minute. No regression from
round 31 anywhere.

**Neither run contained round 31's patch at all, so it remains unverified —
and these numbers are a clean pre-patch baseline, not a result.** The last
commit at the time of both captures was 84e0534 (21:49); every change of the
session — `tile-obb-patch.ts`, its install line in `Globe.tsx`, the texture-size
log — was working-tree only, uncommitted and undeployed, and the captures point
at production. Nothing tonight was in the build under test. (The same is true of
the parallel session's `FittedColumn` read-back fix, which is why the layout pair
below still appears.)

Two things would have had to be true for a run to verify the patch, and NEITHER
was: the build must contain it, and the scene must mount a `TileLayer`. The
three `@math.gl/culling` frames are absent from both tables, which proves
nothing on either count. The census is the tell for the second: both runs show
`basemap-bg` + `basemap-lan` (the flat land basemap) and no `basemap-tiles-*`
sublayers at all, where round 29's night run carried ~38. Tiles mount only when
the basemap is **satellite, terrain or night** AND the camera is at **zoom ≥ 4**
(`TILE_MIN_ZOOM`, `layers/basemap.ts` `tilesActive`). Round 30's measurement came
from a scene with tiles spanning zoom 4 and 5 at once; that is the scene to
re-run, on a build that has the patch in it. Confirming the patch also means
confirming the tiles still APPEAR — a cache that culled wrongly would show up as
missing tiles, not as a slow frame.

To make that self-reporting rather than inferred, the patch now prints one line
when it engages: `[globe] deck tile bounding-volume cache active` (or the
shape-changed line if the guard rejects). On a tile-less scene NEITHER line
appears, which distinguishes "not patched" from "never ran" without reading a
census. Like the texture-size line, it only exists after a deploy.

**Named from the raster run — the biggest single stall cause left.** Its two
worst stalls are one synchronous texture upload each, with almost no JS beside
them: 428 ms at 2.4 s that is **85.7 % `texSubImage2D` (368.8 ms)**, and 580 ms
at 24.7 s that is **68.2 % (399.2 ms)**; 1 183 ms of `texSubImage2D` over the
minute. This is round 25's deferred item, now clearly the top remaining glitch
on raster-heavy scenes. The light run, with no big raster landing, has none of
it. A global GFS frame is 1440×721 RGBA ≈ 4 MB and should upload in single-digit
ms, so what is actually being uploaded is the question — and neither a CPU
profile nor a trace carries a texture's dimensions. `lib/textures.ts` now logs
one `[globe] texture <name> <w>×<h> <n> MB` line per newly decoded URL (textures
are immutable per URL and cached, so it is one line per distinct texture, not per
frame). Read it off the CEF console on the next run and the culprit names itself.

**Also named, not yet touched:**

- **deck's polygon cut-by-grid**, the 406 ms stall at 7.5 s of the raster run:
  34 % `C @ 03kjcxsx1gsgx.js:148:27870` (139 ms) plus `v` (27 ms), with
  `normalizeGeometry` 197 ms and `m` 188 ms over the minute — deck re-normalising
  and cutting path/polygon geometry on a layer update (`setLayers` 258 ms on the
  stack). Round 20's `outlineRings` memo fixed the DATA side; this is deck
  re-tessellating it per new layer instance.
- **WeatherLayers `ensureDefaultProps`** (`eO @ 03kjcxsx1gsgx.js:906:18139`,
  the `for (let n in e) if (undefined === e[n] && n in t)` filler): 474 ms self in
  the light run (2.1 % of busy), 216 ms in the raster run, called per draw under
  the particle layer's `draw`. Flagged back in round 20 and still there. It is a
  module-private function, so it has the same live-binding problem round 30 hit —
  no obvious seam yet.
- **The chrome's layout pair**, `getBoundingClientRect` + `removeChild`, in two
  of the light run's six stalls (30 ms / 24 ms of `getBoundingClientRect`, Layout
  26 ms / 19 ms, `FunctionCall O` 102 ms / 76 ms). This is exactly what the
  parallel session predicted when it made the alert card size to its content:
  `FittedColumn` re-fits on every child resize and the card's height now changes
  as it cycles alerts every 10 s. Theirs, and they have been told it showed up.
- `_setupTransformFeedback` (WeatherLayers particle re-init) in three of the
  light run's six stalls — unchanged, WeatherLayers' own.

Next run, to close round 31: switch the scene to a **night or satellite basemap
at zoom ≥ 4** and spin or fly over it, then

    node scripts/profile-watch.mjs http://localhost:9221 --seconds 60 --deck --stall-trace

Expect `basemap-tiles-*` sublayers in the census (proof the path is live), the
three `@math.gl/culling` frames absent from the Bottom-Up table, and the tiles
looking exactly as they did before.

### Round 33 (2026-09-09) — third run, the changed mode: a healthy raster scene

Same build as round 32 (still 84e0534; nothing from this session is committed or
deployed), a different on-air mode: storm raster + pressure contours + wind
particles + the four alert layers + on-air ping, 19 top-level layers, 13 drawn.

| run                    | busy   | fps  | max gap | stalls        | DOM   |
|------------------------|--------|------|---------|---------------|-------|
| 22:24 raster (r32)     | 49.2 % | 28.6 | 400 ms  | 29 / 7 228 ms | 781   |
| 22:28 light (r32)      | 35.5 % | 29.7 | 200 ms  | 6 / 1 253 ms  | 532   |
| **22:39 storm (r33)**  | **36.3 %** | **29.7** | **200 ms** | **6 / 1 030 ms** | 1 218 |

This is the important comparison: a scene with a scalar raster, contours, wind
particles AND alerts now costs what the near-empty elevation scene cost — 36.3 %
against the 49.2 % of the earlier raster run, six stalls instead of 29, one
second of stall in the minute instead of 7.2, and the frame gap pinned to the
200 ms floor. Whatever changed about the mode, this is the healthiest raster
scene measured in the whole investigation.

**`texSubImage2D` is completely absent from this run.** Round 32's two ~400 ms
uploads did not recur, on a scene that also carries a global scalar raster. So
they are not a steady-state cost of having a raster on screen; they are one
texture LANDING — a map-type change or a forecast-hour advance bringing a new
image in. That narrows what the round-32 texture-size log has to catch: watch
the `[globe] texture …` lines at the moment of a map-type cut, not at rest.

**Still no `basemap-tiles-*` sublayers**, so this run does not exercise round 31
either — and could not have, since the patch is not in the deployed build. Three
runs, three tile-less scenes. Nothing about the tile path has been measured since
round 30.

**New, and the biggest nameable JS cost here: deck's attribute updates.**
`_normalizeValue` (`0~1yz86pm33zq.js:1:22381`) is 579.7 ms self, third in the
table behind `(program)` and rAF, and the subtree around it is large —
`setLayers` / `updateLayers` 2 988 ms inclusive (13.2 %),
`_updateSublayersRecursively` 2 601 ms (11.5 %), `_updateAttributes` 1 700 ms
(7.5 %), `_updateAttribute` 1 288 ms, `updateBuffer` 998 ms. The light run's
`setLayers` was 2.6 % inclusive, so this is five times the layer-update churn for
a scene that is not five times bigger. The suspects are the four alert layers
over dissolved, country-sized polygons (`alerts-glow-wi`, `alerts-glow-mi`,
`alerts-fill`, `alerts-e`) having their attributes regenerated: normalisation
cost scales with vertex count, and those are the highest-vertex layers on screen.
Not yet traced to a specific trigger — that is the next question, and the way in
is which accessor's `updateTriggers` is moving.

**Read correctly, not a regression:** the 112 ms stall at 7.3 s is
`eo @ …906:9443` (icomesh's `icosphere(order)`), `e @ …906:13159` (the KDBush
sort), `c @ …906:9908` (icomesh's midpoint cache) and `iN @ …515:30703` — which
is OUR `wl-grid-positions.ts` memo taking a miss. The grid is memoised PER
ICOSPHERE ORDER, so a zoom that crosses an order boundary legitimately builds
one new grid, once. That is the round-25 patch working as designed, not the
uncached rebuild-every-tick it replaced.

Unchanged and expected: `getBoundingClientRect` (45.1 ms in the 40.0 s stall,
13.9 ms at 22.2 s) is the `FittedColumn` read-back — the parallel session's fix
for it is also uncommitted, so it is still in the running build.
`_setupTransformFeedback` at 22.2 s is WeatherLayers' particle re-init.
`eO` (WeatherLayers `ensureDefaultProps`, per draw) holds at 429.5 ms and
`e.s.r` (`geo.ts` `nearby`) at 379.4 ms, both in line with rounds 30–32 — the
round-29 scan cache is still holding.

### Round 34 (2026-09-09) — first runs on the deployed build; the stress test moves the cut cost to React

The deploy landed (every script hash in the report changed), so these three
runs DO carry rounds 31–32 and the parallel session's `FittedColumn` fix. The
third was the operator deliberately stressing it, hard-cutting **global →
alerts only**, repeatedly.

| run                       | busy   | fps  | max gap    | stalls         | scene                                   |
|---------------------------|--------|------|------------|----------------|-----------------------------------------|
| 22:48 temp                | 38.6 % | 29.6 | 267 ms     | 9 / 1 879 ms   | temp raster + icon atlas + contours + wind |
| 22:50 humidity            | 35.3 % | 29.7 | **167 ms** | 7 / 1 240 ms   | humidity ×2 + contours + wind + 4 alert layers |
| **22:5x stress (cuts)**   | 38.8 % | 27.7 | **1 333 ms** | **15 / 6 242 ms** | repeated global → alerts-only cuts    |

The 22:50 run has the lowest maximum frame gap ever recorded here, 167 ms.
Steady state is in good shape. **The cut is not.**

**Under repeated cuts the cost is no longer deck — it is React tearing down and
rebuilding DOM.** The stress run's top self-time entries after `(program)`:

| frame                                   | self      | share |
|-----------------------------------------|-----------|-------|
| `i7 @ 0yz5czvwbmzx8.js:1:116427` (React)| 2 078 ms  | 8.6 % |
| `removeChild`                           | 1 638 ms  | 6.8 % |
| `tE` (React set style)                  | 414 ms    | 1.7 % |
| `tS` (React set text) + `set nodeValue` | 687 ms    | 2.8 % |

That is ~4.8 s of the minute in React DOM mutation, and React
(`0yz5czvwbmzx8.js`) is the second-heaviest script in the run at 14.1 % self,
ahead of every deck and luma bundle. deck's share FALLS in the same run —
`setLayers` 5.3 % inclusive against 10.6 % on the humidity run, `_drawLayers`
21.8 % against 30.1 %. The first stall, 328 ms at 0.5 s, is 44.5 % `i7` plus
32.3 % `removeChild` under a single 283 ms React task.

So a mode change is now dominated by unmounting one chrome and mounting
another, not by rebuilding the globe's layers. `removeChild` at 1.6 s of a
minute is a whole-subtree teardown repeated per cut — the left-column deck
(`modeSlides` → `SlideDeck` → `BroadcastCard`) is the obvious candidate, since
switching global → alerts replaces the entire slide set. Not yet traced to the
component; the way in is a `--dom-census` on the stress pattern, and the fix
shape is almost certainly keying the cards so a mode change re-props the same
elements instead of destroying and recreating them.

**Round 31 is STILL unverified.** Neither the temp nor the humidity run mounted
a tile layer (no `basemap-tiles-*` in either census). Four rounds, no tile scene.

**Fixed the reason that keeps happening.** The `[globe]` lines that say whether
a patch went live, and what each texture decoded to, are written once at page
load; CDP can only subscribe to FUTURE console messages, and the profiler
attaches to a browser source that has been up for hours, so those lines had
always already scrolled past. They now go to a ring buffer on `window.__godsLog`
(`lib/globe-log.ts`, the `__godsDeck` / `__godsLabels` pattern) and
`profile-watch.mjs` prints them as a `## globe log` section — patch lines
verbatim, textures grouped by grid, biggest first. From the next deploy on, every
report answers "is the tile cache live?" and "how big is the texture behind the
368 ms upload?" on its own.

**Also seen:** `getImageData` 132.7 ms inside the 457 ms stall of the temp run,
alongside `Decode Image` in the renderer events — a WeatherLayers icon-atlas
decode on the main thread as `scalar-temp-0-icon-global-bitmap` mounts, one-off
per atlas (round 26 saw the same shape for the barb atlas).
`getBoundingClientRect` is still 149–203 ms per run and still in several stalls
DESPITE the `FittedColumn` fix being deployed — with `get clientHeight` beside
it and `(anonymous) @ 00rla3zhuv_os.js:2:2896` (a `clientWidth` read in a
marquee/crawl effect) in the stall windows, so at least part of the remaining
layout read is the ticker's own measurement, not the alert column. Worth a
`--dom-census` before attributing it.

### Round 35 (2026-09-10) — trading RAM for CPU and disk

The box: **32 GB of RAM, and 3–4 browser sources max the CPU out.** So RAM is
the plentiful resource and CPU/disk are what limit how many streams run. Every
re-fetch and re-decode of a texture we already had is the expensive kind of
miss; holding it is the cheap kind of cost.

- **Nests are preloaded now, not just base maps.** `Globe.tsx` already warmed
  every variable's global base map at the active hour, but a variable's REGIONAL
  NESTS were left to load on demand — so flying into a region with a high-res
  nest paid a fetch + decode at the cut, the exact disk and CPU the box can
  least afford at the exact moment it can least afford them. New pure helper
  `allTextureUrlsFor(manifest, fhr)` (`layers/props.ts`) collects every base map
  AND every nest, falling back to the hour-0 texture for statics baked once
  (elevation), deduped. Tested.
- **Texture cache 96 → 256**, overridable at build time with
  `NEXT_PUBLIC_TEXTURE_CACHE_MAX` (`cacheMaxFrom`, tested). The warm set above
  alone can approach the old cap and would have thrashed against it. A decoded
  global 0.25° frame is ~4 MB, so 256 is ~1 GB worst case per source and ~4 GB
  across four.
- **A manifest poll backstop.** The operator's warning — "don't want to be stuck
  on the time of the start" — is a real hole: the manifest was refetched ONLY on
  a `WEATHER_RUN` socket event, so a single missed event (socket drop, a publish
  landing during a reconnect) left a 24/7 broadcast on the maps it loaded at
  start-up for the rest of the day, with nothing to recover it. Both watch pages
  now also poll every `MANIFEST_POLL_MS` (5 min, `lib/manifest.ts`), failing
  soft. Note this makes the bigger cache safe in the other direction too: texture
  URLs carry a bake stamp, so a new run means new URLs — old-run textures age out
  of the LRU rather than ever being shown.

### Round 36 (2026-09-10) — the wind barbs: a units red herring, and an A/B switch

The operator sent a screenshot of barbs over a **DAMAGING WIND** warning showing
**bare circles and single half-barbs** — WeatherLayers' calm and light-wind
glyphs — where the field should be strong. Their description: "on a new area or
zoom it seems to have circle glyphs with a line pointing in a direction."

**The obvious cause is wrong.** m/s read as knots would produce exactly this
picture, and `props.ts` even said the atlas "iconBounds span 0–100 kt", which
reads like an instruction to convert. Checked the bundle before touching it:
WeatherLayers declares `iconBounds: [0, 51.444]`, and **51.444 m/s IS 100 kt**.
The atlas wants metres per second, which is what the GFS u/v textures already
decode to. Scaling by 1.94 would have made every barb on air almost twice too
strong. The comment is now corrected to say so explicitly, with the date and the
reason, so the next reader doesn't "fix" it either.

So the glyph choice is right and the **sampled values** are what look wrong.
Our round-25 grid patch is the only thing standing between WeatherLayers'
sampling and the draw, and rounds 27–28 proved it byte-identical to
WeatherLayers' own methods across 460 k feature entries and a 600-tick stress —
but those tests drove prop changes the test itself controlled, which is exactly
the class of bug a live nest switch or mid-flight zoom could sit outside.

**Shipped an A/B rather than a guess**: `?nogrid=1` on the /watch URL skips
`installGridPatch()` entirely (`gridPatchDisabled`, tested), leaving
WeatherLayers' own uncached sampling. No rebuild to flip it — change the OBS
browser source URL and reload. Both paths now announce themselves in the globe
log ("grid caches active" / "DISABLED by ?nogrid"), so a profile says which ran.
If the circles survive `?nogrid=1`, the cause is upstream of us — WeatherLayers'
sampling or the baked texture — and the patch is exonerated. If they vanish, the
cache is serving stale or absent features and round 28's stress test needs a
case it doesn't have.

### Round 37 (2026-09-10) — the A/B the operator can actually reach, and naming the run on air

Two corrections to round 36, both from the operator.

**The `?nogrid=1` URL flag is useless to them.** The OBS browser sources on the
encoder host are created from the stream config, not by hand — "i cant its no ui
obs". What they DO have is `.env.deploy`, which the deploy syncs. So the A/B is
now primarily an env lever: **`NEXT_PUBLIC_WL_GRID_PATCH=off`** disables the
round-25 grid sampling cache for every source at once (the URL flag still works
for a one-off). Both paths announce themselves in the globe log, so a profile
says which ran. Lesson worth keeping: a debug switch the operator cannot reach
is not a debug switch.

**"maybe magnitude * a day or 2" — a second hypothesis that needs no bug at
all.** The barbs may be faithfully drawing a run that is a day or two stale while
the alert polygon beside them is current. That fits "fine mostly, wrong in a new
area" exactly as well as a sampling bug does, and nothing in a screenshot or a
CPU profile separates them. `manifestLogLine` (`lib/manifest.ts`, tested) now
writes one line on every manifest/fhr change:

    [globe] manifest gfs run=2026-09-10T06:00:00Z (3h ago) steps=41 fhr=0

Run age in **hours** means the wind is current and the sampling is suspect. Run
age in **days** means the wind is stale and the pipeline is — and the client half
of that is already covered by round 35's `MANIFEST_POLL_MS` backstop, so a days-old
run would point at the worker, not the page.

**Unrelated red tree, fixed.** Mid-round the suite went red: a third session had
added `QUAKE_LIVE_WINDOW_HOURS` / `quakeLiveWindowSince` to `shared/src/seismic.ts`
and used them from public and worker WITHOUT rebuilding `shared/dist` — public
failed typecheck on two missing exports, the worker director suite failed nine
tests. `./update-shared` (the documented step for exactly that symptom) fixed it.
All four packages green: **1 483 tests**, typecheck and production build clean.

### Round 38 (2026-09-10) — the A/B answered, and the texture log names the upload

`NEXT_PUBLIC_WL_GRID_PATCH=off` shipped and confirmed live
(`[globe] WeatherLayers grid caches DISABLED`). Two 60 s runs on it.

**Verdict: the grid cache is exonerated, and it must go straight back on.**
Without it a minute carries **14.6 s of stalls** — a 5 493 ms freeze, a 3 196 ms,
a 1 833 ms, a 997 ms — and the second run 22 stalls / 6.7 s at 43.3 % busy. The
frames inside them are exactly round 25's pathology, restored: `eo` (icomesh
`icosphere(order)`) 977 ms in one stall, the KDBush sort `e` 950 ms beside it,
`c` (icomesh's midpoint cache) and the `ej`/`eK`/`eH` vector helpers under
`updateState` 6 260 ms inclusive and `_updateFeatures` 5 213 ms (19.4 %). The
icosphere and its index are being rebuilt on every camera tick again. Flag
removed from `.env.deploy` with the result recorded beside it.

So the calm-looking barbs are NOT our sampling cache. Two hypotheses remain, and
the same run's globe log speaks to the second.

**The texture log named the 368 ms `texSubImage2D` — and it is much worse than
assumed.** Decoded sizes this session:

| grid        | size    | count |
|-------------|---------|-------|
| 4500×2250   | 38.6 MB | ×6    |
| 4979×1913   | 36.3 MB | ×5    |
| 3500×1750   | 23.4 MB | ×3    |
| 2801×1791   | 19.1 MB | ×3    |
| 1440×721    | 4.0 MB  | ×15   |
| 241×151     | 0.1 MB  | ×1    |

~900 MB across ~100 textures, a **400× spread** between largest and smallest. A
38.6 MB upload IS the 368–399 ms stall. Round 32 guessed "a global GFS frame is
~4 MB and should upload in single-digit ms" — true of the 1440×721 ones, and
irrelevant, because the ones that stall are ten times that.

**Which makes round 35's cache cap wrong.** Bounding a cache by ENTRY COUNT when
entries span 0.1–38.6 MB is not a memory bound at all: 256 small ones is 1 GB,
256 large ones is 10 GB. `textures.ts` now bounds by **bytes as well as count** —
`NEXT_PUBLIC_TEXTURE_CACHE_MB`, default 1536 MB per browser source, with each
entry's real weight recorded as it resolves. Tested.

**The stale-hour hypothesis got sharper, not weaker.** The log says
`manifest composite run=2026-09-09T18:00:00.000Z (5h ago) steps=51 fhr=0` — and
`fhr: 0` is the shipped default in `shared/control.ts` with **no
nearest-hour-to-now selection anywhere in the codebase**. So the globe always
draws the run's ANALYSIS hour, which drifts up to ~6 h behind wall clock before
the next run lands. A damaging-wind warning issued in the last hour is being
drawn over a wind field from six hours earlier. That alone can produce calm
barbs under a live warning, with nothing wrong in the sampling at all. Picking
the step nearest to now is a product decision, not a bug fix, so it is flagged
rather than changed.

### Round 39 (2026-09-10) — cache restored: the A/B's other half

Rebuilt with `NEXT_PUBLIC_WL_GRID_PATCH` unset (`[globe] WeatherLayers grid
caches active`). Two runs, and they close round 38's experiment from the other
side.

| grid cache | busy   | fps  | max gap | stalls           |
|------------|--------|------|---------|------------------|
| **off**    | 43.3 % | 29.3 | 367 ms  | 14 / **14 655 ms**, 22 / 6 681 ms |
| **on**     | 36.2 % | 29.5 | 400 ms  | 12 / **2 222 ms**, 8 / **1 780 ms** |

Stalls fall by ~7× and the icomesh/KDBush frames (`eo`, `e`, `c`) leave the top
of the table entirely. Round 25's patch is worth what it claimed, the flag is
out of `.env.deploy`, and the wind sampling cache is definitively not the cause
of the calm barbs.

**The preloading landed too.** `texSubImage2D` in this run's stalls is 72 ms and
40 ms, against the 368 ms and 399 ms of round 32 — the base-plus-nest warm set
(round 35) means a cut now finds its texture decoded instead of fetching and
uploading one 38.6 MB image mid-frame.

**What is now the biggest single stall, and why it is honest work.** The 685 ms
stall at 9.7 s is deck's polygon path: `C` (cut-by-grid) 173 ms, earcut
underneath it, `v`/`nU` beside it, and 94 ms of GC — under `setLayers` /
`_updateSublayersRecursively`, i.e. a layer update. Checked whether it was
avoidable churn and it is not: `alerts-overlay.ts` already fingerprints each
poll and only calls `setFeatures` when the set actually changed;
`layers/alerts.ts` already passes `features` straight through as `data`, already
draws all three glow passes as PathLayers over memoised `outlineRings`, and its
own comment already notes that `alerts-fill` is the one remaining tessellation.
So this is one genuine re-tessellation of the dissolved, country-sized alert
polygons when the alert set really changes. Making it cheaper means fewer
vertices (simplify at the worker, a visual change) rather than fewer
tessellations.

Still present, unchanged and each small: `eO` (WeatherLayers
`ensureDefaultProps`, per draw) 395 ms; `getBoundingClientRect` + `get
clientHeight` 120 ms in two stalls; `_setupTransformFeedback` on cuts;
`e.s.r` (`geo.ts` `nearby`) 255 ms.

**The wind is unchanged and still points at the hour.** Both runs:
`run=2026-09-09T18:00:00.000Z (6h ago) steps=51 fhr=0`. Six hours of drift
between the field on screen and the alerts drawn over it.

### Round 40 (2026-09-10) — the floor, so far

The 00:02 run is the healthiest measurement of the whole investigation:

| metric              | 2026-09-07 baseline | round 21 "floor" | round 32 best | **round 40** |
|---------------------|---------------------|------------------|---------------|--------------|
| main thread busy    | 99 %                | 44.9 %           | 35.5 %        | 38.0 %       |
| rAF                 | 16 fps              | 29.6             | 29.7          | **29.8**     |
| max frame gap       | —                   | —                | 167 ms        | **200 ms**   |
| stalls in the minute| —                   | —                | 7 / 1 240 ms  | **4 / 828 ms** |

Stall time is the lowest recorded — 1.3 % of the minute, against 8.0 s in round
27 and 14.7 s with the grid cache off two hours ago. Busy sits slightly above
round 32's record on a heavier scene (two wind layers, temp raster + icon
overlay, pressure contours). The label canvas is now skipping 2 895 of 7 134
frames as unchanged.

**What the four remaining stalls are made of**, and how little of it is ours:

- 275 ms at 19.8 s — GC 44 ms, WeatherLayers' `_setupTransformFeedback` 33 ms
  (its particle re-init on a cut, theirs), `bufferSubData`, plus the chrome's
  `getBoundingClientRect` 22 ms.
- 284 ms at 43.9 s — 29 % `(program)`, `Layout` 58 ms in the renderer events,
  `getBoundingClientRect` 22 ms and `get clientHeight` 6 ms. A chrome layout
  stall, and the last clearly-actionable one that belongs to us: the parallel
  session traced it to `Ticker`'s `useLayoutEffect` depending on the `entries`
  ARRAY IDENTITY rather than on the crawl text, so the dead-reckoned track feed
  re-runs it about once a second and it does two `getBoundingClientRect` reads
  plus a `clientWidth` read each time. Keying that effect on the rendered text
  is the fix. Not done: it changes an on-air crawl and wants a visual check.
- 165 ms at 4.7 s — the mode-slides work (`eventNearbySlideHasContent` /
  `nearbyCities`) plus React `removeChild`.
- 105 ms at 54.4 s — 31 % GC, 21 % `(program)`. Nothing to take.

Steady-state costs, all small and mostly not ours: `_updateCache` (luma's WebGL
state tracker) 566 ms, `_normalizeValue` (deck attribute normalisation) 508 ms,
`drawImage` (label canvas blits) 591 ms, `iP` (our own lean uniform patch)
426 ms, `eO` (WeatherLayers `ensureDefaultProps`, per draw) 378 ms, `e.s.r`
(`geo.ts` `nearby`) 242 ms.

**The wind, unchanged and unexplained by anything on the render path:** every
run still reads `run=2026-09-09T18:00Z (6h ago) fhr=0`.

### Round 41 (2026-09-10) — the manifest churn the log exposed, and the upload is back

The 00:11 run: 34.7 % busy, 29.5 fps, 6 stalls / 1 533 ms, and `Layout` down to
176× / 195 ms — the lowest layout figure recorded. Two stalls carry most of it,
and the globe log added in round 34 named a third problem nobody was looking for.

**A no-op `WEATHER_RUN` was rebuilding the whole weather stack, ten times in
twelve minutes.** The log's manifest lines are written on every change of
`manifest` identity, and this run printed ten of them — 00:02, 00:04 ×2, 00:05,
00:06 ×2, 00:08, 00:09, 00:10, 00:12 — *every one reporting the same*
`run=2026-09-09T18:00:00.000Z (6h ago)`. So the socket event fires far more often
than a run actually publishes, each one refetched and called `setManifest(m)`
with a fresh object for identical data, and `manifest` is a dependency of Globe's
weather-layer effect. Identical weather, rebuilt ten times.

Fixed the way round 14 fixed `mergeControlState` and the alert overlay fixed its
polls: `manifestFingerprint` + `pickManifest` (`lib/manifest.ts`, tested) keep the
PREVIOUS object when the incoming manifest renders identically. The digest covers
model, run, `generatedAt`, step count and each variable's hour-0 texture id plus
nest count — so a re-bake republishing new textures under the same run still
counts as a change, while a repeat event does not. Both watch pages use it, and
`pickManifest(prev, null)` keeps what is on screen when a fetch fails.

This is the diagnostic paying for itself twice: the texture log named the 368 ms
upload in round 38, and the manifest line has now named a rebuild loop that no
CPU profile would ever have shown as anything but "layer updates".

**The 391 ms texture upload is back** — the 570 ms stall at 12.8 s is 68.3 %
`texSubImage2D`. Round 39's smaller 40–72 ms uploads were a quieter scene, not a
fix. This is one of the 38.6 MB / 36.3 MB images landing, and it stays the single
largest stall on the page. Making it smaller is a worker-side decision about bake
resolution; nothing on the client can split a synchronous upload.

**And the alert polygon tessellation, again**: 366 ms at 18.6 s, 40.7 % `C`
(cut-by-grid) with `v`, `ez` and `nU` under `setLayers` — round 39 established
this is genuine work on a real alert change, not churn. Worth re-checking once
the manifest fix lands, since some of those rebuilds were the churn above.

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
