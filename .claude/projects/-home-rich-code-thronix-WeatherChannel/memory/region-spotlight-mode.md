---
name: region-spotlight-mode
description: New `region` ("Areas") director kind mirroring country spotlights, wired to the Region catalog + RegionRoundup
metadata:
  type: project
---

New director kind `region` ("Regions"/"Areas") — the Region-catalog cousin of the `country` spotlight. Frames one curated area (continent or land sub-region; oceans + "world" excluded) and plays the IDENTICAL left-column deck as a country: lede → place round-up → top cities → city conditions → area forecast → area history.

**Key pieces:**
- `shared/director-regions.ts`: `REGION_SHOTS` (derived from `REGION_PRESETS`, land+continents only), `regionShot(id)`, `sanitizeDirectorRegions`, and `cameraForBbox(bbox)` — regions store bbox-only, so camera center/zoom is DERIVED (not hand-tuned like COUNTRY_SHOTS).
- `DirectorConfig.regions: string[]` favourites (default `[]`, kind off by default — opt-in). Added to `director-config-model.ts` schema (`kinds.region` + `regions`) or strict Mongoose drops it (see [[controlstate-persist-schema]]).
- Worker `candidates.ts`: `if (cfg.kinds.region)` loops `cfg.regions` → `make("region", …)`.
- Round-up slide reuses the place-roundups feature ([[place-roundups-feature]]): `/api/roundup/place?kind=region&placeId=<regionId>` + `useLatestPlaceRoundup`. Country round-up was wired the same session (`/api/roundup/place?kind=country`, CountryRoundup as the country spotlight's 2nd slide).
- `mode-slides.tsx`: `ctx.countryRoundup` was GENERALIZED to `ctx.placeRoundup` (country OR region) — both flow the same `wideCitiesBbox` spotlight branch.
- BroadcastFrame resolves region bbox from `regionShot`, enrichment (lede photo/blurb) from `useRegion(regionId)` (new hook in lib/regions.ts), round-up by regionId.
- Operator picker: "Favourite areas" grid in `DirectorSpotlights.tsx`.

**Gotcha:** adding a SegmentKind means filling every exhaustive `Record<SegmentKind,…>` — director.ts (holds/kinds/PRESETS/DEFAULT_KIND_SLIDES), public kinds.ts, DirectorCaption, DirectorHolds (KIND_LABEL), ViewingOverlay. tsc flags them all.

Requires the region catalog seeded + wiki-enriched + RegionRoundup job run for content to appear; empty → slide self-hides. Possible follow-ups: region globe-glow outline (country uses flag-colour outline, [[country-map-glow-spotlight]]); tune `cameraForBbox` zoom.
