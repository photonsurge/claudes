/**
 * The map of a short format's editor, /admin/shorts/formats/:id
 * (docs/short-video-plan.md §5.5). Its OWN card list, separate from the
 * channel page's (components/admin/scenes/catalog.ts), so the two can diverge:
 * the card components a short shares with a channel are the same components
 * (the ids match, so each renders under this catalog's title and group), and
 * the cards only a short has stage the third bucket, "format" — the short
 * settings (`ShortFormat`).
 *
 * Not here, because a short doesn't use them (§5.2): the director's kinds,
 * weights, favourites, pools, tours and break-ins (the script picks the
 * content), chat, and the channel YouTube card (a format has its own).
 */
import type { SettingsCardDef, SettingsCatalog, SettingsGroupDef, SettingsGroupId } from "../../scenes/catalog";

export const FORMAT_GROUPS: readonly SettingsGroupDef[] = [
  {
    id: "video",
    label: "Video",
    blurb: "What goes in a video of this format, how it opens and closes, what YouTube is told and what a render starts from.",
  },
  {
    id: "layout",
    label: "Layout",
    blurb: "What occupies the screen — the chrome widgets, the two decks and the bottom crawl.",
  },
  {
    id: "presentation",
    label: "Presentation",
    blurb: "How the format looks, moves and sounds, how fast it asks to be read, and which shots it shows events in.",
  },
  {
    id: "identity",
    label: "Identity",
    blurb: "What the format says it is on the about slide.",
  },
];

export const FORMAT_CARDS: readonly SettingsCardDef[] = [
  // Video — the short settings (ShortFormat).
  { id: "template", title: "Template", group: "video", bucket: "format", fields: ["name", "template"] },
  { id: "opener", title: "Opener and close", group: "video", bucket: "format", fields: ["opener", "close"] },
  { id: "youtube-video", title: "YouTube video", group: "video", bucket: "format", fields: ["video"] },
  { id: "timing", title: "Timing", group: "video", bucket: "format", fields: ["timing"] },
  { id: "render", title: "Render defaults", group: "video", bucket: "format", fields: ["render"] },

  // Layout — the channel's own cards, on the format's scene.
  { id: "widgets", title: "On-air widgets", group: "layout", bucket: "control", fields: ["widgetsOff"] },
  {
    id: "report",
    title: "Report",
    group: "layout",
    bucket: "control",
    fields: ["reportOff", "reportOrder", "reportHoldMs", "reportRuns", "reportKindsOff", "reportHazardsOff", "weatherLocations"],
  },
  {
    id: "deck",
    title: "Deck slides",
    group: "layout",
    bucket: "control",
    fields: ["slidesOff", "slideOrder", "slideHoldMs", "slideRuns", "pointVarsOff"],
  },
  { id: "crawl", title: "Crawl", group: "layout", bucket: "control", fields: ["tickerKindsOff", "tickerHazardsOff"] },

  // Presentation
  { id: "theme", title: "Theme", group: "presentation", bucket: "control", fields: ["broadcastTheme", "themeOverrides", "basemapColors"] },
  {
    id: "camera",
    title: "Camera",
    group: "presentation",
    bucket: "control",
    fields: ["idleMotion", "idleOrbit", "idleBreathe", "idlePeriodS", "spinEpoch"],
  },
  { id: "audio", title: "Music bed", group: "presentation", bucket: "control", fields: ["audio"] },
  { id: "pace", title: "Reading pace", group: "presentation", bucket: "control", fields: ["readPaceCps"] },
  {
    id: "looks",
    title: "Looks and thresholds",
    group: "presentation",
    bucket: "director",
    fields: [
      "transitionSeconds",
      "minQuakeMag",
      "minAlertSeverity",
      "alertCycleSeconds",
      "kindLooks",
      "overlayOverrides",
      "kindSlides",
      "activeSlideId",
    ],
  },

  // Identity
  { id: "about", title: "About card", group: "identity", bucket: "control", fields: ["about"] },
];

export const FORMAT_CATALOG: SettingsCatalog = { groups: FORMAT_GROUPS, cards: FORMAT_CARDS };

export const DEFAULT_FORMAT_GROUP: SettingsGroupId = "video";
