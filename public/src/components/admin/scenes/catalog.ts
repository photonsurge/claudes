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
 *
 * `surfaces` says which kind of channel a card applies to (plan §8.2): a weather
 * channel never shows the Game group, a crossword one never shows the globe's
 * layout, camera or director. A group with no card for a surface drops off its
 * rail.
 */
import type { SceneSurface } from "@photonsurge/shared/control";

export type SettingsGroupId = "game" | "layout" | "presentation" | "programme" | "viewers" | "identity";

/** Which document a card's fields live in — the three Save buckets. */
export type SettingsBucket = "control" | "director" | "crossword";

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
  /** The kinds of channel this card applies to. */
  surfaces: readonly SceneSurface[];
};

const BOTH: readonly SceneSurface[] = ["globe", "crossword"];
const GLOBE: readonly SceneSurface[] = ["globe"];
const CROSSWORD: readonly SceneSurface[] = ["crossword"];

export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
  {
    id: "game",
    label: "Game",
    blurb: "How the crossword plays — its pace, how hard it is, where its puzzles come from and how chat answers count.",
  },
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
  // Game — a crossword channel's CrosswordConfig, saved by its own route.
  {
    id: "crossword-on",
    title: "On air",
    group: "game",
    bucket: "crossword",
    fields: ["enabled", "playOffAir"],
    surfaces: CROSSWORD,
  },
  {
    id: "crossword-pacing",
    title: "Pacing",
    group: "game",
    bucket: "crossword",
    fields: ["clueS", "hintStartFrac", "hintMaxFrac", "introS", "finaleS", "revealHoldS", "solveBeatS", "ceilingMin"],
    surfaces: CROSSWORD,
  },
  {
    id: "crossword-difficulty",
    title: "Difficulty & themes",
    group: "game",
    bucket: "crossword",
    fields: ["minZipf", "themes", "themeEvery"],
    surfaces: CROSSWORD,
  },
  {
    id: "crossword-puzzles",
    title: "Puzzles",
    group: "game",
    bucket: "crossword",
    fields: ["stockTarget", "autoApprove", "noRepeatPuzzles", "noRepeatWordsPuzzles", "minWords", "maxWords", "maxSize"],
    surfaces: CROSSWORD,
  },
  {
    id: "crossword-chat",
    title: "Chat & scoring",
    group: "game",
    bucket: "crossword",
    fields: ["streamDelayS", "rateMax", "rateWindowS", "blocklist"],
    surfaces: CROSSWORD,
  },

  // Layout
  { id: "widgets", title: "On-air widgets", group: "layout", bucket: "control", fields: ["widgetsOff"], surfaces: GLOBE },
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
    surfaces: GLOBE,
  },
  {
    id: "deck",
    title: "Bottom-left deck",
    group: "layout",
    bucket: "control",
    fields: ["slidesOff", "slideOrder", "slideHoldMs", "slideRuns", "pointVarsOff"],
    surfaces: GLOBE,
  },
  {
    id: "crawl",
    title: "Bottom crawl",
    group: "layout",
    bucket: "control",
    fields: ["tickerKindsOff", "tickerHazardsOff"],
    surfaces: GLOBE,
  },

  // Presentation
  {
    id: "theme",
    title: "Brand & theme",
    group: "presentation",
    bucket: "control",
    fields: ["broadcastTheme", "themeOverrides", "basemapColors"],
    surfaces: BOTH,
  },
  {
    id: "camera",
    title: "Camera motion",
    group: "presentation",
    bucket: "control",
    // spinEpoch is stamped alongside the drift settings to restart the motion.
    fields: ["idleMotion", "idleOrbit", "idleBreathe", "idlePeriodS", "spinEpoch"],
    surfaces: GLOBE,
  },
  { id: "audio", title: "Music bed", group: "presentation", bucket: "control", fields: ["audio"], surfaces: BOTH },
  { id: "pace", title: "Reading pace", group: "presentation", bucket: "control", fields: ["readPaceCps"], surfaces: GLOBE },

  // Programme — the director. Titles carry no "Director:" prefix: the group
  // heading already says what they are (docs/done/director-programme-plan.md §7.1).
  {
    id: "director",
    title: "Content",
    group: "programme",
    bucket: "director",
    fields: ["kinds", "kindWeights", "countries", "regions"],
    surfaces: GLOBE,
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
    surfaces: GLOBE,
  },
  {
    id: "director-pools",
    title: "Pools & rotation",
    group: "programme",
    bucket: "director",
    fields: ["minQuakeMag", "minAlertSeverity", "pools", "rotation"],
    surfaces: GLOBE,
  },
  { id: "director-tours", title: "Tours & round-ups", group: "programme", bucket: "director", fields: ["tours"], surfaces: GLOBE },
  {
    id: "director-looks",
    title: "Looks",
    group: "programme",
    bucket: "director",
    fields: ["mapTypes", "overlayOverrides", "kindLooks", "kindSlides", "activeSlideId"],
    surfaces: GLOBE,
  },
  { id: "director-break-ins", title: "Break-ins", group: "programme", bucket: "director", fields: ["breakIn"], surfaces: GLOBE },

  // Viewers
  { id: "chat", title: "Chat commands", group: "viewers", bucket: "control", fields: ["chat"], surfaces: BOTH },

  // Identity
  { id: "about", title: "About card", group: "identity", bucket: "control", fields: ["about"], surfaces: BOTH },
  { id: "youtube", title: "YouTube broadcasts", group: "identity", bucket: "control", fields: ["youtube"], surfaces: BOTH },
];

const CARD_BY_ID = new Map(SETTINGS_CARDS.map((c) => [c.id, c]));

export const getCard = (id: string): SettingsCardDef | undefined => CARD_BY_ID.get(id);

export const cardsInGroup = (group: SettingsGroupId, surface?: SceneSurface): SettingsCardDef[] =>
  SETTINGS_CARDS.filter((c) => c.group === group && (!surface || c.surfaces.includes(surface)));

/** The groups that have at least one card for this kind of channel, in rail order. */
export const groupsForSurface = (surface: SceneSurface): SettingsGroupDef[] =>
  SETTINGS_GROUPS.filter((g) => cardsInGroup(g.id, surface).length > 0);

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
  crosswordKeys: readonly string[] = [],
): SettingsCardDef[] {
  return SETTINGS_CARDS.filter((card) => {
    const keys =
      card.bucket === "director" ? directorKeys : card.bucket === "crossword" ? crosswordKeys : controlKeys;
    return card.fields.some((f) => keys.includes(f));
  });
}
