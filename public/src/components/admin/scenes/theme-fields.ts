/**
 * The brand editor's field map: every overridable theme key, the label it wears
 * in the admin form, whether it is a colour, and which group it sits under.
 * Data only — `ThemeFieldGroups` renders it and `ThemePaletteDialog` uses the
 * key sets to decide which parts of a generated palette to apply.
 */
import { THEME_OVERRIDE_KEYS } from "@photonsurge/shared/control";

export type ThemeKey = (typeof THEME_OVERRIDE_KEYS)[number];
export type FieldGroup = "identity" | "interface" | "surfaces" | "map" | "minimap" | "advanced";
export type ThemeField = { key: ThemeKey; label: string; color?: boolean; group: FieldGroup };

export const THEME_FIELDS: ThemeField[] = [
  { key: "name", label: "Brand name", group: "identity" },
  { key: "tagline", label: "Tagline", group: "identity" },
  { key: "strapline", label: "Strapline", group: "identity" },
  { key: "tickerTitle", label: "Ticker title", group: "identity" },
  { key: "meterTitle", label: "Meter title", group: "identity" },
  { key: "accent", label: "UI highlight colour", color: true, group: "interface" },
  { key: "titleColor", label: "Panel title colour", color: true, group: "interface" },
  { key: "textColor", label: "Body text colour", color: true, group: "interface" },
  { key: "mutedColor", label: "Muted text colour", color: true, group: "interface" },
  { key: "dimColor", label: "Dim text colour", color: true, group: "interface" },
  { key: "liveColor", label: "LIVE badge colour", color: true, group: "interface" },
  { key: "tickerText", label: "Ticker text colour", color: true, group: "interface" },
  { key: "godsPanelTopColor", label: "G.O.D.S. panel top", color: true, group: "surfaces" },
  { key: "godsPanelMidColor", label: "G.O.D.S. panel middle", color: true, group: "surfaces" },
  { key: "godsPanelBottomColor", label: "G.O.D.S. panel bottom", color: true, group: "surfaces" },
  { key: "godsBorderColor", label: "G.O.D.S. panel edge", color: true, group: "surfaces" },
  { key: "tileColor", label: "Inset tile colour", color: true, group: "surfaces" },
  { key: "tileBorderColor", label: "Inset tile edge", color: true, group: "surfaces" },
  { key: "mapHighlightColor", label: "Map highlight colour", color: true, group: "map" },
  { key: "mapLabelColor", label: "Map label colour", color: true, group: "map" },
  { key: "mapCapitalColor", label: "Capital label colour", color: true, group: "map" },
  { key: "minimapOceanInnerColor", label: "Locator ocean highlight", color: true, group: "minimap" },
  { key: "minimapOceanOuterColor", label: "Locator ocean shadow", color: true, group: "minimap" },
  { key: "minimapLandColor", label: "Locator land colour", color: true, group: "minimap" },
  { key: "minimapLandEdgeColor", label: "Locator coastline colour", color: true, group: "minimap" },
  { key: "minimapGridColor", label: "Locator grid colour", color: true, group: "minimap" },
  { key: "minimapLimbColor", label: "Locator outer edge", color: true, group: "minimap" },
  { key: "minimapAccentColor", label: "Locator reticle colour", color: true, group: "minimap" },
  { key: "tickerBg", label: "Ticker background (CSS)", group: "advanced" },
  { key: "panelBg", label: "Legacy panel background (CSS)", group: "advanced" },
  { key: "panelBorder", label: "Legacy panel border (CSS)", group: "advanced" },
];

export const THEME_GROUPS: { id: Exclude<FieldGroup, "advanced">; title: string; description: string }[] = [
  { id: "identity", title: "Identity", description: "Names shown in the masthead, ticker, and map furniture." },
  { id: "interface", title: "Interface text & highlights", description: "Shared colours used across headings, labels, readouts, rules, and live indicators." },
  { id: "surfaces", title: "Panels & inset tiles", description: "The G.O.D.S. shells plus the smaller forecast, feed, chart, and monitor boxes inside them." },
  { id: "map", title: "Main map", description: "Vector-basemap fills and the on-air map highlight and place-label colours." },
  { id: "minimap", title: "Locator globe", description: "The small globe embedded into the masthead, separate from the main map." },
];

/** Key sets the palette generator can include or leave alone. */
export const MAP_KEYS: ThemeKey[] = ["mapHighlightColor", "mapLabelColor", "mapCapitalColor"];
export const LOCATOR_KEYS: ThemeKey[] = [
  "minimapOceanInnerColor",
  "minimapOceanOuterColor",
  "minimapLandColor",
  "minimapLandEdgeColor",
  "minimapGridColor",
  "minimapLimbColor",
  "minimapAccentColor",
];
export const TEXT_KEYS: ThemeKey[] = ["titleColor", "textColor", "mutedColor", "dimColor", "tickerText"];
