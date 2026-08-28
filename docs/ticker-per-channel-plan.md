# Per-channel ticker content — plan

> **Status: SHIPPED** (2026-08-28). `tickerKindsOff` / `tickerHazardsOff` +
> `broadcast-ticker.ts` catalog, the `ticker` widget id, volcano crawl lines,
> and the Bottom crawl card on /admin/scenes/:id are all live; every package's
> tests green. The "Later / out of scope" list below is still open.

Tailor the bottom **GLOBAL FEED** crawl per scene/channel from the admin form:
which content kinds ride it (seismic, alerts, volcanoes, aircraft/ships, sponsor
mentions), plus an optional alert-hazard filter — the same "one globe, many
themed channels" move the World Report card already made.

## Where the crawl comes from today

- [Ticker.tsx](../public/src/components/broadcast/Ticker.tsx) is purely
  presentational (title chip + gapless CSS crawl). Content arrives as
  `TickerEntry[]`.
- [broadcast.ts](../public/src/lib/broadcast.ts) builds the lines:
  `buildTicker({quakes, tracks, alertLines})` → seismic → alerts → tracks, then
  `weaveSponsors(ticker, sponsors)` threads "Sponsored by …" AD mentions evenly
  through the loop.
- [BroadcastFrame.tsx](../public/src/components/broadcast/BroadcastFrame.tsx)
  (~L247–274) memoises `alertTickerLines(alerts, cities)` (the expensive
  per-alert nearest-city flag scan) on `[alerts, cities]`, assembles the feed,
  and renders the single bottom `<Ticker>` unconditionally (~L1083).
- **Volcanoes are not in the crawl at all today** — they're in World Watch
  (`worldWatchFeed`) but `buildTicker` never sees them.
- Nothing is channel-configurable: every channel gets the identical feed. Only
  the chip text (`theme.tickerTitle`) is already per-channel via Theme settings.

## The established pattern to mirror

`ControlState.reportKindsOff` / `reportHazardsOff` +
[broadcast-report.ts](../shared/src/broadcast-report.ts)'s `REPORT_KINDS`
catalog + the [ReportSettings](../public/src/components/admin/scenes/ReportSettings.tsx)
card is the exact precedent: a shared catalog of stable ids, an **off-list**
(empty = show all, so new kinds default on for every existing channel — no
migration), delta-patched through `SceneDraft` so Save never clobbers live
operator state, validated in `mergeControlState`, persisted in
`broadcast-state-model.ts` (strict schema — forget it and the field silently
drops; the parity test catches this).

## Design

### 1. Shared catalog — `shared/src/broadcast-ticker.ts` (new)

```ts
export type TickerKind = "quake" | "alert" | "volcano" | "track" | "ad";
export const TICKER_KINDS: { id: TickerKind; label: string; hint: string }[] = [
  { id: "quake",   label: "Earthquakes",      hint: "Live seismic events (USGS ~24h window)" },
  { id: "alert",   label: "Weather alerts",   hint: "Active warnings, deduped by area, flagged by nearest city" },
  { id: "volcano", label: "Volcanoes",        hint: "Erupting / unrest volcanoes (dormant never shown)" },
  { id: "track",   label: "Aircraft & ships", hint: "Notable tracked craft" },
  { id: "ad",      label: "Sponsor mentions", hint: "\"Sponsored by …\" AD lines woven through the loop" },
];
export function isTickerKind(v: unknown): v is TickerKind;
```

Kind ids reuse the `ReportKind` vocabulary (`quake`/`alert`/`volcano`) so the
two cards speak the same language; `track` and `ad` are ticker-only. Ids are
stable forever (they persist in off-lists).

### 2. ControlState — `shared/src/control.ts`

- `tickerKindsOff: TickerKind[]` — off-list, default `[]`.
- `tickerHazardsOff: HazardType[]` — alert-hazard filter for the crawl only,
  independent of the globe's `alertHazardsOff` and the report's
  `reportHazardsOff` (a seismic channel can keep tsunami warnings in the crawl
  while dropping heat/rain). Default `[]`.
- `mergeControlState`: same clause shape as `reportKindsOff` /
  `reportHazardsOff` (Array.isArray → dedupe → narrow with `isTickerKind` /
  `isHazardType`, else `base ?? []`).

### 3. Persistence — `shared/src/db/broadcast-state-model.ts`

Two `{ type: [String], required: true, default: [] }` fields, next to
`reportKindsOff`. The ControlState↔schema parity test must stay green — that's
the tripwire this project added after losing fields to the strict schema.

Then `./update-shared` (never hand-copy dist).

### 4. Whole-crawl on/off — a widget id

Add `id: "ticker"` to `BROADCAST_WIDGETS` in
[broadcast-widgets.ts](../shared/src/broadcast-widgets.ts), new zone
`"bottom-edge"` ("Bottom crawl") appended to `WIDGET_ZONE_LABELS` /
`WIDGET_ZONE_ORDER`. The ChannelSettings widgets card renders from the catalog,
so the per-channel hide toggle appears **for free**; BroadcastFrame wraps the
bottom `<Ticker>` in `!off.has("ticker")`.

Layout note: nothing currently reclaims the `TICKER_H` strip — check the
bottom-anchored furniture (gauge row / left deck offsets) and let it drop to the
screen edge when the crawl is hidden, same as chrome already adapts when
`brand` is off.

### 5. Crawl composition — `public/src/lib/broadcast.ts`

- New `volcanoTicker(v: Volcano): string` — e.g.
  `"VOLCANO ERUPTING: Etna · Italy"` (status uppercased; erupting + unrest
  only, dormant excluded — consistent with every other surface).
- `buildTicker` gains `volcanoes?: Volcano[]`; order becomes
  **quakes → volcanoes → alerts → tracks** (geology together, then warnings,
  then tracks). No caps — the crawl shows everything, long feeds just scroll
  longer.
- Keep `buildTicker` dumb: kind gating lives in the component (below), so the
  pure builders stay single-purpose and the expensive alert scan can be skipped
  entirely, not computed-then-discarded.

### 6. Wiring — `BroadcastFrame.tsx`

```ts
const tickerOff = new Set<string>(state.tickerKindsOff);
const tickerAlerts = useMemo(   // hazard-filter before the expensive scan
  () => tickerOff.has("alert") ? [] : filterByHazard(alerts, state.tickerHazardsOff),
  [alerts, state.tickerKindsOff, state.tickerHazardsOff]);
const alertLines = useMemo(() => alertTickerLines(tickerAlerts, cities), [tickerAlerts, cities]);
const ticker = useMemo(() => buildTicker({
  quakes:    tickerOff.has("quake")   ? [] : quakes,
  volcanoes: tickerOff.has("volcano") ? [] : volcanoes,
  tracks:    tickerOff.has("track")   ? [] : tracks,
  alertLines,
}), [...]);
const bottomTickerItems = useMemo(
  () => tickerOff.has("ad") ? ticker : weaveSponsors(ticker, sponsors),
  [ticker, sponsors, state.tickerKindsOff]);
```

Memoisation discipline stays intact: the alert scan still keys off a stable
alert array, and turning alerts off skips the scan altogether. `volcanoes` is
already a frame prop. All kinds off ⇒ the band shows its STANDBY line — an
operator who wants no band at all uses the `ticker` widget toggle.

Turning off `ad` drops **crawl mentions only** — sponsor slides/rotation are
governed by the ads/slides settings, not this. (Say so in the card hint.)

### 7. Admin card — `TickerSettings.tsx` (new, on `/admin/scenes/[id]`)

Placed right after `ReportSettings` (its content-shaping sibling). Structure
copied from ReportSettings' "Feed & grid content" section:

- Title "Bottom crawl" + caption naming the on-air band (the chip text itself is
  edited in Theme settings — link that in the caption, don't duplicate it).
- One checkbox per `TICKER_KINDS` entry (label + hint).
- `AlertHazardChips` bound to `tickerHazardsOff`, shown only while `alert` is on
  — same conditional ReportSettings uses.
- All changes staged as a **delta patch** via `useSceneDraft().stage(sceneId,
  { tickerKindsOff })` etc. — only these keys, so Save can't clobber live
  operator state. Loads current state via `fetchSceneState`, re-fetches on
  draft `epoch` (discard) like every other card.

No presets, no ordering UI, no per-kind caps for v1: the crawl is a
seriousness-ordered marquee, and "no arbitrary caps" is a standing rule. The
`/control` page stays out of scope — content shaping is an admin-page concern
(same split as Director content vs pacing).

## Tests (every package ships green — `./test`)

- `shared/control.test.ts`: merge round-trip for `tickerKindsOff` /
  `tickerHazardsOff` (mirror the widgetsOff/reportKindsOff cases: dedupe, junk
  ids dropped, absent-in-patch keeps base). Parity test covers the model.
- `shared` broadcast-ticker catalog: `isTickerKind` narrowing, id stability.
- `public/lib/broadcast.test.ts`: `volcanoTicker` text; `buildTicker` ordering
  with volcanoes; dormant excluded.
- `public` `TickerSettings.test.tsx`: renders kinds from the catalog, toggling
  stages the right delta, hazard chips only when alerts on (mirror
  `ReportSettings.test.tsx`).
- `BroadcastFrame.test.tsx`: kinds-off state drops the matching lines; `ad` off
  ⇒ no AD entries; `ticker` widget off ⇒ no band.

## Order of work

1. Shared: catalog + ControlState + merge + model + widget id/zone + tests →
   `./update-shared`.
2. `lib/broadcast.ts`: volcano lines + ordering + tests.
3. `BroadcastFrame`: kind gating, hazard filter, widget-gated band + layout
   reclaim.
4. `TickerSettings` card + page wiring + tests.
5. `./test` across packages.

No worker/socket changes: patches ride the existing scene-state PATCH →
`mergeControlState` → dual-emit path. Existing channels see zero behaviour
change except volcano lines appearing in the crawl (new kind, default-on by
off-list semantics — flag to the operator; any channel can untick it).

## Later / out of scope

- Presets ("Seismic channel" one-click) if hand-tuning gets tedious — the
  ReportSettings preset shape drops straight in.
- Per-kind ordering of the crawl (currently fixed seriousness order).
- A `/control` live quick-toggle for the crawl kinds.
- The top crawl (masthead band) — currently not per-channel either; same
  mechanism would extend if wanted.
