# EMMA area geometry gap — half our warning areas have no shape

**Status:** cause **PROVEN**, fix **BUILT** (not yet deployed). Two follow-ups
remain open (Serbia; the seen ledger) and one strategic option is unexplored (the
MeteoAlarm Metadata API).
**Written:** 2026-07-16. **Revised:** 2026-07-16 after an external review — which
overturned three conclusions and found the registry this doc said didn't exist.
Everything here is measured against live data unless explicitly flagged.

---

## The problem in one line

**10,187 of 20,568 active warning areas (49.5%) have no geometry**, so 310 real
warnings are either invisible or drawing with pieces missing — silently.

MeteoAlarm ships an area as a **name + `EMMA_ID` geocode and no polygon**. The
boundary comes from EUMETNET's MeteoGate EDR gateway (`worker/src/alerts/meteogate.ts`),
is cached forever in `alert_area_geom`, and is joined onto alerts at ingest
(`enrich-geometry.ts`) plus a reconcile sweep (`geom-sync.ts#reconcileCachedGeometry`).

An alert only **disappears** when *every* one of its areas fails. The rest draw as
**part of their region with nothing to indicate the gap** — which is why this went
unnoticed. It is on air now.

## THE CAUSE — the page cap reads 3 pages of every country. Proven.

`fetchCountryFeatures` (`meteogate.ts`) reads page 1, then walks **backwards** from
the last page while `read < METEOGATE_MAX_PAGES` (default 3). That is **three pages
in total** — page 1, the last, and the second-to-last. Everything between is
**never read, on any run, ever**.

> Correction: an earlier draft said "page 1 + the last ~3 pages" (four). It is
> three. The loop's `read` counter starts at 1 and includes page 1 implicitly, so
> `maxPages` is really *maxPagesTotal*. The variable name misleads; rename it.

**Measured — one request per country, all 39:**

```
cc   totalPages  read  UNREAD
DE          281     3     278      ← 99% never read
FR           74     3      71
AT           42     3      39
ES           31     3      28
CZ           29     3      26
FI           17     3      14
RO           12     3       9
CH           11     3       8
IT           10     3       7
BG/DK         6     3       3
IL/NL/PL      5     3       2
SI/SK/BE/HU/IE  ≤3  all     0
AD BA CY EE GR HR IS LT LU LV MD ME MK MT NO PT RS SE UA UK
              1     1       0      ← single page, fully read

TOTAL pages across countries: 565    NEVER READ: 492  (87.1%)
```

**We read 13% of the feed.**

### The decisive test — the missing areas ARE in the gap

`totalPages=42` only proves a gap *exists*, not that our missing areas are *in* it.
So: freeze one `now`, read **every** Austrian page under that identical datetime
interval, and resolve the features on pages the sweep never touches.

```
AT: totalPages=42, sweep reads pages [1, 41, 42]
fetched 42 pages → 4,112 features
features on NEVER-READ pages: 3,900   ← 95% of Austria's feed

resolved 80 of them → 31 distinct EMMA_IDs
EMMA_IDs WE DO NOT HAVE, found only on never-read pages: 7

  AT106  (page 2)      AT201  (page 2)      AT303  (page 2)
  AT405  (page 2)      AT415  (page 2)      AT901  (page 2)
  AT922  (page 2)
```

Seven missing boundaries from **80 of 3,900** features, all on **page 2** — a page
we have never read. `AT106 Mattersburg` is the example this doc used to cite as
missing. That is the bug, proven end to end.

### The cost model is much better than this doc claimed

**Only page fetches spend quota.** The `rel=json` and `rel=geometry` links are
pre-signed object-store URLs and are explicitly not gateway calls (`getText(url,
signed=true)`). Measured: 42 page fetches took quota 111 → 69; the **160** link
fetches that resolved 80 features cost **zero**.

So the earlier "Con: ~390 requests to walk pages, spending the window before
resolving a single boundary" was wrong on both halves. Reading **all 565 pages
costs 565 gateway requests** against 500/hour — roughly **one to two hours of
quota, once** — and every boundary behind them then resolves for free.

## A second cause remains — the page cap does NOT explain Serbia

The gap was measured as concentrated in **Austria, Germany and Serbia**. AT (42
pages) and DE (281) are explained outright. **RS has 1 page and we read it.**

So Serbia's missing areas have a *different* cause and are not fixed by any of
this. Do not close this doc when the page cap is fixed. Candidates: Serbia's
alerts fall outside the 23h window, carry no EMMA_ID, or are stranded in the seen
ledger (below).

## Hypotheses tested and refuted

### ❌ NOT quota-bound

Two consecutive `yarn refresh:alert-geom` runs:

```
run 1:  resolved: 100, skipped: 1080, cached: +97,  quotaRemaining: 230
run 2:  resolved:   3, skipped: 1178, cached:  +3,  quotaRemaining: 157
```

`skipped 1178 + resolved 3` = every alert the sweep can currently see. The queue
drains in two runs with quota to spare. More patience buys nothing — the sweep
cannot *see* the areas, because it never reads their pages.

### ❌ REFUTED — the 23-hour datetime window

```
CAN'T resolve: 309 alerts — median age 20.7h — older than 23h: 19%
DID resolve:   791 alerts — median age 19.5h — older than 23h: 20%
```

Identical distributions. Widening the window would burn quota and change nothing.

### ❌ REFUTED — our cached geometry is secretly bounding boxes

Review raised this: MeteoAlarm's EDR docs say a **feature's** geometry is the
*bounding box* of a warning area, so the 507 cached areas marked `precision:
"exact"` might be rectangles wearing a false label.

**Audited every one. It isn't happening:**

```
alert_area_geom: 507 areas
precision="exact"  n=507  axis-aligned rectangles: 0 (0.0%)
                   vertices  min=6  median=41  max=32,577
precision="bbox"   n=0
```

Zero rectangles; median 41 vertices; one 32k-vertex coastline. The label is
honest. The reason is that `resolveFeature` doesn't store `feature.geometry` — it
follows the `rel=geometry` link to the true polygon, and only marks `exact` if
that loads. The review was right about the EDR feature geometry and wrong about
what we do with it.

**Bonus finding:** `precision: "bbox"` has **zero rows**. The bbox fallback has
never fired in production. It is currently dead code — do not assume it works.

### ❌ REFUTED as the cause — the seen ledger (but it IS a real bug)

`geom-sync.ts:144` marks an alert seen **even when it yielded no area**. **550 of
2,458 ledger entries yielded nothing and are never retried** — the "one shot, no
retry" pattern that bit this pipeline four other times.

**None of them are Austrian**, so it is not this gap. Still worth fixing: a
network blip, a 429, or a parse failure is currently cached as the permanent fact
"this alert has no area".

## The real long-term answer EXISTS — MeteoAlarm's Metadata API

This doc previously asked whether a registry endpoint existed and said "not
investigated", then argued the only correct fix was ~37 bespoke national adapters.
**Both were wrong.** There is a first-party registry.

`https://api.meteoalarm.org` is the **MeteoAlarm API Portal**, listing three APIs:
`/edr/v1`, `/hub/v1`, and **`/metadata/v1`**. Its own description:

> "The MeteoAlarm Metadata API provides structured access to metadata about hazard
> types, awareness levels, **regions**, meteorological service logos, and available
> languages used across the MeteoAlarm system. This API is designed for
> **re-distributors and integration partners**."

Three endpoints respond **401 Unauthorized**, and a deliberately bogus path under
the same prefix responds **404** — so they exist and are auth-gated, not imagined:

```
/metadata/v1/regions                          -> 401
/metadata/v1/geocodes                         -> 401
/metadata/v1/geocode-aliases                  -> 401
/metadata/v1/definitely-not-a-real-endpoint   -> 404   ← control
```

**We cannot open it.** Our `METROGATE_API_KEY` is rejected on all four plausible
schemes (`?apikey=`, `X-API-Key:`, `Authorization: Bearer`, `apikey:`). MeteoGate
(`api.meteogate.eu`) and MeteoAlarm (`api.meteoalarm.org`) are different services
with different credentials.

**This is an operator action, not a code change**: request MeteoAlarm API Portal
access as a re-distributor (contact `meteoalarm@geosphere.at`; the portal has
Production and Test environments). If `/regions` returns geometry keyed or
joinable to `EMMA_ID`, then the entire transient-warning page crawl becomes a
fallback, and `/geocode-aliases` may also settle the EMMA↔admin-code question
below for free.

**Unverified:** nobody has seen a `/regions` response body. It is described as
"metadata about regions" — that may or may not include polygons. Do not build on
it until one authenticated call is made.

## Why a static admin-boundary source will NOT work

The obvious fix — "fetch NUTS regions from Eurostat GISCO once, cache forever" —
**is wrong, and the operator caught it before it was built.**

```
AT101  Eisenstadt (Stadt)     ← Austrian Bezirk — administrative
AT106  Mattersburg            ← administrative
ES075  Campiña gaditana       ← an agricultural/meteorological zone. NOT a NUTS region.
```

Austria uses political districts; Spain uses met-service forecast zones that follow
no administrative boundary. A generic admin dataset would be **correct for Austria
and silently wrong for Spain** — the exact failure mode that produced four separate
bugs in this pipeline.

I had asserted "EMMA_IDs map to NUTS regions" as fact. **It is not verified and
looks false** (NUTS3 for Austria is `AT111`, `AT112`…; MeteoAlarm ships `AT101`,
`AT901`). Do not build on that claim.

## The deeper design smell

We enumerate a **stable registry** (`AT106 Mattersburg` is the same polygon this
year as last) by walking a **transient feed** (alerts active in the last 23 hours),
through a page cap. An area is only ever discovered if a warning for it happens to
land in the 13% of pages we read. That is why coverage is ~50% and stuck.

The Metadata API, if it carries geometry, deletes this whole shape.

## THE FIX — as built

Two passes per sweep, replacing the single capped read.

**Pass 1 — freshness (every country, every run).** Page 1 (which also reports the
page count) plus the last `METEOGATE_TAIL_PAGES` (2). This is what the sweep used
to do *alone*, and it was never wrong — the feed is oldest-first, so new alerts
land at the back. It just isn't sufficient. ~73 pages.

**Pass 2 — the deep crawl (resumable).** Everything pass 1 doesn't reach. Reads
from a per-country cursor, **round-robin across countries** so DE's 281 pages
can't spend the run (the same lesson `interleaveByCountry` already learned when
Austria ate a whole budget), stopping on a page budget of 400/run
(`METEOGATE_PAGE_BUDGET`). A completed crawl is skipped for a week
(`METEOGATE_RECRAWL_MS`) — areas are permanent, so re-walking buys nothing until
warnings have appeared over areas that had none.

**The window is PINNED for the life of a crawl.** This is the whole subtlety, and
it is the review's catch:

> A naive per-country page cursor over the rolling 23h window is unsafe. The
> window moves every run — alerts expire, new ones arrive, pages renumber
> underneath. "Next run, read page 5" would read page 5 of a *different result
> set*, and areas would slip between pages unread **exactly as they do now** — the
> same bug wearing a cursor.

So `alert_geom_crawl` stores `windowFrom`/`windowTo` alongside `nextPage`, frozen
at crawl start, and every page of that crawl is fetched with that identical
interval. If `totalPages` moves under an open crawl, the pin isn't holding and the
crawl is re-opened rather than walked against meaningless page numbers.

`nextPage` only ever moves forward (`$max`), and only to pages that actually came
back — so a run that dies mid-country resumes instead of restarting, and a page
that errored is retried rather than skipped past.

**Cost:** ~73 + up to 400 pages/run against 500/hour, hourly. Europe's 565 pages
are covered in roughly two runs, then the crawl sleeps for a week and steady state
drops to ~73/run — *cheaper than the 117/run the broken version spent.*

### Still open under this fix

Walking every page of the **current 23h window** finds every area with a warning
*in the last 23 hours*. An area whose region has been quiet for a week still has
no boundary. Reaching 100% needs either fixed historical slices (`AT:
2025-01-01→2025-02-01, pages 1..N`, dedup by alert UUID + EMMA_ID) or — far
better — the Metadata API above. The weekly re-crawl converges on this slowly and
for free; it does not solve it.

### Not done: country-polygon fallback — PLACEMENT ONLY, and NOT in the geometry cache
The `Country` catalog already carries simplified geometry + bbox in Mongo.

- **Pro:** zero new source, zero quota, ships immediately.
- **Pro:** fixes **placement** — the 557 alerts with no `repPoint` get a continent,
  a World Watch tally slot, a feed row, something for the director to frame.
- **Con — decisive for drawing:** a warning for one Tyrolean district would paint
  **the whole of Austria**. On a broadcast globe that is a factual error.
- **Con:** the dissolve buckets on `hazard|severity|country`, so every Austrian
  warning of a hazard would fuse into one Austria-shaped blob.
- **Con:** poisons `attachCities` — "who is under this warning" would answer "every
  city in Austria", and that feeds the on-air "near this event" panel.

**Do not store it in `alert_area_geom` next to real shapes**, even behind a
`precision: "country"` tag. (Review's catch; it is right, and the `precision:
"bbox"` dead-code finding above shows how little that enum is actually respected.)
Someone will eventually write `if (area.geometry) draw(area.geometry)` and Austria
gets painted for a district warning. Keep it in separate fields that the blob
builder and city matcher never receive:

```
areaGeometry     // drawable warning-area geometry ONLY
placementPoint   // camera / tally — always usable
placementBbox    // framing only
geometryStatus   // exact | unresolved
placementSource  // area | country-fallback
```

### Not done: per-member-service area definitions
~37 countries of bespoke adapters. **Superseded by the Metadata API** if that
carries geometry. Only revisit if it doesn't.

## The scoreboard

Nothing reported whether any of this was working. The sweep logged `+N cached, N
resolved` — *effort* — and read as a success while half of Europe had no shape.
`alerts-repo#geometryCoverage` now runs at the end of every sweep and leads the
admin log line:

```
alertsNoShape   — not one area has a shape. Invisible.
alertsPartial   — SOME areas have shapes. Draws, looks fine on air, is wrong.
areasNoGeom     — the raw gap (was 10,187 / 20,568)
```

`alertsPartial` is the one that hid this for so long.

## What's next

1. **Ask MeteoAlarm for Metadata API access** (operator action —
   `meteoalarm@geosphere.at`). One authenticated `GET /metadata/v1/regions` could
   make the whole crawl a fallback. Highest leverage, zero code.
2. **Find Serbia's cause** — 1 page, fully read, still missing areas. The fix above
   does nothing for it.
3. **Fix the seen ledger** with typed, retryable outcomes rather than a boolean:

   ```
   resolved | confirmed_no_emma_id     ← terminal
   no_polygon | fetch_failed | parse_failed | rate_limited   ← must retry
   ```

4. **Consider the placement fallback** — independent of everything above, cheap,
   and gets the remaining unplaceable warnings into World Watch without lying on
   the map.

## Open questions

- Does `/metadata/v1/regions` actually return polygons, and are they keyed to
  `EMMA_ID`? **Blocks the strategic decision.** Needs a credential.
- Serbia: 1 page, fully read, still missing areas. **Unexplained.**
- Do the 550 stranded ledger alerts genuinely lack an EMMA_ID, or is a transient
  failure cached as a fact? MeteoGate keys features by its own UUID, not the CAP
  identifier, so there is nothing to join against our alerts — needs a probe of one
  feature's `jsonHref`.
- DE has 281 pages against AT's 42 and RS's 1. Is DE genuinely 7× Austria's alert
  volume, or is its page size different? Affects backfill sizing.

## Relevant code

| what | where |
|---|---|
| EDR client, `freshPages`, `fetchPages`, pinned `EdrWindow` | `worker/src/alerts/meteogate.ts` |
| sweep, `planCrawl`, `interleavePages`, ledger, reconcile | `worker/src/alerts/geom-sync.ts` |
| the crawl cursor (pinned window + nextPage) | `shared/src/db/alert-geom-crawl-model.ts` |
| the scoreboard | `shared/src/db/alerts-repo.ts#geometryCoverage` |
| ingest-time join | `worker/src/alerts/enrich-geometry.ts` |
| cache + seen ledger repos | `shared/src/db/alert-area-geom-repo.ts` |
| the admin button | `shared/src/jobs.ts#alert-geom` ("Resolve alert area boundaries") |
| one-shot run | `yarn refresh:alert-geom` (`worker/src/scripts/refreshAlertGeom.ts`) |

Env: `METROGATE_API_KEY` (note the spelling — `METROGATE`, not `METEOGATE`; it is a
**MeteoGate** key and does **not** authenticate against `api.meteoalarm.org`),
`METEOGATE_PAGE_BUDGET` (400 — pages per run, the only thing that spends quota),
`METEOGATE_TAIL_PAGES` (2 — the freshness read off the back),
`METEOGATE_RECRAWL_MS` (7d), `METEOGATE_BUDGET` (100 — alerts resolved per run;
bounds wall clock, NOT quota), `METEOGATE_WINDOW_HOURS` (23),
`METEOGATE_COUNTRIES`.

`METEOGATE_MAX_PAGES` is **gone** — it was the bug.
