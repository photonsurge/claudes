# Live Weather Globe — Design Bible

A portable design-system reference extracted from the actual production code
of the Live Weather Globe broadcast product. Hand this to any other AI system
(or human designer) that needs to produce on-brand UI, marketing assets, or
new components without access to this repo — every token below is copied
verbatim from source, not reinvented.

---

## 1. Product identity

**Product:** Live Weather Globe — a broadcast-style, always-live MapLibre/deck.gl
weather globe (NOAA GFS + a wide multi-source portfolio), driven by a human
"director" operator and streamed to YouTube. It reads as a 24-hour cable news
weather/disaster channel, not a consumer weather app.

The product ships **three interchangeable on-air identities** (skins), selected
live by the operator. Building a new asset means picking one of these, not
inventing a new brand:

| Theme id | Channel name | Tagline | Accent | Personality |
|---|---|---|---|---|
| `aurora` (default) | LIVE WEATHER GLOBE | GLOBAL WEATHER & FLIGHT OPS | `#38bdf8` (sky blue) | Calm, blue-chip global news |
| `command` | G.O.D.S. COMMAND | GLOBAL OBSERVATION & DEFENSE SYSTEM | `#f5b301` (amber) | Militaristic ops-room / "situation room" |
<!-- NOTE: the shipped G.O.D.S. banner (public/public/gods_banner_transparent.png,
     used in the /admin top bar) reads "GLOBAL ORBITAL DETECTION SYSTEM" and is
     cyan, not amber. The asset and this row disagree — the asset is what users
     actually see. Reconcile before treating this row as authoritative. -->

| `storm` | STORM WATCH LIVE | SEVERE WEATHER OPERATIONS | `#f43f5e` (rose red) | Urgent severe-weather special coverage |

Regardless of theme, the **LIVE badge is always broadcast-red `#ff3b3b`** —
it never re-skins, so "live" always reads the same way to a viewer flipping
between looks.

Voice: all-caps, high-letter-spacing labels for anything chrome/HUD ("GLOBAL
MONITOR", "SEISMIC MONITOR", "ON AIR", "STANDING BY · AWAITING LIVE FEED").
Sentence case is reserved for actual narrative content (segment titles,
ticker items, summaries).

---

## 1a. Reference screenshots

Live captures of the actual running product (`aurora` theme, standby/no-scene
state) — use these as ground truth for how the tokens in this document
actually compose on screen.

**`/watch` — the on-air broadcast surface** (`docs/design-bible/watch-broadcast-surface.png`)
Shows, at once: the top ticker with its angled title chip, the brand panel +
pulsing LIVE badge (top-left), the Kp/geomagnetic + aurora-oval glass panels,
the intensity-meter color legend (top-center), the WORLD WATCH rollup
(top-right), SEA TEMP PROFILE and AREA HISTORY cards (bottom-left), three
LOCAL MONITOR trace cards (bottom-center), and the bottom alert ticker. This
is the single best image for absorbing the glass-panel language, the
uppercase/wide-tracking HUD type, and the cyan "live data" accent.

**`/control` — the operator console** (`docs/design-bible/control-operator-console.png`)
The flat, utilitarian tooling surface: MAP KEY legend, the Auto-director
toggle/countdown, and the per-segment-kind hold-time sliders. Notice this
surface has *no* glass/blur/gradient — solid dark panels, sharp small-radius
corners, a single blue accent for interactive controls. This is the contrast
case to the broadcast surface above; don't let the two visual languages
bleed into each other.

---

## 1b. Segment-kind gallery (`docs/design-bible/gallery/`)

Auto-director cycling through real on-air content — captured live via
`public/scripts/design-bible-screenshots.mjs` (see that file's header for how
to re-run it). Each shows the same glass-panel/HUD language wrapped around a
different kind of on-air content, which is the best way to see how the system
*scales* across segment kinds rather than just what one frame looks like:

- **`view-01.png`** — Global Pressure (MSLP): wide shot, isobar contour lines,
  dense city-label field, diverging pressure palette (§4.3).
- **`view-02.png`** — Storm (CAPE) with a **severe-weather event card**: the
  red-bordered "EVENT DETECTION OVERLAY" (severity 4/4 "Extreme"), a named
  storm marker + label, live satellite cloud texture blended under the CAPE
  ramp.
- **`view-03.png`** — Elevation basemap with an **earthquake event card** +
  the bottom-left "SEISMIC REPORT" detail panel (magnitude/depth banding,
  nearest-cities table) + the SEISMIC MONITOR trace card.
- **`view-04.png`** — Temperature, close orbital framing on a **tracked
  aircraft** ("AIRCRAFT · EVENT DETECTION OVERLAY" + a NOTABLE AIRCRAFT card)
  over the SEA TEMP PROFILE card.
- **`view-05.png`** — Temperature, regional zoom thick with live air-traffic
  markers (a realistic "busy sky" moment) plus city population labels —
  useful for checking marker-density legibility against a data-viz basemap.
- **`control.png`** — `/control` mid-broadcast: the live globe preview, an
  on-air "ROUND-UP" card (Spain · extreme fire · 88 events), and the full
  VARIABLE/LAYERS picker — the operator's-eye view of the same broadcast.
- **`admin-hub.png`** — `/admin`: the flat card-grid hub linking every admin
  tool (alerts, scenes, tracks, volcanoes, queue, etc.) — ground truth for the
  admin surface's typography and card treatment referenced in §4.6.

Not pictured (would need a genuinely active severe alert / large quake to
trigger on its own): the dedicated "Severe storms / volcanoes" and
"Earthquakes" director segment kinds beyond the event-card overlays already
visible above, and the `command`/`storm` theme re-skins (`--watch-only`
skips these; drop the flag to capture them too).

---

## 2. Design philosophy

- **Broadcast HUD, not a web app.** Every on-screen element is a floating
  "glass" card over live video (the globe), never a full-bleed page
  background. Assume transparency and legibility over motion footage.
- **Data-truthful color.** Color always encodes something real — a
  temperature, a severity rank, a magnitude — never decoration for its own
  sake. When in doubt, reuse an existing ramp (§4.3) rather than picking a
  new hue.
- **Self-hiding, never filler.** Panels disappear when their data isn't
  relevant rather than showing empty/placeholder state. Don't design "empty"
  variants — design the absence.
- **Two distinct surfaces, two distinct palettes:** the **on-air broadcast
  layer** (glassy, gradient, theme-driven) and the **operator/admin tooling**
  (flat, dark, utilitarian, no gradients). Never mix them — an admin table
  should never look like a broadcast lower-third, and vice versa.

---

## 3. Typography

No custom/webfonts are loaded anywhere in the product — it's system-native by
design (fast, no FOUT, broadcast-safe rendering everywhere).

```css
--sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif;
--mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
```

- **Sans (`--sans`)** — all UI chrome, labels, narrative text, buttons.
- **Mono (`--mono`)** — anything that's a *reading*: clocks, coordinates,
  magnitudes, job IDs, log tails, telemetry numbers. If it's a measurement or
  an identifier, set it in mono with `font-variant-numeric: tabular-nums`.

**Type scale in use (broadcast layer):**

| Use | Size | Weight | Letter-spacing | Notes |
|---|---|---|---|---|
| On-air headline (segment title) | 30px | 800 | normal | single line, ellipsis |
| Brand name (top-left panel) | 19px (15px compact) | 800 | 1px | |
| Subtitle / description | 17px | 400 | normal | opacity 0.82, 2-line clamp |
| Stat tile value | 22px | 800 | normal | tabular numbers |
| Kind badge / pill | 12px | 800 | 1px | uppercase |
| Panel section label | 8–11px | 800 | 0.8–1.4px | uppercase, the HUD "chrome" voice |
| Body / detail row | 16px | 700 | 0.3px | |
| Tagline / micro-label | 8.5–10px | 700 | 1.2px | uppercase, ~0.8 opacity |

Rule of thumb: **the smaller the text, the heavier the weight and the wider
the letter-spacing** — this is what makes 8px HUD labels still read as
intentional rather than as a bug.

---

## 4. Color system

### 4.1 Broadcast surface tokens (glass panel look)

These are the tokens every floating on-air card is built from — a dark,
theme-tinted glass, never solid:

```css
background: theme.panelBg;      /* e.g. linear-gradient(180deg, rgba(12,17,28,0.82), rgba(8,12,20,0.9)) */
border: theme.panelBorder;      /* e.g. 1px solid rgba(120,140,170,0.25) */
border-radius: 10–14px;
box-shadow: 0 8px 26px rgba(0,0,0,0.45);
backdrop-filter: blur(8px);      /* + -webkit- prefix */
color: #e6edf7;                  /* primary ink on glass */
```

Secondary/muted ink on glass: `#9fb3cc`, `#8b98ae`, `#6b7a94` (descending
emphasis). Hairline dividers inside a card: `1px solid rgba(120,140,170,0.15)`.

An accented card (on-air, stat rollup) adds a 4px solid left border in the
segment/kind color: `borderLeft: 4px solid ${color}`.

### 4.2 A richer internal token set (from the generative audio lab, `AudioLab.tsx`)

This is the most complete single palette block in the codebase — reuse it
whenever a component needs a fuller dark-UI system beyond the on-air glass
cards above:

```css
--bg:      #080b11;   --bg2:     #0b111b;
--panel:   #111a28;   --panel2:  #0d1521;
--edge:    #1e2c40;   --edge2:   #294060;
--ink:     #d6dfec;   --muted:   #6a7d97;   --dim: #3c4b60;
--aurora:  #54e6a6;   --aurora-d:#2fae7d;
--teal:    #35d6d0;   --violet:  #a98bff;
--severe:  #ff5f6d;   --amber:   #ffb454;
```

### 4.3 Data-visualization ramps (`shared/src/palettes.ts`)

Every weather variable has a fixed, hand-tuned `[stop 0..1, hex]` ramp. **Reuse
these exactly** — they're tuned per-domain (e.g. pressure is diverging around
1013hPa≈0.63, elevation has a sharp coastline step at 0.55) so a generic
viridis/rainbow substitute will look wrong next to the rest of the product.

```
temp:        #3b1f6b → #3257b0 → #2f9bd6 → #48c9a9 → #8fd86a → #f2e23a → #f29b2e → #df4327 → #7a1414
humidity:    #6b4a2b → #b08a4c → #d9d36a → #5bb86a → #2f9bd6 → #1f3f9b
rain:        #0a1a2f → #1f6fb0 → #3ec46a → #f2e23a → #f2802e → #c01f7a
storm(CAPE): #10240f → #2f8f3a → #f2e23a → #f2802e → #df2727 → #7a0f5a
gust:        #0a2f2a → #2f9bd6 → #8fd86a → #f2e23a → #f2802e → #df2727
pressure:    #6a3d9a → #3257b0 → #52b0d6 → #e8eef2(≈1013hPa) → #f2c14e → #e8772e → #b81d1d
sst:         #08123b → #1f4fa0 → #2f9bd6 → #48c9a9 → #cfe05a → #f29b2e → #c0181f
cloud:       #9aa6b2 → #c8d2db → #e8eef2 → #ffffff
snow:        #bfe3ff → #8fc7f0 → #dfeefc → #ffffff
wave_height: #0a3340 → #0f7a8a → #2f9bd6 → #7a6fe0 → #c84fb0 → #e02747
current:     #3b1f6b → #3457a8 → #1f9bb0 → #2fbf6f → #a8d84a → #f2e23a
salinity:    #1f6f4a → #2f9bd6 → #3257b0 → #3b2f8f → #6a1f7a
wind:        #e8f0ff → #7fd0e0 → #f2e23a → #f2802e → #df2727
elevation:   #050436 → #0b1a70 → #15479e → #2f7dc6 → #5fb3df → #a6e3f0 → (sea level, #2e8b57) → #77c25a → #c6de83 → #e6c877 → #cd8f4c → #9c5a37 → #b294a6 → #ffffff
```

**Palette-family rules to keep any new variable consistent:**
- Cold→hot / calm→dangerous always runs **blue/purple → green/yellow → orange
  → red/magenta**.
- Diverging fields (pressure) put a near-white neutral at the physical
  "normal" value, not at the numeric midpoint.
- Cloud/snow are the exception: near-monochrome grey/blue → white, because
  they represent *coverage/whiteness*, not intensity-of-danger.

### 4.4 Severity / alert ramp (`shared/src/alerts/severity.ts`)

Universal across warnings, forecast hazards, and area-status rollups:

| Rank | Label | Color |
|---|---|---|
| 0 | None / info | `#9ca3af` (grey) |
| 1 | Minor | `#22c55e` (green) |
| 2 | Moderate | `#eab308` (yellow) |
| 3 | Severe | `#f97316` (orange) |
| 4 | Extreme | `#ef4444` (red) |

This is *the* severity ramp for the whole product — reuse it for any new
warning/threat-level UI rather than inventing another red/yellow/green scheme.

### 4.5 Space-weather (Kp / aurora) ramp

```
G5 Extreme storm (Kp≥9): #a21caf (magenta)
G4 Severe storm  (Kp≥8): #dc2626 (red)
```
(follows the same escalating-toward-red logic as severity, but ends in
magenta at the very top to stay visually distinct from "severe weather" red.)

### 4.6 Admin / operator-tooling palette (flat, utilitarian — deliberately NOT glassy)

**The admin surface is MUI.** `/admin` is built on MUI v9 with a theme generated
from `public/src/theme/tokens.ts` → `adminTheme.ts`, mounted for the `/admin`
subtree only (`AdminThemeProvider`). Don't hardcode these hexes in a component —
import the token or read the theme. They're listed here for off-repo consumers.

```
page background (default):  #070a10
panel/card (paper):         #0f151f
raised (nested, hover, th): #161e2c
sunken (log/code wells):    #05070c
hairline / divider:         #232c3d      (strong: #33415a)
primary text:               #e6edf7
secondary text:             #94a3b8
disabled/tertiary text:     #5b6577
accent (primary):           #38bdf8      (the product's own sky blue, §1)
border-radius:              6  (flat, small — NOT the 10–14px glass-card radius)
box-shadow:                 none, at every elevation
```

Superseded the original ramp (page `#0a0e16` / card `#0c111c` / border `#1b2030`),
which put page and card within ~2% luminance of each other behind a hairline you
couldn't see — nothing read as an object. Depth now comes from the
page→panel→raised surface ramp plus a hairline that's actually visible, never
from a shadow.

Semantic colours are **not** a separate admin scheme: MUI's
`success`/`warning`/`error` are wired straight to the product severity ramp
(§4.4), so an admin "healthy/failed" chip and an on-air severity badge agree on
what green and red mean.

**Accent discipline.** The accent is for *one* thing per view — the primary
action, or the one row worth spotting from across the room. Buttons are
`variant="outlined"` by default (§5.6). A grid of filled accent buttons turns
the accent into the background and leaves the eye nowhere to land.

No blur, no gradients, no glass here — this is the "engine room," and it
should look like one. MUI's dark mode paints an elevation gradient onto every
`Paper` by default; the theme explicitly turns that off.

---

## 5. Component patterns

### 5.1 Glass panel (canonical broadcast card)
```
padding: 8–20px (scales with card importance);
background: theme.panelBg; border: theme.panelBorder;
border-radius: 10–14px; box-shadow: 0 8px 26px rgba(0,0,0,0.45);
backdrop-filter: blur(8px);
pointer-events: none;   /* on-air overlays never intercept clicks */
```
Add `borderLeft: 4px solid <accent-or-kind-color>` when the card represents a
specific on-air *thing* (a segment kind, a stat rollup) rather than ambient
chrome (brand panel, monitors).

### 5.2 LIVE / ON-AIR badge
Pill, `background: #ff3b3b` (LIVE) always, uppercase, `font-weight: 800`,
`letter-spacing: 1.2–1.5px`, white text, a small circular dot that pulses via
`@keyframes { 0%,100%{opacity:1} 50%{opacity:0.35-0.4} }` on a ~1.4s cycle.
`ON AIR` variant keeps the same pulse but sits inline next to a kind badge
rather than in its own pill.

### 5.3 Ticker / crawl
Fixed 30px (24px compact) bar pinned to top or bottom edge, gradient
`linear-gradient(180deg, rgba(6,10,18,0.94), rgba(4,7,13,0.9))`, a title chip
in the theme accent color with an angled `clipPath` (a "flag" cut, not a
rectangle), and the feed doubled + translated -50% for a seamless CSS-only
loop (no rAF). Empty state: `"STANDING BY · AWAITING LIVE FEED"`.

### 5.4 Monitor cards ("GLOBAL MONITOR" / "LOCAL MONITOR")
Fixed-width (172px) glass card, an all-caps family label, then one or more
`Panel`s: an 8px uppercase title + icon, an optional right-aligned tag, and a
34px-tall dark trace box (`rgba(4,10,20,0.72)` bg, `1px solid
rgba(90,120,160,0.25)`) containing a looping SVG line/area chart. The trace
animates via `translateX(0)→translateX(-50%)` over the content doubled, same
seamless-loop trick as the ticker. Self-hides (`return null`) when its data
isn't relevant — never shows an empty trace.

### 5.5 Stat tiles (round-up panels)
Large tabular number (22px/800/white) over a small uppercase label
(10px/800/`#9fb3cc`, optional `· sub` in `#6b7a94`). Tiles with a falsy value
are filtered out entirely rather than shown as "0".

### 5.6 Buttons (utility surfaces)
Flat, small-radius (4–6px), `1px solid` border in a muted tone, transparent
or near-black background, `font: inherit`, no shadow, no gradient — visually
quiet on purpose against the busy broadcast chrome or admin tables around
them.

---

## 6. Iconography

Inline, hand-drawn SVGs (`viewBox 0 0 16 16`, 12–34px render size), single
open path, `strokeWidth 1.5–1.6`, `strokeLinecap/Linejoin: round`, `fill:
none`. Two-state coloring only:
- active: `#43d9ff` (cyan — the universal "live data" accent across
  monitors)
- inactive: `#c8d5e6` (soft ink)

No icon font, no filled/solid icon style anywhere in the broadcast layer —
everything is a thin line glyph so it reads at broadcast-safe small sizes.

---

## 7. Motion

All broadcast animation is **pure CSS `@keyframes`**, never JS/rAF-driven,
and falls into exactly three families:
1. **Pulse** (LIVE dot, ON AIR dot): opacity 1 → 0.35/0.4 → 1, ease-in-out,
   ~1.4s loop.
2. **Seamless scroll** (ticker text, monitor traces): content rendered twice,
   `translateX(0) → translateX(-50%)`, linear, duration scaled to content
   length (ticker: `~length × 0.16s`, min 24s; traces: 6–11s fixed per
   instrument).
3. **Instant transitions elsewhere** — deliberately no easing/fade on
   theme swaps, panel show/hide, etc.; broadcast chrome cuts, it doesn't
   crossfade.

---

## 8. Layout conventions

- Broadcast overlays are absolutely positioned over the globe canvas, always
  `pointer-events: none` unless interactive (unit toggle buttons on the
  Legend are the one exception).
- Standard on-air card width: 460px (on-air card, round-up stats); monitor
  cards: 172–250px.
- Corner/edge anchoring, never centered floating panels (center stage is
  reserved for the globe itself and, on wide shots, the OnAirCard's own
  content).

---

## 9. Voice & copy

- HUD/chrome labels: ALL CAPS, wide letter-spacing, terse ("SEISMIC MONITOR",
  "TSUNAMI GAUGE", "GLOBAL FEED", "STANDING BY · AWAITING LIVE FEED").
- Narrative/content text (segment titles, summaries, ticker items): sentence
  case, written as a news anchor would say it, not as a UI label.
- Separator glyph for feed items: `❯` (with padding spaces around it), not a
  pipe or bullet.
- Numbers are always real, sourced data — never placeholder/lorem values;
  panels hide instead of showing fake numbers.

---

## 10. Do / Don't for a new AI system extending this brand

**Do**
- Pick one of the three themes (§1) and inherit its accent + name/tagline as
  a unit — don't mix a theme's name with another theme's accent.
- Reuse an existing palette (§4.3) or severity ramp (§4.4) for any new data
  encoding before inventing a new color scale.
- Build new on-air components as glass cards (§5.1) with `pointer-events:
  none` and a self-hiding rule.
- Set HUD labels in the sans font, uppercase, bold, wide-tracked; set any
  measurement/ID in the mono font with tabular numbers.

**Don't**
- Don't add gradients, blur, or glow to admin/operator tooling — that
  palette (§4.6) is intentionally flat.
- Don't introduce a 4th on-air theme without also giving it a full identity
  (name, tagline, ticker/meter titles, accent, panel glass) — themes are
  never partial.
- Don't use rAF/JS-driven animation for broadcast chrome motion — everything
  is CSS keyframes.
- Don't design an "empty state" for a self-hiding panel — make it return
  nothing instead.
