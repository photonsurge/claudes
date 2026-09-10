"use client";

/**
 * Broadcast HUD colour key for the aurora oval / magnetic-field overlays — the
 * chrome-mode counterpart to IntensityMeter (which only covers the active
 * WEATHER variable, not these independently-toggled space-weather layers).
 * Renders nothing when neither overlay has a loaded frame.
 */
import { getPalette } from "@photonsurge/shared/palettes";
import { AURORA_DOMAIN } from "@photonsurge/shared/aurora/types";
import { GEOMAG_DOMAIN } from "@photonsurge/shared/geomag/types";
import type { AuroraOverlay } from "../../lib/aurora-overlay";
import type { GeomagOverlay } from "../../lib/geomag-overlay";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { UI_SANS } from "../../lib/fonts";

function Ramp({
  label,
  palette,
  loLabel,
  hiLabel,
}: {
  label: string;
  palette: ReturnType<typeof getPalette>;
  loLabel: string;
  hiLabel: string;
}) {
  const gradient = `linear-gradient(to right, ${palette
    .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
    .join(", ")})`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11.6, fontWeight: 700 }}>{label}</span>
      <div style={{ height: 7, borderRadius: 4, background: gradient, border: "1px solid rgba(0,0,0,0.5)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.9, opacity: 0.75 }}>
        <span>{loLabel}</span>
        <span>{hiLabel}</span>
      </div>
    </div>
  );
}

export default function SpaceWeatherMeter({
  aurora,
  geomag,
  theme = DEFAULT_THEME,
}: {
  aurora?: AuroraOverlay | null;
  geomag?: GeomagOverlay | null;
  theme?: BroadcastTheme;
}) {
  const hasAurora = aurora?.meta != null;
  const hasGeomag = geomag?.meta != null;
  if (!hasAurora && !hasGeomag) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "9px 11px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderRadius: 12,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "var(--panel-blur, blur(8px))",
        WebkitBackdropFilter: "var(--panel-blur, blur(8px))",
        pointerEvents: "none",
        fontFamily: UI_SANS,
        color: theme.titleColor,
        width: 196,
      }}
    >
      {hasAurora ? (
        <Ramp
          label="Aurora oval"
          palette={getPalette("aurora")}
          loLabel={`${AURORA_DOMAIN[0]}%`}
          hiLabel={`${AURORA_DOMAIN[1]}%+`}
        />
      ) : null}
      {hasGeomag ? (
        <Ramp
          label="Magnetic field"
          palette={getPalette("geomag")}
          loLabel={`${Math.round(GEOMAG_DOMAIN[0] / 1000)}k nT`}
          hiLabel={`${Math.round(GEOMAG_DOMAIN[1] / 1000)}k nT`}
        />
      ) : null}
    </div>
  );
}
