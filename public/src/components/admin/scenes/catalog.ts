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

export type SettingsGroupId = "layout" | "presentation" | "programme" | "identity";

/** Which document a card's fields live in — the two Save buckets. */
export type SettingsBucket = "control" | "director";

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
    blurb: "What the auto-director puts on air when it is driving this channel.",
  },
  {
    id: "identity",
    label: "Identity",
    blurb: "What the channel says it is — on the about slide and on every YouTube broadcast.",
  },
];

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

  // Programme — the director plans add Pacing, Pools & rotation, Tours &
  // round-ups, Looks and Break-ins here as further entries.
  {
    id: "director",
    title: "Auto-director content",
    group: "programme",
    bucket: "director",
    fields: ["kinds", "kindWeights", "countries", "regions"],
  },

  // Identity
  { id: "about", title: "About card", group: "identity", bucket: "control", fields: ["about"] },
  { id: "youtube", title: "YouTube broadcasts", group: "identity", bucket: "control", fields: ["youtube"] },
];

const CARD_BY_ID = new Map(SETTINGS_CARDS.map((c) => [c.id, c]));

export const getCard = (id: string): SettingsCardDef | undefined => CARD_BY_ID.get(id);

export const cardsInGroup = (group: SettingsGroupId): SettingsCardDef[] =>
  SETTINGS_CARDS.filter((c) => c.group === group);

/** The group a deep-link anchor belongs to, so `#youtube` can open Identity. */
export const groupOfCard = (id: string): SettingsGroupId | undefined => CARD_BY_ID.get(id)?.group;

/**
 * The cards touched by a set of staged keys, in page order. Feeds both the Save
 * bar ("Top-right report, Music bed") and the rail's per-group counts. A staged
 * key no card claims is ignored rather than mis-attributed — catalog.test.ts is
 * what stops one existing.
 */
export function cardsForStagedKeys(
  controlKeys: readonly string[],
  directorKeys: readonly string[],
): SettingsCardDef[] {
  return SETTINGS_CARDS.filter((card) => {
    const keys = card.bucket === "director" ? directorKeys : controlKeys;
    return card.fields.some((f) => keys.includes(f));
  });
}
