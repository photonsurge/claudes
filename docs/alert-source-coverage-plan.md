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

Measured against WMO's live feed (9,377 active alerts, 52 countries):

| | countries |
|---|---|
| Carried by BOTH (duplicated) | **29** — incl. PL 103, FR 513, ES 332, FI 2906 |
| WMO has nothing (MeteoAlarm is the only source) | **8** — `bg is il lv lu mt pt gb` |

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

### 3. UK is already covered — and was just fixed

WMO carries **zero** UK alerts (`gb`/`uk` both 0), so MeteoAlarm is the UK's only
source. Until now those alerts had no geometry at all (MeteoAlarm ships
geocode-only areas), so UK warnings could not be drawn. The EMMA boundary cache
landed 2026-07-15 fixes exactly that: UK alerts now resolve to real shapes.

So "we need UK" is largely **already done** — verify before building anything.

### 4. Better US is a config change, not a build

The NWS adapter exists, is complete, polls at 60s and ships polygons — but
`ALERTS_NWS_ENABLED` is unset, so it is **off**, and the US is served by WMO
alone (1,315 alerts). `.env` already sets `NWS_POLL_SEC=900`, suggesting someone
intended to enable it and stopped short.

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

### P1 — Better US (cheap, high value)

Set `ALERTS_NWS_ENABLED=true` and `WMO_EXCLUDE_CC=us`. Gains richer US data:
NWS CAP has real polygons, UGC/SAME geocodes, urgency/certainty/instruction, and
a 60s poll vs WMO's 600s. `NWS_POLL_SEC=900` in `.env` should drop to the 60s
default (or ~120s) or the point of switching is lost.

Verify after: US alert count should be comparable-or-higher, and none should be
double-counted (WMO `us` prefix must vanish).

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
