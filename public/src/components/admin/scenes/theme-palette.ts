import type { BasemapColors, ThemeOverrides } from "@photonsurge/shared/control";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

type RGB = [number, number, number];

export interface GeneratedScenePalette {
  themeOverrides: ThemeOverrides;
  basemapColors: BasemapColors;
}

export function isHexColour(value: string): boolean {
  return HEX6.test(value);
}

function rgb(hex: string): RGB {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hex([r, g, b]: RGB): string {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Mix `from` toward `to`; amount 0 keeps `from`, amount 1 becomes `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  const t = Math.max(0, Math.min(1, amount));
  return hex([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

/** Build a complete, high-contrast broadcast palette from two operator seeds.
 * The highlight stays exact; the dark base is shaded/tinted into the related
 * panel, tile, map, and locator values so those clustered controls start in a
 * coherent family and remain individually editable after generation. */
export function generateScenePalette(highlight: string, darkBase: string): GeneratedScenePalette | null {
  if (!isHexColour(highlight) || !isHexColour(darkBase)) return null;

  const accent = highlight.toLowerCase();
  const base = darkBase.toLowerCase();
  const title = mixHex(base, "#ffffff", 0.94);
  const text = mixHex(base, "#ffffff", 0.86);
  const muted = mixHex(base, "#ffffff", 0.62);
  const dim = mixHex(base, "#ffffff", 0.46);

  const panelTop = mixHex(base, accent, 0.14);
  const panelMid = mixHex(base, "#000000", 0.18);
  const panelBottom = mixHex(base, accent, 0.06);
  const panelEdge = mixHex(base, accent, 0.48);
  const tile = mixHex(base, "#000000", 0.25);
  const tileEdge = mixHex(base, accent, 0.32);

  const ocean = mixHex(base, "#000000", 0.36);
  const land = mixHex(base, accent, 0.2);
  const mapBorder = mixHex(text, accent, 0.28);
  const locatorLand = mixHex(base, accent, 0.36);
  const locatorEdge = mixHex(text, accent, 0.35);

  return {
    themeOverrides: {
      accent,
      titleColor: title,
      textColor: text,
      mutedColor: muted,
      dimColor: dim,
      liveColor: accent,
      tickerText: title,
      godsPanelTopColor: panelTop,
      godsPanelMidColor: panelMid,
      godsPanelBottomColor: panelBottom,
      godsBorderColor: panelEdge,
      tileColor: tile,
      tileBorderColor: tileEdge,
      mapHighlightColor: accent,
      mapLabelColor: title,
      mapCapitalColor: accent,
      minimapOceanInnerColor: panelTop,
      minimapOceanOuterColor: ocean,
      minimapLandColor: locatorLand,
      minimapLandEdgeColor: locatorEdge,
      minimapGridColor: panelEdge,
      minimapLimbColor: muted,
      minimapAccentColor: accent,
      tickerBg: `linear-gradient(180deg, ${panelMid}, ${ocean})`,
      panelBg: `linear-gradient(180deg, ${panelTop}, ${panelMid})`,
      panelBorder: `1px solid ${panelEdge}`,
    },
    basemapColors: {
      ocean,
      land,
      border: mapBorder,
    },
  };
}
