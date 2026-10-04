# `/admin/scenes/:id` — settings page refinement

> **Status: SHIPPED** (2026-09-13) — all five phases. The page carried 11 peer
> cards in one 760 px column, each independently fetching the same document, and
> the director per-channel config, break-in and chat interaction plans (now
> combined in [director-programme-plan.md](./director-programme-plan.md)) were about to add seven
> more. It is now four groups on a rail over a draft that owns the data, so
> those land as catalog entries. §§0–6 describe what was wrong and what was
> built; §7 is the phase list, all done.

## 0. What the page was

`app/admin/scenes/[id]/page.tsx` (79 lines) mounted `SceneDraftProvider` round
a flat `<Stack spacing={2}>` of eleven `<Paper>` cards:

| # | Card | Heading | Owns | Lines |
|---|---|---|---|---|
| 1 | `ChannelSettings` | On-air widgets | `widgetsOff` | 139 |
| 2 | `CameraSettings` | Camera motion | `idleMotion` `idleOrbit` `idleBreathe` `idlePeriodS` | 168 |
| 3 | `ReportSettings` | Top-right report | `reportOff` `reportOrder` `reportHoldMs` | 307 |
| 4 | `TickerSettings` | Bottom crawl | `tickerKindsOff` `tickerHazardsOff` | 104 |
| 5 | `PaceSettings` | Reading pace | `readPaceCps` | 106 |
| 6 | `AboutCardSettings` | About card | `about` | 108 |
| 7 | `YoutubeSettings` | YouTube broadcasts | `youtube` | 77 |
| 8 | `SlidesSettings` | Bottom-left deck | `slidesOff` `slideOrder` `slideHoldMs` | 258 |
| 9 | `DirectorSettings` | Auto-director content | `DirectorConfig` | 207 |
| 10 | `AudioSettings` | Music bed | `audio` | 147 |
| 11 | `ThemeSettings` | Brand / theme | `broadcastTheme` `themeOverrides` `basemapColors` | 329 |

The [Save bar](../public/src/components/admin/scenes/SceneDraft.tsx) is the
one genuinely good bone in the page and this plan keeps it: cards stage deltas,
nothing reaches air until Save, and the patch can never clobber the operator's
live state. Everything below is about the 2 000 lines around it.

## 1. What was actually wrong

**1.1 No structure.** Eleven peer cards, no grouping, in an order that has
drifted to near-random: About and YouTube sit between the crawl and the
bottom-left deck; camera motion sits second; the theme is last. Finding a
setting means scrolling and reading every heading. The page `description` is a
60-word run-on that lists all eleven, which is the tell.

**1.2 Eleven fetches of two documents.** Ten cards call `fetchSceneState(sceneId)`
in their own `useEffect`; `DirectorSettings` calls `fetchDirectorConfig`. Each
keeps a private `useState` copy of the *whole* `ControlState` and hand-merges
its own writes into it. Discard bumps `epoch` and all eleven refetch. With
[API request logging](../public/src/lib/api-log.ts) on, one page view is eleven
`/api/*` rows in Mongo.

**1.3 The private copies block any layout change.** A card renders from its own
snapshot, so unmounting it (a tab, a collapsed section) throws the *display* of
a staged edit away: the delta survives in the provider, the card refetches the
server doc on remount and shows the OLD value while the Save bar still holds
the new one. **Tabs or accordions are unsafe until the draft is the source of
truth.** This is why §2 comes before §3.

**1.4 Stale against the live desk.** Cards snapshot once and never subscribe to
`SCENE_STATE`. An operator nudging `/control` leaves this page showing numbers
that are no longer true — and the page gives no hint of it.

**1.5 Card boilerplate ×11.** `Paper sx={{p:1.75}}` + `subtitle2` header +
optional header buttons + `Loading channel…` + a closing `<Alert severity="info">`
explainer, copy-pasted eleven times, already drifting (`mb: 1` vs `mb: 1.25`,
explainer above vs below). Nothing enforces the shape on card twelve.

**1.6 The Save bar will not say what it will do.** "Unsaved changes — nothing
has gone on air yet." At eighteen cards you can stage an edit, scroll, forget
it and Save something you no longer remember. Save is also fire-and-forget:
`patch()` and `void patchDirectorConfig()`, no confirmation, no error surface,
no guard against navigating away dirty.

**1.7 Two cards are really sub-pages.** `ThemeSettings` (329) holds a preset
picker, a live preview, a full palette-generator dialog, six field groups and a
raw-CSS group. `ReportSettings` (307) holds presets, an off-list and a
reorder/dwell list. Both are over the project's keep-files-small line.

**1.8 Deep links land nowhere.** `DirectorHolds`, `StreamPanel` and the streams
`SlotsCard` all link to `/admin/scenes/:id` meaning "the director card" or "the
YouTube card". All three land at the top of a long scroll.

**1.9 `sceneId` is prop-drilled** into every card although the provider it sits
inside already knows it.

## 2. S0 — the draft owns the data (the keystone)


`SceneDraftProvider` fetches **once** and hands cards a merged view. Nothing
visual changes; this is the change that makes everything after it possible.

```ts
type SceneDraftValue = {
  sceneId: string;
  ready: boolean;
  /** Server doc with the staged delta merged on top — what cards render. */
  state: ControlState;
  config: DirectorConfig;
  /** Stage a delta. No sceneId arg: the provider knows it. */
  stage: (patch: Partial<ControlState>) => void;
  stageDirector: (patch: Partial<DirectorConfig>) => void;
  /** Which top-level keys are staged — drives the dirty dots and the Save bar. */
  dirtyKeys: ReadonlySet<string>;
  dirtyDirectorKeys: ReadonlySet<string>;
  saving: boolean;
  saveError: string | null;
};
```

- Cards become **pure forms**: read `state`, call `stage`. No `useEffect`, no
  `fetchSceneState`, no local copy, no `epoch`, no `Loading channel…` — the
  page renders one skeleton until `ready`. That is roughly −20 lines from each
  of eleven files and it removes the whole "set local state *and* patch"
  double-write class of bug.
- **Discard** clears the two pending buckets. It needs no refetch and no
  `epoch` at all: the merged view falls back to the base doc by itself.
- **Live follow.** The provider subscribes to `SCENE_STATE` for this scene and
  merges incoming changes into the *base*, leaving the staged delta on top. An
  operator's nudge shows up in fields you have not touched; fields you have
  staged keep your value and the card marks them "changed on the desk while you
  were editing".
- The no-provider fallback in `useSceneDraft` goes away — no card is used
  outside this page (checked). One contract, not two.
- `spinEpoch` handling is unchanged: `CameraSettings` keeps the `epochSafe`
  test, the provider keeps the restamp-at-Save.

**Reference count after S0:** two requests per page view (`/api/scenes/:id`,
`/api/director/:id/config`), down from eleven; zero on Discard, down from
eleven.

## 3. S1 — one card shell and one catalog

`components/admin/scenes/catalog.ts` — the single source the page, the rail,
the Save bar and the deep-link map all read:

```ts
export type SettingsGroup = "layout" | "presentation" | "programme" | "identity";
export type SettingsCardDef = {
  id: string;              // anchor + deep-link target, e.g. "youtube"
  title: string;           // "YouTube broadcasts"
  group: SettingsGroup;
  fields: string[];        // ControlState / DirectorConfig top-level keys it stages
  Component: ComponentType;
};
```

`components/admin/scenes/SettingsCard.tsx` — the shell every card renders
into: `Paper`, the `subtitle2` header row, an `actions` slot, a `blurb` slot
(the closing `<Alert severity="info">` explainers move into it, consistently
placed), `id` for the anchor, and an "unsaved" dot when any of the card's
declared `fields` are in `dirtyKeys`. Target: no card file over 200 lines.

## 4. S2 — four groups and a rail

Rail on the left (sticky), cards on the right, Save bar pinned bottom.
`AdminPageShell maxWidth` goes 760 → 1100 and the card column keeps its 760.

| Group | Cards | Why together |
|---|---|---|
| **Layout** | On-air widgets · Top-right report · Bottom-left deck · Bottom crawl | what occupies the screen |
| **Presentation** | Brand & theme · Camera motion · Music bed · Reading pace | how it looks, moves and sounds |
| **Programme** | Director content · Pacing · Pools & rotation · Tours & round-ups · Looks · Break-ins | what airs and when — the whole director plan lands here |
| **Identity** | About card · YouTube broadcasts | what the channel says it is, on air and on YouTube |
| *(later)* **Viewers** | Chat commands | chat / commands plans |

Two placements are deliberate and worth a cross-link chip: the bottom crawl's
*content* is Layout while its *speed* is Presentation (Reading pace), and
Reading pace drives every scrolling surface, not just the crawl.

**Routing.** `?s=<group>` on the existing route, plus `#<card-id>` anchors. A
bare `/admin/scenes/:id` opens Layout. A `#youtube` link selects Identity and
scrolls to the card, so the three existing deep links keep working and can be
tightened to `#director` / `#youtube`.

*Rejected:* nested `[id]/[group]/page.tsx` routes. Prettier URLs, but the draft
would have to live in a client `layout.tsx` to survive group navigation, the
page test and three call-sites churn, and the win over a query param is
cosmetic.

*Rejected:* MUI `Tabs` (as on `/admin/tracks`). Four to six groups of unequal
weight read better as a vertical rail, and the rail has room for the per-group
"n unsaved" count that makes §5 work.

The page `description` shrinks to one sentence; each group gets its own
one-liner above its cards.

## 5. S3 — a Save bar that says what it will do

- Names the changed cards: "3 changes · Top-right report, Music bed, Brand &
  theme", resolved from `dirtyKeys` through `catalog.fields`.
- The rail shows a per-group count so a change in a group you are not looking
  at is visible.
- Save **awaits** both PATCHes, shows a result, and surfaces a failure inline
  instead of swallowing it. Staged changes survive a failed save.
- Discard confirms above a small threshold.
- `beforeunload` guard while dirty.

## 6. S4 — split the two heavy cards

| Today | After |
|---|---|
| `ThemeSettings` 329 | `ThemeSettings` (preset + preview + resets) · `ThemePaletteDialog` (the generator) · `ThemeFieldGroups` (advanced grid + raw CSS) |
| `ReportSettings` 307 | `ReportSettings` (presets + on/off) · `ReportOrderList` (reorder rows + dwell) |

`SlidesSettings` (258) gets the same treatment only if it crosses 200 after the
S0 strip; it probably lands just under.

## 7. Build order

| Phase | Deliverable | Status |
|---|---|---|
| **S0** | `SceneDraftProvider` owns the data; cards stripped to pure forms; live `SCENE_STATE` follow | done |
| **S1** | `catalog.ts` + `SettingsCard`; all cards adopt it | done |
| **S2** | Group rail, `?s=`, `#card` deep links, trimmed copy | done |
| **S3** | Save bar names changes; awaited save; nav guard | done |
| **S4** | Split Theme and Report | done |

S0 had to land first — it is what makes a rail safe (§1.3).

**What shipped, file by file:**

| New | What it is |
|---|---|
| `catalog.ts` | groups + card defs (id, title, group, bucket, fields) |
| `SettingsCard.tsx` | the shared card shell (heading, blurb, actions, note, anchor, unsaved dot) |
| `SceneSaveBar.tsx` | the sticky bar, lifted out of the provider so it can read the catalog |
| `SettingsGroupRail.tsx` | the left rail with per-group unsaved counts |
| `draft-harness.tsx` | `renderInDraft` — card tests get a draft, not a mocked fetch |
| `SlideOrderList` · `ReportOrderList` · `ReportLocationsField` · `ReportContentFields` · `DirectorKindList` · `ThemeFieldGroups` · `ThemePaletteDialog` · `theme-fields.ts` | the splits |

Two library functions now report failure so the Save bar can: `patchScene`
returns `{ ok, error }` (its debounced live callers ignore it), and
`patchDirectorConfig` throws on a rejected write instead of returning the error
body for a caller to store as a config.

Save emits SCENE_STATE once and does the durable PATCH itself, rather than
going through the debounced live patcher — that would have written the same
delta twice and swallowed the failure.

Every card file is now under 200 lines; no card holds server state; the three
deep links (`DirectorHolds`, `StreamPanel`, streams `SlotsCard`) point at
`#director` / `#youtube`. Requests per page view: 2, down from 11 — and 0 on
Discard, down from 11.

The planned director cards (Pacing, Pools & rotation, Tours & round-ups, Looks,
Break-ins, Chat commands) now land in the Programme group as catalog entries
plus a component, with no page churn.

## 8. Tests

- **provider**: one fetch per document; merged view renders staged over server;
  a live `SCENE_STATE` updates untouched fields and never overwrites a staged
  one; Discard restores server values without a refetch; Save issues exactly
  one ControlState PATCH and one DirectorConfig PATCH, and keeps the draft on
  failure.
- **catalog**: ids unique; every key a card stages is declared in exactly one
  card's `fields` — a pinned table test in the spirit of the
  [ControlState persist parity test](../shared/src/db/broadcast-state-model.test.ts),
  so a new field cannot arrive without an owner and the Save bar can always
  name it.
- **page**: rail switches group; `?s=` selects; `#card` selects the owning
  group and scrolls; the `DirectorHolds` / `StreamPanel` / `SlotsCard` hrefs
  resolve to real anchors.
- **cards**: existing per-card tests survive, rewired from a mocked
  `fetchSceneState` to a provider wrapper; each still asserts it stages a
  COMPLETE top-level field.

## 9. Decisions taken (change here if wrong)

1. The draft, not each card, owns the data. Cards hold no server state.
2. Nothing moves to or is removed from `/control`. Admin stays canonical, the
   desk stays live — as the director config plan already decided.
3. Groups are a rail with a query param, not routes and not tabs.
4. No form library. The staged-delta model already *is* the form state;
   react-hook-form would duplicate it.
5. The page stays a client component (`useParams`, socket, live follow).
6. Card files cap at ~200 lines; anything bigger splits into siblings in the
   same folder.
