# /watch broadcast — design seed

`WatchChromeSeed.tsx` is a **self-contained** reproduction of the on-air `/watch`
broadcast chrome, for iterating on the UI in isolation (e.g. a claude.ai design
project / artifact) and porting the results back into the real components.

Nothing here is wired to the app — no sockets, no deck.gl globe, no real data.
Every panel renders from hardcoded fake values at the real **1920×1080** design
stage, scaled to fit the window. A small floating **theme switcher** (top-right)
previews all four broadcast themes, including `claude`.

## Use it in a claude.ai design project

1. Open a claude.ai design project / React artifact.
2. Paste the contents of `WatchChromeSeed.tsx` as the main component
   (default export `WatchChromeSeed`). Its only import is `react`.
3. Iterate on layout / colour / type there.

## Porting changes back

The file mirrors the real component tree 1:1 — each block names its source:

| Seed component        | Real source (`public/src/components/…`)                          |
| --------------------- | ---------------------------------------------------------------- |
| `THEMES` tokens       | `broadcast/config.ts` (`BROADCAST_THEMES`) + `BroadcastCard` ink |
| `Ticker`              | `broadcast/Ticker.tsx`                                            |
| `BrandPanel`          | `broadcast/BrandPanel.tsx`                                        |
| `IntensityMeter`      | `broadcast/IntensityMeter.tsx`                                    |
| `LiveAlertPanel`      | `broadcast/LiveAlertPanel.tsx`                                    |
| `EventOverlay`        | `broadcast/EventOverlay.tsx` (reticle + tracking label + lower third) |
| `WorldReportDeck`     | `broadcast/WorldReportDeck` + `WorldSituationPanel` + `WorldWatchPanel` + `WorldFeed` |
| `SpaceWeatherMeter` / `KpIndexPanel` | `broadcast/SpaceWeatherMeter.tsx` / `KpIndexPanel.tsx` |
| Monitors              | `broadcast/MonitorCluster.tsx` (seismic / tsunami / weather)     |
| `DeckCard` + slide bodies | `broadcast/BroadcastCard.tsx` (deck template) + `mode-slides.tsx` + the per-kind panels (`CountryPanel`, `TopCitiesPanel`, `CityConditionsPanel`, `QuakeReport`, `TrackInfoPanel`, `VolcanoFactsPanel`, `PointHistoryPanel`) |
| `SyslogFeed` / `UpNextPanel` | `broadcast/SyslogFeed.tsx` / `UpNextPanel.tsx`            |
| Stage layout          | `broadcast/BroadcastFrame.tsx` (region anchors)                  |

## Fidelity notes / deliberate deviations

- **Left card rotation** cycles one slide of *each* archetype (storm / quake /
  country / top-cities / city-conditions / aircraft / volcano) so every deck look
  is visible. Live, a single segment's `kind` decides which slides appear.
- The **G.O.D.S. banner PNG** (`/gods_banner_transparent.png`) is replaced by the
  text/monogram brand block for all themes so the file stays self-contained.
- The **globe** is a static CSS gradient sphere standing in for the deck.gl globe.
- The **top-right WORLD REPORT deck** shows its default "detection" slide statically
  (live it rotates through hourly / alerts / seismic / volcanoes / about).
- A few cool-blue text colours in `BrandPanel` (tagline `#8fb6e6`, values `#dce9fb`)
  are hardcoded, not theme-driven — same as the real code today.
