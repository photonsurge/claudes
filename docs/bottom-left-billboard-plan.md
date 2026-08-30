# Bottom-left sponsor billboard — plan

> **Status: SHIPPED 2026-08-30.** All steps below landed (including the
> BroadcastFrame wiring — the widget-catalog parity test required it in the
> same pass). Worker restart needed for billboard exposure logging.

A third ad placement, `billboard`: an always-on **image** creative docked in the
freed bottom-left corner (the old locator-planet spot — the corner the
BroadcastFrame comment already reserves "for sponsor placements"). It rotates
through every active billboard-placed ad in the catalog, hides itself when the
catalog is empty, toggles per channel like any other chrome widget, and logs
airtime as exposure windows the way ticker mentions do.

"Billboard" is the broadcast term for exactly this ("this hour sponsored by…"),
and it slots straight into the existing `AdPlacement` machinery next to
`break` and `ticker`.

## Where it sits — geometry (1080p stage space)

- Anchor: `left: INSET - 16`, `bottom: chromeBottom` (so it rides up/down with
  the crawl toggle exactly like the bottom-right feeds), `scale(1.2)` with
  `transform-origin: left bottom` — the same treatment as the left deck above,
  so its right edge lines up with the deck column.
- Width: `CARD_W` (420), matching the deck column exactly.
- Chrome: the new **GodsPanel** shell (chamfered plate, SANS/MONO ramp) with a
  small "SPONSORED" header row + advertiser name, so it lands already in the
  HUD language the current UI pass is establishing.

**The gap is not fixed** — the deck above is top-anchored and grows, so the
free band between deck bottom and the crawl varies (rendered px, ticker on):

| Deck state                      | Deck bottom | Free band above crawl |
| ------------------------------- | ----------- | --------------------- |
| plain deck                      | 776         | **240 px**            |
| + Kp panel (aurora on)          | 844         | **172 px**            |
| + tracking header (3 rows)      | 945         | 71 px                 |
| + tracking + Kp                 | 1013        | 3 px                  |

So the billboard **fits adaptively instead of assuming a hole**: BroadcastFrame
already knows `leftDeckTop`, `deckTracking` and the Kp stack, so it computes
`deckBottom = leftDeckTop + 1.2 × (CARD_H + trackingBlockHeight)` and hands the
billboard the remaining band (minus a ~12 px gap). The billboard clamps its
media box to fit — full band ≈ 420×150 design-px creative area, Kp-squeezed
≈ 420×100 — and renders `null` when the band drops under a ~120 px floor.
The under-floor cases are exactly the targeted-event tracking modes, where
yielding the corner is editorially right anyway (same spirit as breaking-news
deferring ad breaks). Creative guidance for operators: wide banner, roughly
2.5:1–4:1 (leaderboard-shaped) reads best; `object-fit: contain` on a dark
tile handles anything else.

## Steps

1. **Shared types** — [shared/src/ads/types.ts](../shared/src/ads/types.ts):
   add `"billboard"` to `AdPlacement`, `AD_PLACEMENTS`, and
   `AD_PLACEMENT_LABELS` ("Bottom-left billboard"). `normalisePlacements`
   filters against `AD_PLACEMENTS`, and both admin forms (AddAdForm /
   AdEditPanel) map it — the checkbox appears for free. Run `./update-shared`.

2. **Models** — [ad-model.ts](../shared/src/db/ad-model.ts): extend the
   `placements` enum. [ad-exposure-model.ts](../shared/src/db/ad-exposure-model.ts):
   add `"billboard"` to the `surface` enum + `AdExposureSurface`. No migration:
   pre-field docs still read as break-only.

3. **Serve route** — new `GET /api/ads/billboard` mirroring
   [sponsors/route.ts](../public/src/app/api/ads/sponsors/route.ts): active +
   billboard-placed + `mediaType === "image"` only (v1 is the image placement;
   video stays on `break`). Returns wire `Ad`s with `adMediaPath` URLs, wrapped
   in `withCache` (own feed key) + `withApiLog`.

4. **Client hook** — `useBillboardAds` alongside
   [use-sponsors.ts](../public/src/lib/ads/use-sponsors.ts): 5-min poll,
   failures keep the last good list.

5. **Component** — `SponsorBillboard.tsx` in components/broadcast: cycles the
   list on a ~25 s hold with the FadeSwap cross-fade; deterministic order
   (catalog order, offset by time) so it needs no server coordination. Takes a
   `maxHeight` from the frame (the adaptive band above) and clamps its media
   box to it. Renders `null` when the list is empty or the band is under the
   floor — no empty frame ever airs. Hidden during the `cutting` window like
   the deck, and suppressed while HazardScreen has the stage (mirrors
   "breaking-news defers" for breaks).

6. **Widget toggle** — [broadcast-widgets.ts](../shared/src/broadcast-widgets.ts):
   new id `"billboard"`, zone `bottom-left`, label "Sponsor billboard".
   BroadcastFrame wraps the component in `!off.has("billboard")`. Rides the
   existing `widgetsOff` off-list, so **no ControlState schema change** (no
   broadcast-state-model parity edit needed) and it defaults ON everywhere.

7. **Exposure sweep** — [worker/src/jobs/ads.ts](../worker/src/jobs/ads.ts):
   second `reconcile("billboard", pairs)` in the same sweep, pairs = active
   billboard ads × scenes not hiding the `billboard` widget. Same window
   semantics as ticker: "in rotation on this scene", not per-impression —
   `timesShown`/`totalDisplayMs` stay break-only. Worker restart to pick up.

8. **Admin polish** — check the exposure log card labels the surface; add a
   surface label map if it hardcodes "ticker". Note in the upload form hint
   that billboard creative reads best wide (roughly 2:1–2.5:1).

9. **Tests** — normalisePlacements accepts `billboard`; exposurePairs for the
   new surface + widget gate; billboard route (filters video out);
   SponsorBillboard RTL (renders image, rotates, empty ⇒ null, hazard ⇒
   hidden). `./test` green across packages.

## Sequencing with the current UI pass

BroadcastFrame + the GodsPanel chrome are dirty in the working tree right now.
Steps 1–5 and 7–9 are all new files / non-broadcast edits and can land
independently; the BroadcastFrame wiring (step 6's gate + one mount) is a
~10-line addition to slot in after the current UI work settles.

## Later (not v1)

- Video billboards (muted, looped) once wanted.
- Director-coordinated rotation + per-slot dwell stats if per-impression
  billing ever matters.
- `clickUrl` QR overlay on the creative.
