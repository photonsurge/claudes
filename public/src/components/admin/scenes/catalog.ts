/**
 * The map of `/admin/scenes/:id` — the one place that knows what settings cards
 * exist, which group each belongs to and which fields each of them stages.
 *
 * Four things read it: the page (what to render, in what order), the group rail
 * (the groups and their unsaved counts), `SettingsCard` (its own title and
 * whether any of its fields are staged) and the Save bar (naming what a Save
 * will change). Adding a card is an entry here plus the component.
 *
 * It deliberately holds NO component imports. Cards import `SettingsCard`,
 * which reads this file; if this file imported the cards back, that would be a
 * cycle. The page owns the id → component mapping instead.
 *
 * `fields` must list every top-level key its card stages. The parity test in
 * catalog.test.ts pins that each key has exactly one owner, so the Save bar can
 * always name what changed.
 */

export type SettingsGroupId = "video" | "layout" | "presentation" | "programme" | "viewers" | "identity";

/** Which document a card's fields live in — the Save buckets. "format" is the
 *  third document a short format's editor adds (its short settings). */
export type SettingsBucket = "control" | "director" | "format";

export type SettingsGroupDef = {
  id: SettingsGroupId;
  label: string;
  /** One line under the group heading. The page description used to carry all of these at once. */
  blurb: string;
};

export type SettingsCardDef = {
  /** Anchor id and deep-link target: /admin/scenes/:id#youtube */
  id: string;
  title: string;
  group: SettingsGroupId;
  bucket: SettingsBucket;
  fields: readonly string[];
};

export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
  {
    id: "layout",
    label: "Layout",
    blurb: "What occupies the screen — the chrome widgets, the two decks and the bottom crawl.",
  },
  {
    id: "presentation",
    label: "Presentation",
    blurb: "How the channel looks, moves and sounds, and how fast it asks to be read.",
  },
  {
    id: "programme",
    label: "Programme",
    blurb: "What the auto-director puts on air when it is driving this channel, how fast it moves and when it breaks in.",
  },
  {
    id: "viewers",
    label: "Viewers",
    blurb: "What the audience may change from live chat.",
  },
  {
    id: "identity",
    label: "Identity",
    blurb: "What the channel says it is — on the about slide and on every YouTube broadcast.",
  },
];

/**
 * DirectorConfig keys deliberately NOT editable here: Auto/Off and Skip are
 * live desk controls on /control, never staged.
 */
export const LIVE_ONLY_DIRECTOR_KEYS: readonly string[] = ["mode", "skipNonce"];

export const SETTINGS_CARDS: readonly SettingsCardDef[] = [
  // Layout
  { id: "widgets", title: "On-air widgets", group: "layout", bucket: "control", fields: ["widgetsOff"] },
  {
    id: "report",
    title: "Top-right report",
    group: "layout",
    bucket: "control",
    fields: [
      "reportOff",
      "reportOrder",
      "reportHoldMs",
      "reportRuns",
      "reportKindsOff",
      "reportHazardsOff",
      "weatherLocations",
    ],
  },
  {
    id: "deck",
    title: "Bottom-left deck",
    group: "layout",
    bucket: "control",
    fields: ["slidesOff", "slideOrder", "slideHoldMs", "slideRuns", "pointVarsOff"],
  },
  {
    id: "crawl",
    title: "Bottom crawl",
    group: "layout",
    bucket: "control",
    fields: ["tickerKindsOff", "tickerHazardsOff"],
  },

  // Presentation
  {
    id: "theme",
    title: "Brand & theme",
    group: "presentation",
    bucket: "control",
    fields: ["broadcastTheme", "themeOverrides", "basemapColors"],
  },
  {
    id: "camera",
    title: "Camera motion",
    group: "presentation",
    bucket: "control",
    // spinEpoch is stamped alongside the drift settings to restart the motion.
    fields: ["idleMotion", "idleOrbit", "idleBreathe", "idlePeriodS", "spinEpoch"],
  },
  { id: "audio", title: "Music bed", group: "presentation", bucket: "control", fields: ["audio"] },
  { id: "pace", title: "Reading pace", group: "presentation", bucket: "control", fields: ["readPaceCps"] },

  // Programme — the director. Titles carry no "Director:" prefix: the group
  // heading already says what they are (docs/done/director-programme-plan.md §7.1).
  {
    id: "director",
    title: "Content",
    group: "programme",
    bucket: "director",
    fields: ["kinds", "kindWeights", "countries", "regions"],
  },
  {
    id: "director-pacing",
    title: "Pacing",
    group: "programme",
    bucket: "director",
    fields: [
      "kindHoldSeconds",
      "quakeHoldSeconds",
      "stormHoldSeconds",
      "volcanoHoldSeconds",
      "transitionSeconds",
      "alertCycleSeconds",
      "adEveryNShots",
      "tempo",
    ],
  },
  {
    id: "director-pools",
    title: "Pools & rotation",
    group: "programme",
    bucket: "director",
    fields: ["minQuakeMag", "minAlertSeverity", "pools", "rotation"],
  },
  { id: "director-tours", title: "Tours & round-ups", group: "programme", bucket: "director", fields: ["tours"] },
  {
    id: "director-looks",
    title: "Looks",
    group: "programme",
    bucket: "director",
    fields: ["mapTypes", "overlayOverrides", "kindLooks", "kindSlides", "activeSlideId"],
  },
  { id: "director-break-ins", title: "Break-ins", group: "programme", bucket: "director", fields: ["breakIn"] },

  // Viewers
  { id: "chat", title: "Chat commands", group: "viewers", bucket: "control", fields: ["chat"] },

  // Identity
  { id: "about", title: "About card", group: "identity", bucket: "control", fields: ["about"] },
  { id: "youtube", title: "YouTube broadcasts", group: "identity", bucket: "control", fields: ["youtube"] },
];

/**
 * A whole settings map: its groups (rail order) and its cards (page order).
 * The channel page uses `CHANNEL_CATALOG`; a short format's editor has its own
 * (components/admin/shorts/formats/format-catalog.ts) built from the same card
 * components. The shared shell, rail and Save bar read whichever one the page
 * provides through `SettingsCatalogContext` (catalog-context.tsx).
 */
export type SettingsCatalog = {
  groups: readonly SettingsGroupDef[];
  cards: readonly SettingsCardDef[];
};

const CARD_BY_ID = new Map(SETTINGS_CARDS.map((c) => [c.id, c]));

export const CHANNEL_CATALOG: SettingsCatalog = { groups: SETTINGS_GROUPS, cards: SETTINGS_CARDS };

export const getCard = (id: string, cards: readonly SettingsCardDef[] = SETTINGS_CARDS): SettingsCardDef | undefined =>
  cards === SETTINGS_CARDS ? CARD_BY_ID.get(id) : cards.find((c) => c.id === id);

export const cardsInGroup = (group: SettingsGroupId, cards: readonly SettingsCardDef[] = SETTINGS_CARDS): SettingsCardDef[] =>
  cards.filter((c) => c.group === group);

/** The group a deep-link anchor belongs to, so `#youtube` can open Identity. */
export const groupOfCard = (id: string, cards: readonly SettingsCardDef[] = SETTINGS_CARDS): SettingsGroupId | undefined =>
  getCard(id, cards)?.group;

/** The staged keys of each bucket, as the draft holds them. */
export const stagedKeyLists = (draft: { pending: object; pendingDirector: object; pendingFormat?: object }) =>
  [Object.keys(draft.pending), Object.keys(draft.pendingDirector), Object.keys(draft.pendingFormat ?? {})] as const;

/**
 * The cards touched by a set of staged keys, in page order. Feeds both the Save
 * bar ("Top-right report, Music bed") and the rail's per-group counts. A staged
 * key no card claims is ignored rather than mis-attributed — catalog.test.ts is
 * what stops one existing.
 */
export function cardsForStagedKeys(
  controlKeys: readonly string[],
  directorKeys: readonly string[],
  formatKeys: readonly string[] = [],
  cards: readonly SettingsCardDef[] = SETTINGS_CARDS,
): SettingsCardDef[] {
  return cards.filter((card) => {
    const keys = card.bucket === "director" ? directorKeys : card.bucket === "format" ? formatKeys : controlKeys;
    return card.fields.some((f) => keys.includes(f));
  });
}
