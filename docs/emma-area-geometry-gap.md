# EMMA area geometry gap — half our warning areas have no shape

**Status:** open. Cause narrowed to one live suspect, not yet proven.
**Written:** 2026-07-16, end of a long session. Everything below is measured
against live data unless explicitly flagged as a guess.

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

## Measured facts

```
active alerts:                        6,441
  meteoalarm  2,703 — 632 with NO drawable shape (23%)
  wmo         3,674 — 169 (5%)
  gdacs          64 — 0

areas: 20,568 total, 10,187 with no geometry          (49.5%)
EMMA boundary cache: 507 areas (all precision "exact")
uncached EMMA_IDs still referenced by an ACTIVE alert: 214
alerts with >= 1 unresolvable area:                    310   (all REAL warnings)
```

**None of the 214 are needed by green alerts.** Checked explicitly — the greens
(see `alerts.reconcile`) are a red herring here; they all resolved fine. These are
310 genuine warnings, concentrated in **Austria, Germany and Serbia**.

Austria in detail:

```
AT EDR features: 232  →  116 distinct alerts
  already seen: 108   ·  still resolvable: 8
AT areas cached: 71
AT areas our active alerts reference: 116
AT areas we still lack: 45   ← only 8 are reachable via the current sweep
```

## It is NOT quota-bound

This was on the todo list as "quota-bound at ~100/run, needs ~13 hours". **That is
wrong.** Two consecutive `yarn refresh:alert-geom` runs:

```
run 1:  resolved: 100, skipped: 1080, cached: +97,  quotaRemaining: 230
run 2:  resolved:   3, skipped: 1178, cached:  +3,  quotaRemaining: 157
```

`skipped 1178 + resolved 3 = 1181` = **every alert the sweep can currently see**.
The queue drains to nothing in two runs with quota to spare. More patience buys
nothing.

## Hypotheses tested

### ❌ REFUTED — the 23-hour datetime window

`meteogate.ts` queries `datetime=[now-23h, now]` (`WINDOW_HOURS = 23`, *"EDR
rejects a window of 24h or more"*). Obvious theory: a warning issued three days
ago and still running falls outside the window.

**Tested. It isn't that:**

```
CAN'T resolve: 309 alerts — median age 20.7h — older than 23h: 19%
DID resolve:   791 alerts — median age 19.5h — older than 23h: 20%
```

Identical distributions. Widening the window would burn quota and change nothing.

### ❌ REFUTED — the seen ledger stranding Austrian alerts

`geom-sync.ts:144` marks an alert seen **even when it yielded no area** (*"an alert
with no EMMA_ID will never resolve, so remembering it stops us paying for it again
every run"*). **550 of 2,458 ledger entries yielded nothing and are never retried**
— a real instance of the "one shot, no retry" pattern that bit this pipeline four
other times tonight.

**But none of them are Austrian**, so it is not the cause of this gap. Worth
fixing on its own merits; it is not this bug.

Note: I could not prove whether those 550 genuinely lack an EMMA_ID. MeteoGate
keys features by **its own UUID**, not the CAP identifier, so there is nothing to
join against our alerts collection. Needs a targeted probe (fetch one stranded
feature's `jsonHref` and look).

### ⚠️ LIVE SUSPECT — the page cap skips the middle of every country

`fetchCountryFeatures` (`meteogate.ts`):

```ts
const first = await fetchCountryPage(cc, 1, now);       // page 1
const maxPages = Number(process.env.METEOGATE_MAX_PAGES || 3);
for (let p = first.totalPages, read = 1; p > 1 && read < maxPages; p--, read++) {
  // ...walk BACKWARDS from the last page
}
```

We read **page 1 + the last ~3 pages**. Everything between is **never read, on any
run, ever**. The backwards direction is deliberate and correct in isolation (the
feed is oldest-first, so the front returns alerts the ledger resolved long ago) —
but it means the middle of the range is permanently invisible.

That fits Austria: 116 areas referenced, 71 cached (61%), and the missing ones
interleaved with the present ones (`AT101` missing, `AT104` cached, `AT203`
cached, `AT209` missing) — exactly what "we read some pages and not others" looks
like, and NOT what a country-level or time-level gap looks like.

**Not yet proven.** The confirming measurement is one request per country:
`fetchCountryPage(cc, 1).totalPages`. If `AT.totalPages` is ~10 and we read 4,
that is the bug. **This is the next thing to run.**

## The deeper design smell

We are enumerating a **stable registry** (EMMA areas — `AT106 Mattersburg` is the
same polygon this year as last) by walking a **transient feed** (alerts active in
the last 23 hours), through a page cap, one alert at a time, at two requests each.

An area is only ever discovered if a warning for it happens to appear in the slice
of pages we read. That is why coverage is ~50% and stuck there.

## Why a static admin-boundary source will NOT work

The obvious fix — "fetch NUTS regions from Eurostat GISCO once, cache forever" —
**is wrong, and the operator caught it before it was built.**

EMMA areas are **not consistently administrative**:

```
AT101  Eisenstadt (Stadt)     ← Austrian Bezirk — administrative
AT106  Mattersburg            ← administrative
ES075  Campiña gaditana       ← an agricultural/meteorological zone. NOT a NUTS region.
```

Austria uses political districts; Spain uses met-service forecast zones that
follow no administrative boundary. A generic admin dataset would be **correct for
Austria and silently wrong for Spain** — the exact failure mode that produced four
separate bugs in this pipeline tonight.

I had asserted "EMMA_IDs map to NUTS regions" as fact. **It is not verified and
looks false** (NUTS3 for Austria is `AT111`, `AT112`…; MeteoAlarm ships `AT101`,
`AT901`). Do not build on that claim.

If a static source is pursued, it must be **MeteoAlarm's / each member service's
own area definitions**, not a third-party admin dataset.

## Options

### A. Raise / remove the page cap  ← cheapest, test first
Read every page per country instead of ~4.

- **Pro:** likely a config change (`METEOGATE_MAX_PAGES`). Areas are stable and
  cached forever, so the cost is paid ONCE and coverage becomes permanent.
- **Pro:** no new source, no new code paths, nothing to keep in sync.
- **Con:** page walks cost quota (1 request each). 39 countries × ~10 pages = ~390
  requests against a 500/hour budget — a run that spends the window before
  resolving a single boundary.
- **Mitigation:** a **per-country page cursor** — remember which pages have been
  read, advance a few each run. Every page gets read exactly once, over a handful
  of runs, then never again. This is the natural shape given the areas are stable.
- **Blocked on:** confirming `totalPages` per country (one request each).

### B. Country-polygon fallback, PLACEMENT ONLY
The `Country` catalog already carries real (simplified) geometry + bbox in Mongo.
`alert_area_geom` already has a `precision` enum (`"exact" | "bbox"`) — precedent
for marking quality, and `bbox` already never clobbers `exact`.

- **Pro:** zero new source, zero quota, could ship immediately.
- **Pro:** fixes **placement** outright — the 557 alerts with no `repPoint` get a
  continent, a World Watch tally slot, a feed row, and something for the director
  to frame.
- **Con — decisive for drawing:** a warning for one Tyrolean district would paint
  **the whole of Austria**. On a broadcast globe that is a factual error.
- **Con:** the dissolve buckets on `hazard|severity|country`, so every Austrian
  warning of a hazard would fuse into one Austria-shaped blob — visually identical
  to "the entire country is under warning".
- **Con:** poisons `attachCities` — "who is under this warning" would answer with
  every city in Austria, and that feeds the on-air "near this event" panel.

**Therefore: use it for placement only.** Store with its own `precision`
(e.g. `"country"`), use for `repPoint` / bbox / framing, and **exclude from the
blob build and the city lookup**. An unresolved area still isn't drawn — which is
what happens today anyway — but it stops being invisible to the tally.

### C. Per-member-service area definitions
Each met service publishes its own warning-zone geometry (Austria's Bezirke are
open admin data; AEMET publishes its zones).

- **Pro:** the only thing that is actually *correct* for drawing, everywhere.
- **Con:** ~37 countries of bespoke adapters. Big.
- **Verdict:** the real long-term answer, not a tonight answer.

## Recommendation

1. **Measure `totalPages` per country.** One request each. This is the whole
   question — if the page cap is the cause, Option A is a small, contained fix and
   everything else here is moot.
2. **If confirmed:** implement the per-country page cursor (Option A + mitigation).
   Areas are stable; each page needs reading exactly once, ever.
3. **In parallel, Option B for placement only** — it is independent of the cause,
   cheap, and gets 310 real warnings into World Watch without lying on the map.
4. **Separately**, fix the 550-entry seen-ledger stranding. Not this bug, but it is
   the same "one shot, marked forever, no path back" pattern as the four fixed
   tonight, and it will strand more over time.

## Open questions

- `totalPages` per country — unmeasured. **Blocks everything.**
- Do the 550 stranded alerts genuinely lack an EMMA_ID, or is a parse failure being
  cached as a fact? Needs a probe of one feature's `jsonHref`.
- Does MeteoGate EDR expose an area/registry endpoint (OGC EDR has a `locations`
  concept) that would list areas directly rather than via alerts? If so, the whole
  per-alert dance is unnecessary. **Not investigated.**
- Is `precision: "bbox"` ever actually used? Every one of the 507 cached areas is
  `exact`, so the fallback may be dead code.

## Relevant code

| what | where |
|---|---|
| EDR client, page walk, 23h window, `maxPages` | `worker/src/alerts/meteogate.ts` |
| sweep, seen ledger, backfill, reconcile | `worker/src/alerts/geom-sync.ts` |
| ingest-time join | `worker/src/alerts/enrich-geometry.ts` |
| cache + seen ledger repos | `shared/src/db/alert-area-geom-repo.ts` |
| the admin button | `shared/src/jobs.ts#alert-geom` ("Resolve alert area boundaries") |
| one-shot run | `yarn refresh:alert-geom` (`worker/src/scripts/refreshAlertGeom.ts`) |

Env: `METROGATE_API_KEY` (note the spelling — it is `METROGATE`, not `METEOGATE`),
`METEOGATE_MAX_PAGES` (3), `METEOGATE_BUDGET` (100), `METEOGATE_WINDOW_HOURS` (23),
`METEOGATE_COUNTRIES`.
