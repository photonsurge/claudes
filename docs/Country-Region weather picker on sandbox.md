# Country/Region weather picker on /sandbox

## Context

`/sandbox` is the detached, off-air operator console (same globe + `ControlPanel`
as `/control`, but local-only — no `CONTROL_STATE` emit). It already has a plain
camera-jump picker (`RegionPicker`, inside `ControlPanel` → `SearchFlyTo`) that
flies to a country/region bbox but changes nothing else.

Separately, `/watch`'s auto-director has a `country` segment kind ("director
country spotlights"): picking a country flies the camera there **and** dresses
the globe in a "national weather" look — synoptic wind/pressure, live radar,
every active alert in frame, a gentle push-in, and the active variable cycling
temp → humidity → rain → gust → cloud → visibility every 5.5s. That look lives
as data (`PRESETS.country` in `shared/src/director-rois.ts`), decoupled from
the director machinery that drives it on watch.

Most recently (this session, auto-committed), a full Mongo-backed
Country/Region catalog shipped (~240 countries + oceans/continents/EU/UK
regions, real geometry, Wikipedia enrichment, and an hourly-computed
`AreaWeatherReport` — mean/min/max per variable + active hazards). Today that
catalog only renders in the admin tables (`/admin/countries`,
`/admin/regions`) — it has never been wired to the globe itself.

The ask: let an operator pick a country or region on `/sandbox` and have it
behave like watch's country spotlight — fly there, apply the national-weather
look, cycle the field — and, since the data already exists, also surface the
actual computed stats for that place (not just the visual look). Per prior
guidance ([[no-arbitrary-caps]]), the picker should cover the full catalog,
not a curated subset.

## Approach

Reuse existing pieces end to end rather than inventing new data or presets:

- **Catalog**: `useCountries()` / `useRegions()` (`public/src/lib/countries.ts`,
  `public/src/lib/regions.ts`) — already fetch `/api/countries` / `/api/regions`,
  each item pre-joined with its latest `AreaWeatherReport`, and already
  auto-refresh (120s poll + `TRACKS_UPDATED` socket kick).
- **Camera framing**: `globe.current.fitBounds(item.bbox)` — already computes
  zoom from bbox internally (`zoomForBbox` in `Globe.tsx:480`), so no
  per-country hand-tuned zoom is needed the way `COUNTRY_SHOTS` needs one.
- **The "national weather" look**: import `PRESETS.country` directly from
  `shared/src/director-rois.ts` (already exported, already imported
  client-side elsewhere, e.g. `public/src/lib/director.ts`) and merge it into
  local `ControlState` via the page's existing local `apply()`. Single source
  of truth with watch — if the look changes there, sandbox stays in sync.
- **Field cycling**: export the existing `VAR_CYCLE`/`VAR_CYCLE_MS` from
  `public/src/lib/director.ts` (currently module-local) and reuse
  `VAR_CYCLE.country` verbatim in a small `setInterval` in the new component.
- **Boundary glow**: `Globe.tsx` already accepts optional `glowCountryIso` /
  `glowRegionBbox` props (used today only by `/watch`) — thread them into
  sandbox's existing `<GlobeView>` call. Countries glow via their `iso2`;
  regions glow via `countriesInBbox(bbox)` (already implemented in
  `countryGlow.ts`), so no new glow code is needed either.
- **Stats readout**: render `item.weather.stats` / `.hazards` — same shape and
  formatting already proven in `CountriesTable.tsx` (lines ~196–211).

## Changes

### 1. `public/src/lib/director.ts` — export the field-cycle table

Change the module-local `const VAR_CYCLE` / `const VAR_CYCLE_MS` (around line
50) to `export const`, so the new sandbox component can reuse the exact same
`country` cycle instead of redefining it.

### 2. New: `public/src/components/CountryRegionWeather.tsx`

A self-contained sidebar section, sandbox-only (not part of the shared
`ControlPanel`, so it never reaches `/control` or the broadcast).

Props: `state: ControlState`, `onChange: (next: ControlState) => void`,
`onFitBounds: (bbox: [number,number,number,number]) => void`, `focus:
{kind:"country"|"region"; id:string; iso2?:string; bbox:[...]}| null`,
`onFocusChange: (f) => void`.

Behavior:
- `useCountries()` + `useRegions()` feed a single `<select>` with two
  optgroups ("Countries", "Regions"), each sorted by name; country labels
  prefixed with `flagEmoji(iso2)`.
- On pick: `onFitBounds(item.bbox)`; `onChange({ ...state, ...PRESETS.country,
  activeVariable: "temp" })`; `onFocusChange({ kind, id, iso2: item.iso2,
  bbox: item.bbox })`.
- While `focus` is set, a `useEffect` interval (period `VAR_CYCLE_MS`) steps
  `onChange({ ...state, activeVariable: nextInCycle })` through
  `VAR_CYCLE.country`, clearing on unmount or when `focus` clears.
- Renders the picked item's `weather.stats` (mean/min/max per variable) and
  `weather.hazards`, matching `CountriesTable.tsx`'s existing card styling.
- A "Clear" button calls `onFocusChange(null)` (stops cycling + glow; leaves
  the applied overlay toggles as-is, consistent with sandbox's no-undo,
  freeform philosophy — the operator can hand-adjust via `ControlPanel`).

### 3. `public/src/app/sandbox/page.tsx`

- Add `const [focus, setFocus] = useState<PlaceFocus | null>(null)`.
- Extract the existing inline `onFitBounds` closure (currently only passed to
  `ControlPanel`, `page.tsx:242`) into a named `fitBounds` function so both
  `ControlPanel` and the new component call the same one (stop-autoSpin
  behavior included).
- Pass `glowCountryIso={focus?.kind === "country" ? focus.iso2 : undefined}`
  and `glowRegionBbox={focus?.kind === "region" ? focus.bbox : undefined}`
  into the existing `<GlobeView>` call (~line 123) — purely additive, both
  props already optional and unused today on this page.
- Render `<CountryRegionWeather state={state} onChange={apply}
  onFitBounds={fitBounds} focus={focus} onFocusChange={setFocus} />` in the
  aside, as its own labelled block above `<ControlPanel>` (it's the headline
  control for this feature, distinct from the buried, purely-cosmetic
  `RegionPicker` inside `ControlPanel`).

## Verification

- `./test` (repo-wide unit tests) — no existing tests should break since all
  reused pieces (`PRESETS`, `VAR_CYCLE`, `fitBounds`, glow props) are additive
  or exports-only changes.
- Manual, via the `run` skill: start the app, open `/sandbox`, pick a country
  (e.g. Japan) from the new picker — confirm the camera flies in, radar/alerts/
  wind/pressure switch on, the active variable visibly cycles every ~5.5s, the
  country's boundary glows, and the stats/hazards card shows real numbers.
  Repeat for a region (e.g. an ocean) and confirm the bbox-wide glow and stats
  card, then hit "Clear" and confirm glow/cycling stop.
