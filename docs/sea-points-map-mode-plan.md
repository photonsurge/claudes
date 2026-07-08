# Per-point map mode + surface sea points on /control

## Context

Two gaps left over from the sea-points DB migration:

1. **Every non-depth-cycle sea point hardcodes `activeVariable: "sst"`**
   (`worker/src/director/candidates.ts:423-425`), regardless of what the
   feature actually is — the Mariana Trench (a bathymetry story) shows the
   same "sea surface temperature" map as the Gulf Stream (a current story).
   The registry already has better-fitting variables
   (`shared/src/variables.ts`): `current` (uv ocean-current speed, line 250),
   `wave` (significant wave height, 236), `salinity` (264), `elevation`
   (bathymetry down to -11000m, explicitly built with the Mariana Trench in
   mind, 339) — none of these are wired to any sea point today.
2. **`/control` lost its sea-points visibility entirely.** Before the DB
   migration, `DirectorSpotlights.tsx` had a "Favourite sea points" checkbox
   grid; that was correctly removed since enable/disable now lives in Mongo,
   but nothing replaced it — an operator on `/control` has no way to even
   see the catalog exists, let alone jump to manage it. Confirmed via
   research: NO Director-panel component links to any `/admin/*` catalog
   today (cams/volcanoes/countries aren't linked either) — so this is a new
   (small) pattern, not an existing one to mirror.

## Implementation

### 1. `variableId` field on the `SeaPoint` catalog

- `shared/src/sea-points/types.ts` — add `variableId: string` to `SeaPoint`.
- `shared/src/db/sea-point-model.ts` — add `variableId: { type: String,
  required: true, default: "sst" }` to the schema.
- `shared/src/db/sea-point-repo.ts` — thread `variableId` through
  `toSeaPoint`/`setDoc`; default to `"sst"` when reading an older doc that
  predates the field (`doc.variableId ?? "sst"`) so nothing breaks for
  already-seeded points.
- `shared/src/sea-points/normalise.ts` — accept `variableId`, falling back
  to `"sst"` when missing or not a real registered variable (check via
  `getVariable` from `shared/src/variables.ts`).

### 2. Assign a real per-point default in the seed data

`shared/src/director-sea-points.ts` — set `variableId` on each of the 10
current/feature points to whichever registered variable actually tells that
feature's story (depth-cycle points keep `variableId: "sst"`, since it's
just the depth-cycle's opening chapter and ignored otherwise):

| point | variableId | why |
|---|---|---|
| gulf-stream | `current` | it IS a current |
| sargasso-sea | `salinity` | famously the saltiest/clearest part of the N. Atlantic gyre |
| drake-passage | `current` | Antarctic Circumpolar Current — strongest current on Earth |
| humboldt | `current` | cold upwelling current |
| norwegian-sea | `sst` | the story is warm-meets-cold water |
| agulhas | `current` | warm boundary current |
| bay-of-bengal | `sst` | warm water fuelling cyclones |
| warm-pool | `sst` | literally the warmest surface water on Earth |
| kuroshio | `current` | the "Black Stream" current |
| mariana-trench | `elevation` | the story is depth/bathymetry, not temperature |

This is an editorial default, not a hard rule — admins can change it per
point at `/admin/sea-points` after this ships.

### 3. `worker/src/director/candidates.ts` — use it

Replace the hardcoded `activeVariable: "sst"` in the non-depth-cycle branch
with `activeVariable: p.variableId` (depth-cycle branch is unchanged — it
already forces `"sst"` as the cycle's opening chapter, which is correct
regardless of `variableId`).

### 4. Admin UI — expose the field

- `AddSeaPointForm.tsx` (`public/src/components/sea-points/`) — add a
  `<select>` for `variableId`, options `sst / current / wave / salinity /
  elevation` (the registered variables that make editorial sense for a held
  ocean shot).
- `SeaPointsTable.tsx` — add a "Variable" column next to "Depth cycle".

### 5. Surface the catalog on `/control`

Add a small, link-only block to `DirectorSpotlights.tsx` (replacing the
comment that currently just explains the absence) when `config.kinds.ocean`
is on — no checkboxes, no favourites, just visibility + a shortcut, matching
the already-established principle that this catalog is admin-managed, not
per-scene:

```tsx
{config.kinds.ocean ? (
  <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.8 }}>
    Ocean monitoring points (currents + Niño/MDR/North Sea/Med/IOD depth-cycle
    regions) are managed at{" "}
    <a href="/admin/sea-points" target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>
      /admin/sea-points
    </a>{" "}— enable/disable there, no per-scene favourites.
  </div>
) : null}
```

### Explicitly out of scope

- No richer inline sea-point editor inside `/control` — deliberately just a
  link, consistent with the "admin manages the catalog, operator doesn't"
  principle `DirectorSpotlights.tsx` already established.
- No retroactive migration of already-seeded DB documents' `variableId` —
  the seed script is insert-only-if-missing by design (never clobbers admin
  edits); an already-seeded dev DB simply won't have the new field until an
  admin sets it at `/admin/sea-points` or the doc is re-seeded from scratch.
  The repo's read-side default (`?? "sst"`) covers this gracefully either way.
- No change to `OCEAN_MAP_TYPES`/`globalMapTour` (the global spin's own
  field tour) — `variableId` only applies to held single-point shots.

## Verification

1. `shared/src/sea-points/normalise.test.ts` — extend for `variableId`
   default/validation cases.
2. `shared/src/db/sea-point-repo.test.ts` — extend `upsertOne`/`list` cases
   to cover `variableId`, including the `?? "sst"` fallback for a doc
   without it.
3. `shared/src/director-sea-points.test.ts` — assert every seed point has a
   non-empty `variableId` that resolves via `getVariable`.
4. `worker/src/director/candidates.test.ts` — assert a non-depth-cycle
   point's segment gets `activeVariable === p.variableId`, not a hardcoded
   `"sst"`.
5. `./update-shared`, then `yarn tsc --noEmit` + full test suites in
   `shared`, `worker`, `public`.
6. Live check (user-run): open `/control`, confirm the new link line appears
   under the ocean kind's config; open `/admin/sea-points`, confirm the new
   Variable column/picker; re-run `yarn seed:sea-points` on a DB that
   already has points and confirm it does NOT touch their existing fields
   (insert-only-if-missing, unchanged behavior).
