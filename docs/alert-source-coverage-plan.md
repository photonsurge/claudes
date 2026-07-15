# Alert source coverage plan — dedup, UK, US, and beyond

Status: proposed (2026-07-15). Companion to `event-update-acquisition-plan.md`.

Everything in "Findings" was measured against the live feeds on 2026-07-15, not
inferred from the code comments — several of which turned out to be stale.

## Findings

### 1. WMO and MeteoAlarm are duplicating most of Europe

`registry.ts` says WMO is "missing the UK Met Office plus DE, NL, IE, DK and a
handful more" and instructs us to scope MeteoAlarm to those gaps via
`METEOALARM_COUNTRIES` "so nothing duplicates".

Neither half of that holds today:

- **The comment is stale.** WMO now carries DE (16), NL (100), IE (72), DK (12).
- **The scoping was never configured.** `METEOALARM_COUNTRIES` is unset, so
  MeteoAlarm fans out to all 37 countries; `WMO_EXCLUDE_CC` is unset and defaults
  to empty, so WMO ingests the whole planet including Europe.

Measured against WMO's live feed (9,377 rows, 52 countries):

| | countries |
|---|---|
| Carried by BOTH (duplicated) | **29** — incl. PL, FR, ES, DE, NL, FI |
| WMO has nothing | **8** — `bg is il lv lu mt pt gb` |

**Count WMO by `capurl`, never by row.** WMO's rows are one per (alert × area):
1,315 US rows are 179 alerts (one covers 41 areas); 2,906 Finnish rows are 124
alerts. Comparing raw row counts to MeteoAlarm's per-alert counts is meaningless
and inverts the answer — it made France look WMO-favoured (513 rows) when WMO
actually has **9** French alerts to MeteoAlarm's 133.

The Poland alert that started this work is `source: meteoalarm`, and WMO
independently carries 103 Polish alerts of the same national origin (WMO's
`areadesc` "Zachodniopomorskie Province Choszczeński County" and event "Orange
high-temperature warning" are the same IMGW strings MeteoAlarm publishes).

**Confidence: high that both feeds carry the same warnings; not yet proven that
every one double-renders.** Confirm with one query before acting — see P0.

### 2. There is no shared key to dedup on

WMO's `identifier` property is **empty on all 9,377 features**, and its geocode
(`gc`) field is empty too. So WMO alerts carry neither the national CAP
identifier nor an EMMA_ID — the two keys that would make cross-source dedup
exact. Any dedup must be *fuzzy*: (country, areaDesc, event, sent/expires
window) or geometry overlap.

This is the crux. **Do not scope countries naively**: WMO having *some* alerts
for a country does not mean it has *all* of them (WMO shows 16 for Germany;
DWD issues far more). Dropping DE from MeteoAlarm on that basis would lose
warnings, trading a duplication bug for a coverage bug.

### 3. Per ALERT, MeteoAlarm is richer nearly everywhere — except Finland

| country | MeteoAlarm | WMO (unique alerts) |
|---|---|---|
| Germany | **611** | 11 |
| Netherlands | **787** | 100 |
| Spain | **665** | 302 |
| Poland | **546** | 103 |
| France | **133** | 9 |
| Finland | 19 | **124** |

So "MeteoAlarm owns Europe" is *nearly* right — but it would drop Finland from
124 alerts to 19. One outlier is enough to make a blanket country rule wrong,
which is the whole reason P0 below is "measure", not "configure".

UK is **0 in both** feeds right now, so its coverage is untested — do not assume
either source carries it until UK weather is actually warning.

### 4. Better US is NOT a switch — NWS trades shapes for alerts

NWS has **315 active alerts** vs WMO's **179** US alerts, and polls 60s vs 600s.
But only **13% of NWS alerts carry a polygon** — the other 87% are UGC/SAME zone
codes with no geometry, i.e. exactly the disease we just cured for MeteoAlarm.
WMO's US alerts *do* have geometry.

So flipping NWS on today would gain alerts and lose shapes. It only becomes a
clean win once zone codes resolve to boundaries — see P1.

## Plan

### P0 — Stop the European duplication (correctness; do first)

1. **Confirm it.** One query: for a country in both (PL), count active alerts
   per source and eyeball whether the same warning appears twice on the globe.
   If they don't actually double-render, everything below de-prioritises.
2. **Measure per-country completeness** rather than presence: for each of the 29
   overlapping countries, compare WMO's active count against MeteoAlarm's for
   the same window. Where WMO is comparable, it can own the country; where WMO
   is a thin subset (DE looks like one), MeteoAlarm must stay.
3. **Then** set `METEOALARM_COUNTRIES` to the true gaps plus the thin-coverage
   countries, and `WMO_EXCLUDE_CC` to the countries MeteoAlarm owns. Land the
   measurement as a script (`yarn audit:alert-coverage`) so this never goes stale
   again — that is what rotted the registry comment.
4. **Fix the stale comment** in `registry.ts` as part of the same change.

Deliberately NOT proposing a fuzzy cross-source dedup engine yet: config scoping
solves it if coverage permits, and matching on (areaDesc, event, time) across
translations and feed conventions is its own project. Revisit only if step 2
shows both sources are each partial and neither can own a country.

### P1 — Generalise the geocode→boundary cache (the actual win)

The EMMA cache built on 2026-07-15 is a special case of a general problem: **feeds
name an area by code and ship no shape.** MeteoAlarm does it with `EMMA_ID`; NWS
does it with `UGC`/`SAME` on 87% of its alerts.

Generalise `AlertAreaGeom` from "EMMA_ID → polygon" to "(valueName, value) →
polygon", with a resolver per code type:

- `EMMA_ID` → MeteoGate (built).
- `UGC` → `api.weather.gov/zones/{type}/{id}` (free, no key, returns geometry).

`enrich-geometry.ts` already joins on the area's geocodes and needs almost no
change. Then NWS can simply be **on in code** — 315 alerts *with* shapes beats
WMO's 179 — and the US question answers itself with no env var.

This is the no-config path: one mechanism, one cache, each new geocode-only feed
is a resolver rather than a knob.

### P2 — Richer per-alert info

MeteoGate's `rel=json` (already reachable — see `meteogate.ts`) returns the full
CAP alert plus fields the CAP feed lacks:

- `supersededByAlertId` / `supersedeType` / `supersededAt` — a real update chain,
  which feeds the alert-revision/timeline work directly.
- Per-language text (`hubLanguage`), so translations come from the source rather
  than our own translate step.

Cheapest path: extend the existing geometry sync (it already fetches `rel=json`
for the EMMA_ID) to harvest these at the same time — no new requests.

### P3 — More sources (coverage)

Real gap is outside Europe/US. WMO's 52 countries leave much of Asia, Africa and
South America thin, and WMO is a republisher — when a member stops feeding it,
the country silently drops to zero (as the UK has).

Candidates, in rough value order:
- **Met Office (UK) direct** — DataHub API. Only if MeteoAlarm's UK proves thin;
  it is now shaped and may be enough.
- **Environment Canada** (CA: 374 via WMO — check completeness).
- **BOM (Australia)**, **JMA (Japan)**, **IMD (India)** — big populations, thin
  WMO coverage.
- **Copernicus EMS / ReliefWeb** — already named in the unified-events plan; they
  are event sources, not warning feeds, and belong there rather than here.

Each new source needs an answer to "how does this not duplicate WMO?" *before*
it is written — that is the lesson of P0.

## Sequence

P0 → P1 are small and mostly config; do them together and verify on air. P2 rides
the geometry sync we already run. P3 only after the coverage audit script from P0
exists, so every new source is measured against WMO on arrival.
