# Alert dedup & merge plan

Status: proposed (2026-07-15). Sibling of `alert-source-coverage-plan.md` (which
measures the overlap); this one fixes it. Everything below was verified against
the live feeds — the experiments are recorded so they can be re-run, not trusted.

## The finding that changes the design

**Every source republishes a national CAP message, and that message has a
canonical `identifier`. All of them carry it — WMO just hides it.**

| source | canonical CAP identifier |
|---|---|
| MeteoAlarm | exposed directly (`2.49.0.0.616.0.PL.Sk20260715120207440.PL3202`) |
| NWS | exposed directly (`urn:oid:2.49.0.1.840.0.<sha>.001.1`) |
| WMO | **WFS column is empty on all 9,377 features** — but the original CAP XML at `capurl` has it |
| GDACS | its own event ids; a distinct event source, no CAP overlap |

Proven 2026-07-15:

1. WMO row `pl-imgw-xx/2026/07/15/12/02/00-13bbaeab….xml` → fetch
   `https://severeweather.wmo.int/v2/cap-alerts/<capurl>` → the XML contains
   `<identifier>2.49.0.0.616.0.PL.Sk20260715120207440.PL3202</identifier>`,
   `<sender>https://www.imgw.pl</sender>`, and even `EMMA_ID = PL3202`.
2. That **exact identifier string is present in MeteoAlarm's live Poland feed.**
   Same warning. Two sources. One key.
3. Same holds for the US: WMO's `us-noaa-nws-en/…` alerts carry
   `urn:oid:2.49.0.1.840.0.…` — the same OID namespace NWS itself publishes.

### Why this matters

`event-update-acquisition-plan.md` forbids fuzzy auto-merge: *"never auto-merge
on fuzzy; store matchMethod+matchScore; only explicit/GLIDE auto-link; DERIVED
needs MANUAL confirm."* Matching WMO↔MeteoAlarm on (areaDesc, event, time) would
be DERIVED, so it could never auto-merge — dedup would ship behind manual
confirmation, i.e. never.

With the CAP identifier this becomes **EXPLICIT_ID**, which the policy already
permits to auto-merge. The whole feature is unlocked by one fetch per WMO alert.

## Three different "merges" — do not conflate them

| | what | status |
|---|---|---|
| **A. Cross-source dedup** | same warning from WMO *and* MeteoAlarm | **broken today** — 1,392 candidate duplicate alerts live |
| **B. Multi-area reassembly** | one alert covering N areas arriving as N rows | done for WMO (`capurl` merge, `wmo.ts`) |
| **C. Adjacent-area dissolve** | N neighbouring county polygons of the same hazard → one shape on air | **not built** — the reason Poland is 546 tiny polygons |

A and C are independent. C is a rendering win even with a single source.

## Where things stand today

- **Alert identity** is `(source, identifier)` unique (`alert_dedup_ix`) — `source`
  is in the key by construction, so alerts *can never* merge at this layer.
- **`groupAlerts`** (`public/src/lib/alertGroups.ts`) already clusters "the SAME
  event across different sources" by **hazard bucket + bbox overlap** (union-find),
  server-side per request. Consumers already filter to representatives
  (`!a.groupId || a.id === a.groupId`). **So duplicates are largely invisible on
  air today** — which is why this never got caught.
  But it is fuzzy (bbox overlap ≠ same warning), ephemeral, recomputed per
  request, and **invisible to the promotion path**.
- **`WatchedEvent`** is keyed `(primarySource, primarySourceId)` **unique**. So the
  WMO copy and the MeteoAlarm copy become **two events, two watch schedules, two
  timelines, two camera framings.** This is the real, unmitigated damage: the
  display layer hides the duplicate polygons but nothing hides the duplicate
  events.
- **`EventExternalLink`** is the precedent for multi-source linkage
  (`{eventId, source}` unique, with `matchMethod`/`matchScore`) — but it is
  enrichment-only; no alert source ever writes one.

## Plan

### Phase 0 — give every alert its canonical CAP id (foundation)

Add `capId` to the Alert model (indexed, sparse). Populate per source:

- **MeteoAlarm / NWS** — `capId = identifier`. Free, no fetch.
- **WMO** — resolve `capurl` → CAP XML → `<identifier>`. **The capurl is
  content-addressed** (`00-13bbaeab0dda116b….xml` is a hash), so the mapping is
  immutable: fetch once, cache forever, exactly like the EMMA boundary cache.
  New collection `CapIdCache { capurl (unique) → capId, sender, fetchedAt }`.
- **GDACS** — leave null; it has no national CAP to collide with.

Cost: 3,605 unique capurls to backfill once (~1,392 of them in MeteoAlarm
countries); steady state is only newly-published alerts. Budgeted + resumable,
same shape as `geom-sync.ts`. Worker-only; no config.

Ship this alone first: it is additive, inert, and makes the duplication
*measurable* (`count of capId with >1 source`) before anything acts on it.

### Phase 1 — merge on capId

With `capId` present, dedup is exact. Two candidate shapes:

1. **Elect a representative (preferred).** Keep both docs (no data loss, sources
   stay auditable), persist `capId`, and pick one representative per `capId` with
   a fixed preference order. Upgrade `groupAlerts` to group by `capId` when
   present and fall back to bbox overlap only when absent — the UI contract
   (`groupId`/`groupSources`) is unchanged, it just becomes *exact*.
2. **Suppress at ingest.** Skip/deactivate the redundant copy. Simpler reads, but
   destroys the cross-check and thrashes if the preferred source lags.

Recommend (1): it reuses the existing group contract, is reversible, and keeps
both feeds observable — which matters because coverage per country is uneven (see
the coverage plan: MeteoAlarm richer nearly everywhere, WMO richer in Finland).

Preference order should be **measured, not assumed** — and can now be measured
per-alert since we can align the same warning across sources.

### Phase 2 — one event per warning

Key promotion by `capId` when present, so the WMO and MeteoAlarm copies of one
warning produce **one** WatchedEvent, one watch schedule, one timeline, one
framing. This is a genuine key change to a unique-indexed, load-bearing field
(`byPrimary()` feeds the storm focus branch), so it needs a migration and should
land after Phase 1 has proven the keys line up in production.

### Phase 3 — dissolve adjacent areas (the on-air win)

MeteoAlarm issues **one alert per county** (546 live for Poland), each a small
polygon. On a globe that reads as confetti; it should read as a few weather
blobs. Dissolve neighbouring areas sharing (hazard, severity) into one geometry.

- **The union library goes in `worker/package.json` ONLY — never in `public`.**
  All the work happens in the worker: it dissolves the polygons, writes the
  merged shape to Mongo, and `public` just draws the cached geometry. Public
  gains no dependency and does no clipping, exactly as sharp is worker-only and
  public merely `<img>`s the media route. `polygon-clipping` is the tight choice
  (union/dissolve only, small); turf is heavier than needed.
- Precomputed and cached, never per-request — unioning hundreds of polygons on
  read is exactly the class of work `alertGroups` avoids by using bbox overlap
  ("too heavy for thousands of alerts in the browser"). Nothing about this
  belongs on the read path.
- Natural key: the Phase-1 group + (hazard, severity). Store the dissolved shape
  alongside the group; the overlay draws the dissolved shape and keeps the member
  alerts for the panel/timeline.
- **This is a memory win, not a cost.** Done in the worker, it replaces 546 Polish
  county polygons with a handful of blobs, so `public` reads, parses and draws far
  fewer vertices per cut. That is the same lever as projecting coordinates out of
  the Mongo read (`alertsToFeaturesNoGeom`, added after a whole-planet WMO polygon
  OOM'd the app) — fewer vertices on the read path. Judge Phase 3 on that, not
  just on looks.
- Open question to settle with a spike: whether to dissolve only *touching*
  polygons (true adjacency) or any same-hazard cluster within a distance. County
  polygons from EMMA share edges, so a plain union should snap cleanly — verify
  on real EMMA geometry before committing.

## Sequence & risk

Phase 0 is additive and safe — do it first and let it measure the problem for a
few days. Phase 1 changes what goes on air but reuses the existing group contract
and is reversible. Phase 2 touches a unique index and needs care. Phase 3 is
independent of 0–2 and could be done at any point, but is most valuable *after*
dedup (otherwise it dissolves duplicate polygons together).

The trap to avoid: **do not scope sources by country to "fix" duplication** (see
the coverage plan — MeteoAlarm and WMO are each partial in different countries,
so scoping trades a duplication bug for a coverage bug). Dedup on the exact key
instead, and keep both feeds.
