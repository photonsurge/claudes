"use client";

/**
 * Compact geomagnetic-activity readout for the broadcast HUD: the planetary Kp
 * index (0–9) with its NOAA G-scale classification and a 9-segment bar. Shown
 * beside the aurora oval so viewers can read "why the oval is this big". Fed from
 * the cached aurora frame (Kp rides along on it) — renders nothing when Kp is
 * unavailable.
 */
import { kpLevel } from "@photonsurge/shared/aurora/kp";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { UI_SANS } from "../../lib/fonts";

const SEGMENTS = 9;

export default function KpIndexPanel({
  kp,
  theme = DEFAULT_THEME,
}: {
  kp: number | null | undefined;
  theme?: BroadcastTheme;
}) {
  if (kp == null || !Number.isFinite(kp)) return null;
  const level = kpLevel(kp);
  const filled = Math.max(0, Math.min(SEGMENTS, Math.round(kp)));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 11px",
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
      {/* Hero Kp value in the level colour. */}
      <div style={{ lineHeight: 1, textAlign: "center" }}>
        <div style={{ fontSize: 8.8, fontWeight: 800, letterSpacing: 1.4, opacity: 0.55 }}>Kp</div>
        <div
          style={{
            fontSize: 28.6,
            fontWeight: 900,
            color: level.color,
            fontVariantNumeric: "tabular-nums",
            textShadow: `0 0 10px ${level.color}66`,
          }}
        >
          {kp.toFixed(kp % 1 ? 1 : 0)}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 8.8, fontWeight: 800, letterSpacing: 1.4, opacity: 0.55 }}>
          GEOMAGNETIC
        </div>
        <div style={{ fontSize: 13.2, fontWeight: 800, color: "#fff", marginTop: 1 }}>
          <span style={{ color: level.color }}>{level.code}</span>
          <span style={{ opacity: 0.85 }}> · {level.name}</span>
        </div>
        {/* 9-segment activity bar. */}
        <div style={{ display: "flex", gap: 2, marginTop: 5 }}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 1,
                background: i < filled ? level.color : "rgba(255,255,255,0.14)",
                boxShadow: i < filled ? `0 0 5px ${level.color}88` : "none",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
